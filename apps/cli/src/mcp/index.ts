import { CDPClient } from '@aether/cdp';
import { createLogger, openDatabase } from '@aether/memory';
import type { MemoryCommand } from '@aether/shared';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ExtensionBridge } from './bridge.js';
import { MCPBrowserSession, type MCPBrowserSessionOptions } from './browser-session.js';
import { createAetherMcpServer } from './server.js';

export interface MCPServerOptions extends MCPBrowserSessionOptions {
  direct?: boolean;
}

/**
 * Real-profile mode: the extension connects to the bridge and carries CDP to
 * the agent tab. Direct mode: an isolated Chrome for deterministic tests.
 */
export async function runMcpServer(options: MCPServerOptions = {}): Promise<void> {
  let browser: MCPBrowserSession;
  let bridge: ExtensionBridge | undefined;
  if (options.direct) {
    browser = await MCPBrowserSession.launch(options);
  } else {
    bridge = new ExtensionBridge();
    await bridge.start();
    const client = CDPClient.over(bridge.transport);
    bridge.on('reset', (reason: string) => client.resetSessions(reason));
    const logger = createLogger();
    browser = await MCPBrowserSession.over(client, { database: openDatabase(), logger });
    bridge.attachRun(browser.run);
    const session = browser;
    const connectedBridge = bridge;
    bridge.on('memory', (command: MemoryCommand) => connectedBridge.publish(session.memoryCommand(command)));
    bridge.on('connected', () => logger.info('extension connected'));
    bridge.on('disconnected', (reason: string) => logger.warn({ reason }, 'extension disconnected'));
  }

  const server = createAetherMcpServer(browser);
  server.server.onclose = () => {
    void browser.close();
    void bridge?.close();
  };
  await server.connect(new StdioServerTransport());
  process.once('SIGINT', () => void server.close());
  process.once('SIGTERM', () => void server.close());
}

export { ExtensionBridge } from './bridge.js';
export { MCPBrowserSession } from './browser-session.js';
export { createAetherMcpServer } from './server.js';
