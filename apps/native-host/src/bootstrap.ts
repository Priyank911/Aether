import { readFile } from 'node:fs/promises';
import { watchFile, unwatchFile } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { BridgeConfigSchema, NativeBootstrapSchema, type NativeBootstrap } from '@aether/shared';
import { encodeNativeMessage } from './framing.js';

const POLL_MS = 1000;

/**
 * The native host's only job: tell the extension where the engine listens and
 * with which token, and tell it again whenever ~/.aether/bridge.json changes or
 * goes away. No CDP traffic passes through native messaging, so its 1 MiB
 * message cap never applies to page data.
 */
export class NativeBootstrapHost {
  private readonly configPath: string;
  private readonly write: (frame: Buffer) => void;
  private last = '';
  private closed = false;

  constructor(configPath = path.join(homedir(), '.aether', 'bridge.json'), write: (frame: Buffer) => void = (frame) => process.stdout.write(frame)) {
    this.configPath = configPath;
    this.write = write;
  }

  public async start(): Promise<void> {
    await this.report();
    watchFile(this.configPath, { interval: POLL_MS }, () => void this.report());
    process.stdin.on('data', () => undefined);
    process.stdin.on('end', () => this.close());
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    unwatchFile(this.configPath);
  }

  /** Read the bridge config and send it if it changed since the last report. */
  public async report(): Promise<NativeBootstrap> {
    let message: NativeBootstrap;
    try {
      const config = BridgeConfigSchema.parse(JSON.parse(await readFile(this.configPath, 'utf8')));
      message = { type: 'aether.bridge', port: config.port, token: config.token };
    } catch {
      message = { type: 'aether.bridge.gone' };
    }
    const encoded = JSON.stringify(NativeBootstrapSchema.parse(message));
    if (encoded !== this.last && !this.closed) {
      this.last = encoded;
      this.write(encodeNativeMessage(encoded));
    }
    return message;
  }
}
