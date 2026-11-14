import { AETHER_INSTRUCTIONS } from './instructions.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  ActParamsSchema,
  AskParamsSchema,
  DoneParamsSchema,
  FindParamsSchema,
  LookParamsSchema,
  MemoryParamsSchema,
  OpenParamsSchema,
  ScreenshotParamsSchema,
} from '@aether/shared';
import type { MCPBrowserSession, ToolOutput } from './browser-session.js';
import { wrapUntrustedPageText } from './untrusted.js';

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

function toResult(output: ToolOutput) {
  const lines = [...output.notes];
  if (output.page !== undefined) lines.push(wrapUntrustedPageText(output.page, output.url));
  const content: Content[] = [{ type: 'text', text: lines.join('\n') }];
  if (output.image) content.push({ type: 'image', data: output.image, mimeType: 'image/png' });
  return { content, isError: output.isError ?? false };
}

export function createAetherMcpServer(browser: MCPBrowserSession): McpServer {
  const server = new McpServer({ name: 'aether', version: '0.2.0' }, { instructions: AETHER_INSTRUCTIONS });

  /** Errors thrown by the engine name refs or the engine's own state, never page text, so they stay outside the wrapper. */
  const runTool = (tool: string) => async (handler: () => Promise<ToolOutput> | ToolOutput) => {
    const started = Date.now();
    let output: ToolOutput;
    try {
      output = await handler();
    } catch (error) {
      output = { notes: [error instanceof Error ? error.message : String(error)], isError: true };
    }
    const result = toResult(output);
    const text = result.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
    browser.recordStep(tool, output, Math.ceil(text.length / 3.5), Date.now() - started);
    return result;
  };

  server.registerTool('open', {
    description: 'Load a URL. Returns a skim of the viewport with refs.',
    inputSchema: OpenParamsSchema,
  }, (params) => runTool('open')(() => browser.open(params)));

  server.registerTool('look', {
    description: 'Skim viewport. as=text reads; as=items lists; as=survey harvests & graph-matches.',
    inputSchema: LookParamsSchema,
  }, (params) => runTool('look')(() => browser.look(params)));

  server.registerTool('find', {
    description: 'Search whole page, off-screen too. Returns refs.',
    inputSchema: FindParamsSchema,
  }, (params) => runTool('find')(() => browser.find(params)));

  server.registerTool('act', {
    description: 'Run 1-8 actions. Stops on failure/navigation/dialog. Returns delta.',
    inputSchema: ActParamsSchema,
  }, (params) => runTool('act')(() => browser.act(params)));

  server.registerTool('screenshot', {
    description: 'Image of viewport or ref for visuals text misses.',
    inputSchema: ScreenshotParamsSchema,
  }, (params) => runTool('screenshot')(() => browser.screenshot(params)));

  server.registerTool('ask', {
    description: 'Ask the person, or hand them a step. Waits for the answer.',
    inputSchema: AskParamsSchema,
  }, (params) => runTool('ask')(() => browser.ask(params)));

  server.registerTool('memory', {
    description: 'Recall or save site preference or note.',
    inputSchema: MemoryParamsSchema,
  }, (params) => runTool('memory')(() => browser.memory(params)));

  server.registerTool('done', {
    description: 'End run with result and evidence.',
    inputSchema: DoneParamsSchema,
  }, (params) => runTool('done')(() => browser.done(params)));

  return server;
}
