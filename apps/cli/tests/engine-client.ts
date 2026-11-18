import type { MCPBrowserSession, ToolOutput } from '@aether/engine';
import { toToolResult } from '@aether/engine';

/**
 * Test-only: the engine operations Code Mode is built on (open, look, find,
 * act, screenshot, ask, memory, done), called on the session directly and
 * rendered as tool text. These were the 2.0 MCP tools; hosts now reach them
 * only through aether_exec scripts, but their behaviour is still the base of
 * every space.* call, so the tests keep exercising them one by one.
 */
export interface EngineClient {
  callTool(request: { name: string; arguments?: Record<string, unknown> }): Promise<{ content: unknown; isError?: boolean }>;
}

async function run(session: MCPBrowserSession, name: string, params: never): Promise<ToolOutput> {
  switch (name) {
    case 'open':
      return session.open(params);
    case 'look':
      return session.look(params);
    case 'find':
      return session.find(params);
    case 'act':
      return session.act(params);
    case 'screenshot':
      return session.screenshot(params);
    case 'ask':
      return session.ask(params);
    case 'memory':
      return session.memory(params);
    case 'done':
      return session.done(params);
    default:
      throw new Error(`no engine operation named ${name}`);
  }
}

export function engineClient(session: MCPBrowserSession): EngineClient {
  return {
    async callTool({ name, arguments: args = {} }) {
      // The schemas validate inside each operation; the test passes arguments through unchanged.
      const params = args as never;
      const started = Date.now();
      let output: ToolOutput;
      try {
        output = await run(session, name, params);
      } catch (error) {
        output = { notes: [error instanceof Error ? error.message : String(error)], isError: true };
      }
      const result = toToolResult(output);
      const text = result.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
      // One run-log row per operation, as aether_exec records one per script.
      if (name !== 'done') session.recordStep(name, output, Math.ceil(text.length / 3.5), Date.now() - started);
      return result;
    },
  };
}
