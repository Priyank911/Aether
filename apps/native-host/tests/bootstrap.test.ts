import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NativeBootstrapHost } from '../src/bootstrap.js';
import { NativeMessageDecoder } from '../src/framing.js';

describe('native host bootstrap', () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it('reports the bridge address, reports again only on change, and reports when it is gone', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'aether-native-'));
    const configPath = path.join(directory, 'bridge.json');
    const decoder = new NativeMessageDecoder();
    const sent: unknown[] = [];
    const host = new NativeBootstrapHost(configPath, (frame) => {
      for (const message of decoder.push(frame)) sent.push(JSON.parse(message));
    });

    await host.report();
    expect(sent).toEqual([{ type: 'aether.bridge.gone' }]);

    const token = 'a'.repeat(64);
    await writeFile(configPath, JSON.stringify({ port: 40123, token }));
    await host.report();
    await host.report();
    expect(sent).toEqual([{ type: 'aether.bridge.gone' }, { type: 'aether.bridge', port: 40123, token }]);

    await rm(configPath);
    await host.report();
    expect(sent.at(-1)).toEqual({ type: 'aether.bridge.gone' });
    host.close();
  });
});
