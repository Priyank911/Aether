#!/usr/bin/env node
import { runProbe } from './probe.js';
import { runDoctor } from './doctor.js';
import { runMcpServer } from './mcp/index.js';
import { EXIT } from './commands/aether-home.js';
import { runDone, runExec, runScreenshot, runSpaces, runStatus, runWait } from './commands/run-service.js';
import { runSkill } from './commands/skill.js';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'exec') {
    process.exitCode = await runExec(args.slice(1));
  } else if (command === 'wait') {
    process.exitCode = await runWait(args.slice(1));
  } else if (command === 'screenshot') {
    process.exitCode = await runScreenshot(args.slice(1));
  } else if (command === 'spaces') {
    process.exitCode = await runSpaces(args.slice(1));
  } else if (command === 'done') {
    process.exitCode = await runDone(args.slice(1));
  } else if (command === 'skill') {
    process.exitCode = runSkill();
  } else if (command === 'status') {
    process.exitCode = await runStatus();
  } else if (command === 'probe') {
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
  } else if (
    command === 'mcp' ||
    args.includes('mcp') ||
    args.includes('--direct') ||
    args.includes('--headless') ||
    (args.length === 0 && !process.stdin.isTTY)
  ) {
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
      // --codemode is accepted and ignored: Code Mode is the only surface now.
      await runMcpServer({ headless: args.includes('--headless'), direct: args.includes('--direct') });
    } catch (err) {
      console.error('MCP server failed:', err);
      process.exit(1);
    }
  } else {
    console.log(`Aether: Authentic Agentic Browser Engine
${usageText()}

Exit codes: 0 done, 1 the run failed, 2 held (a token is printed), 3 the app could not be reached, 4 bad usage.`);
    process.exitCode = EXIT.usage;
  }
}

function usageText(): string {
  return [
    'Commands:',
    '  exec --space <name> --thought <line> [--file <script.ts>]  Run one TypeScript script in an Agent Space',
    '  wait <token>                   Keep waiting on a held run',
    '  screenshot --space <name> [--ref <ref>] [--out <file.png>]',
    '  spaces [list | focus <name> | close <name>]',
    '  done --space <name> --success <yes|no> --result <text> [--evidence <text>]',
    '  skill                          Print the working method and the space SDK',
    '  status                         Is the app running, which Spaces are busy',
    '  probe <url> [--headed] [--text] [--find <q>]   Print the skim for a page',
    '  mcp [--direct] [--headless]    Start the Code Mode MCP server over the app service or Direct CDP',
    '  doctor                         Check the install, PATH, links and the service',
  ].join('\n');
}

void main();
