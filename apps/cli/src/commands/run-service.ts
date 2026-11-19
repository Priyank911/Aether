import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spaceIdFromName } from '@aether/shared';
import { EXIT, finish, flags, readScript, withService, aetherHome } from './aether-home.js';

const CLIENT = { name: 'aether command', version: '0.3.0' };

/*
 * The service commands (plan 3.2, task 3.5): exec, wait, screenshot, spaces,
 * done, status. Output is the same text the MCP tools return, so the method
 * reads the same in both. Screenshots are written under ~/.aether/screenshots
 * unless --out names a file.
 */

export function usage(): string {
  return [
    'Usage:',
    '  aether exec --space <name> --thought <line> [--file <script.ts>]   script on stdin when no --file',
    '  aether wait <token>                                keep waiting on a held run',
    '  aether screenshot --space <name> [--ref <ref>] [--out <file.png>]',
    '  aether spaces [list | focus <name> | close <name>]',
    '  aether done --space <name> --success <yes|no> --result <text> [--evidence <text>]',
    '  aether skill                                       print the working method and the space SDK',
    '  aether install-skill | uninstall-skill             manage the host skill links',
    '  aether status                                      is the app running, which Spaces are busy',
  ].join('\n');
}

export async function runExec(args: string[]): Promise<number> {
  const parsed = flags(args);
  const thought = typeof parsed.thought === 'string' ? parsed.thought : undefined;
  const space = typeof parsed.space === 'string' ? parsed.space : undefined;
  const file = typeof parsed.file === 'string' ? parsed.file : undefined;
  if (!thought) {
    process.stderr.write('aether exec needs --thought: one line shown to the person\n');
    return EXIT.usage;
  }
  const code = readScript(file);
  if (code === undefined) return EXIT.usage;
  if (!code.trim()) {
    process.stderr.write('aether exec needs a script on stdin or --file <script.ts>\n');
    return EXIT.usage;
  }
  return withService(CLIENT, async (connection) => finish(await connection.request('aether_exec', { ...(space ? { space } : {}), thought, code })));
}

export async function runWait(args: string[]): Promise<number> {
  const token = args[0];
  if (!token || token.startsWith('--')) {
    process.stderr.write('aether wait needs the held token: aether wait <token>\n');
    return EXIT.usage;
  }
  return withService(CLIENT, async (connection) => finish(await connection.request('aether_exec', { thought: 'Waiting for the result', wait: token })));
}

export async function runScreenshot(args: string[]): Promise<number> {
  const parsed = flags(args);
  const space = typeof parsed.space === 'string' ? parsed.space : undefined;
  if (!space) {
    process.stderr.write('aether screenshot needs --space <name>\n');
    return EXIT.usage;
  }
  const ref = typeof parsed.ref === 'string' ? parsed.ref : undefined;
  return withService(CLIENT, async (connection) => {
    const result = await connection.request('aether_screenshot', { space, ...(ref ? { ref } : {}) });
    const image = result.images?.[0];
    if (!image) return finish(result);
    const out = typeof parsed.out === 'string' ? parsed.out : path.join(aetherHome(), 'screenshots', `${spaceIdFromName(space)}-${Date.now()}.png`);
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, Buffer.from(image.data, 'base64'));
    process.stdout.write(`${out}\n`);
    return EXIT.done;
  });
}

export async function runSpaces(args: string[]): Promise<number> {
  const op = args[0] ?? 'list';
  if (op !== 'list' && op !== 'focus' && op !== 'close') {
    process.stderr.write("aether spaces takes 'list', 'focus <name>' or 'close <name>'\n");
    return EXIT.usage;
  }
  const space = op === 'list' ? undefined : args[1];
  if (op !== 'list' && !space) {
    process.stderr.write(`aether spaces ${op} needs a Space name\n`);
    return EXIT.usage;
  }
  return withService(CLIENT, async (connection) => finish(await connection.request('aether_spaces', { op, ...(space ? { space } : {}) })));
}

export async function runDone(args: string[]): Promise<number> {
  const parsed = flags(args);
  const space = typeof parsed.space === 'string' ? parsed.space : undefined;
  const success = parsed.success === 'yes' ? true : parsed.success === 'no' ? false : undefined;
  const result = typeof parsed.result === 'string' ? parsed.result : undefined;
  const evidence = typeof parsed.evidence === 'string' ? parsed.evidence : undefined;
  if (!space || success === undefined || !result) {
    process.stderr.write('aether done needs --space <name> --success <yes|no> --result <text>\n');
    return EXIT.usage;
  }
  return withService(CLIENT, async (connection) => finish(await connection.request('aether_done', { space, success, result, ...(evidence ? { evidence } : {}) })));
}

export async function runStatus(): Promise<number> {
  return withService(CLIENT, async (connection) => {
    const result = await connection.request('aether_spaces', { op: 'list' });
    process.stdout.write(`${result.text}\n`);
    return EXIT.done;
  });
}
