import { spawn } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/** The command docs/SETUP.md tells MCP hosts to run. */
const ENTRY = path.resolve('apps/cli/dist/index.js');

describe('MCP launch as documented for hosts', () => {
  it('writes nothing but JSON-RPC to stdout, starting with the first byte', async () => {
    const child = spawn(process.execPath, [ENTRY, 'mcp', '--direct', '--headless'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const firstLine = new Promise<string>((resolve, reject) => {
      let buffer = '';
      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const end = buffer.indexOf('\n');
        if (end >= 0) resolve(buffer.slice(0, end));
      });
      child.once('exit', (code) => reject(new Error(`server exited with ${code} before replying`)));
    });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'launch-test', version: '1' } } })}\n`,
    );
    try {
      const line = await firstLine;
      expect(line.startsWith('{')).toBe(true);
      expect(JSON.parse(line)).toMatchObject({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'aether' } } });
    } finally {
      // Shut down the way a host does, by closing stdin; the server must exit and take its Chrome with it.
      const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));
      child.stdin.end();
      expect(await exited).toBe(0);
    }
  }, 45000);

  it('lists the eight tools through the compiled entry point', async () => {
    const client = new Client({ name: 'launch-test', version: '1.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [ENTRY, 'mcp', '--direct', '--headless'], stderr: 'inherit' }));
    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual(['act', 'ask', 'done', 'find', 'look', 'memory', 'open', 'screenshot']);
    } finally {
      await client.close().catch(() => undefined);
    }
  }, 45000);
});
