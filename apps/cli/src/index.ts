#!/usr/bin/env node
import { runProbe } from './probe.js';
import { runDoctor } from './doctor.js';
import { runMcpServer } from './mcp/index.js';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'probe') {
    const url = args[1];
    if (!url) {
      console.error('Usage: aether probe <url> [--headed] [--text] [--find <query>]');
      process.exit(1);
    }
    const findIndex = args.indexOf('--find');
    try {
      await runProbe(url, {
        headless: !args.includes('--headed'),
        text: args.includes('--text'),
        find: findIndex >= 0 ? args[findIndex + 1] : undefined,
      });
    } catch (err) {
      console.error('Probe failed:', err);
      process.exit(1);
    }
  } else if (command === 'doctor') {
    process.exitCode = await runDoctor();
  } else if (command === 'mcp') {
    // stdout is the MCP protocol stream. Anything else printed there breaks the host's parser,
    // so ordinary console output goes to stderr for the life of the server.
    const toStderr = (...parts: unknown[]): void => {
      process.stderr.write(`${parts.map((part) => (typeof part === 'string' ? part : JSON.stringify(part))).join(' ')}\n`);
    };
    console.log = toStderr;
    console.info = toStderr;
    console.debug = toStderr;
    console.warn = toStderr;
    try {
      await runMcpServer({ headless: args.includes('--headless'), direct: args.includes('--direct') });
    } catch (err) {
      console.error('MCP server failed:', err);
      process.exit(1);
    }
  } else {
    console.log(`Aether: Authentic Agentic Browser Engine
Commands:
  probe <url> [--headed] [--text] [--find <q>]  Print the skim, token count and capture time for a page
  mcp [--direct] [--headless]  Start MCP over the extension bridge (or Direct CDP for tests)
  doctor                       Check the build, native host and extension connection
`);
  }
}

void main();
