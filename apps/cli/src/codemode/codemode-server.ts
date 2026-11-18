import { CodeModeHost } from '@aether/codemode';
import {
  AetherDoneParamsSchema,
  AetherExecParamsSchema,
  AetherScreenshotParamsSchema,
  AetherSpacesParamsSchema,
  doneParamsProblem,
  screenshotParamsProblem,
  spaceIdFromName,
  spacesParamsProblem,
} from '@aether/shared';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MCPBrowserSession } from '@aether/engine';
import { toToolResult, type ToolContent } from '@aether/engine';
import { CODEMODE_INSTRUCTIONS } from './instructions.js';
import { renderReport } from '@aether/engine';
import { SPACE_SDK_DECLARATION } from './sdk-declaration.js';
import { SessionSpaceEngine } from '@aether/engine';

/*
 * The four Code Mode operations as MCP tools (plan 3.1, section 8.1): the
 * only surface `aether mcp` serves. Over the 2.0 engine until the app exists.
 */

type Content = ToolContent;

function textResult(text: string, isError = false): { content: Content[]; isError: boolean } {
  return { content: [{ type: 'text', text }], isError };
}

const outputResult = toToolResult;

export interface CodeModeServer {
  server: McpServer;
  host: CodeModeHost;
}

export function createCodeModeMcpServer(browser: MCPBrowserSession, options: { holdReturnMs?: number } = {}): CodeModeServer {
  const host = new CodeModeHost(new SessionSpaceEngine(browser), { holdReturnMs: options.holdReturnMs });
  browser.run.onStop(() => host.stopAll());
  const server = new McpServer({ name: 'aether', version: '0.3.0' }, { instructions: CODEMODE_INSTRUCTIONS });

  /** Engine errors are engine text, never page text, so they stay outside the wrapper. */
  const guard = async (tool: string, body: () => Promise<{ content: Content[]; isError: boolean }>) => {
    const started = Date.now();
    let result: { content: Content[]; isError: boolean };
    try {
      result = await body();
    } catch (error) {
      result = textResult(error instanceof Error ? error.message : String(error), true);
    }
    const text = result.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
    browser.recordStep(tool, { notes: [], isError: result.isError }, Math.ceil(text.length / 3.5), Date.now() - started);
    return result;
  };

  server.registerTool(
    'aether_exec',
    {
      description: `Run TypeScript in an Aether Space; return what you need. thought: one line shown to the person. If held, call again with wait. SDK:\n${SPACE_SDK_DECLARATION}`,
      inputSchema: AetherExecParamsSchema.shape,
    },
    (params) =>
      guard('aether_exec', async () => {
        const rendered = renderReport(await host.exec(params));
        return textResult(rendered.text, rendered.isError);
      }),
  );

  server.registerTool(
    'aether_screenshot',
    { description: 'Image of the page or one element.', inputSchema: AetherScreenshotParamsSchema.shape },
    (params) =>
      guard('aether_screenshot', async () => {
        const problem = screenshotParamsProblem(params);
        return problem ? textResult(problem, true) : outputResult(await browser.screenshot({ ref: params.ref }));
      }),
  );

  server.registerTool(
    'aether_spaces',
    { description: 'List Spaces, or focus or close one.', inputSchema: AetherSpacesParamsSchema.shape },
    (params) =>
      guard('aether_spaces', async () => {
        const problem = spacesParamsProblem(params);
        if (problem) return textResult(problem, true);
        if (params.op !== 'list') return textResult(`op=${params.op} needs the Aether app; with the Chrome extension every Space shares the one agent tab.`, true);
        const page = browser.pageInfo();
        const running = host.runningSpaces();
        return textResult(
          [`one agent tab${page ? `: ${page.url}` : ' (nothing open yet)'}`, running.length > 0 ? `running: ${running.join(', ')}` : 'no script running'].join('\n'),
        );
      }),
  );

  server.registerTool(
    'aether_done',
    { description: 'End the run with the result and evidence.', inputSchema: AetherDoneParamsSchema.shape },
    (params) =>
      guard('aether_done', async () => {
        const problem = doneParamsProblem(params);
        if (problem) return textResult(problem, true);
        const spaceId = spaceIdFromName(params.space);
        if (host.isRunning(spaceId)) return textResult(`a script is still running in Space "${params.space}"; wait for it before ending the run`, true);
        host.clearState(spaceId);
        return outputResult(browser.done({ result: params.result, evidence: params.evidence, success: params.success }));
      }),
  );

  return { server, host };
}
