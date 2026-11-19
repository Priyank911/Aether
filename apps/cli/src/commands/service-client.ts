import { readFileSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import path from 'node:path';
import { DaemonConfigSchema, type DaemonConfig, type DaemonServerFrame, type ToolResult } from '@aether/shared';

/*
 * The client half of the app service (plan 3.2, section 4.2): read
 * daemon.json, connect, say hello with the token, and exchange request and
 * response frames, one JSON object per line. Requests on one connection may
 * overlap; responses carry the id.
 */

export function daemonFile(home: string): string {
  return path.join(home, 'daemon.json');
}

/** The running app's service config, or undefined when the app is not running. */
export function readServiceConfig(home: string): DaemonConfig | undefined {
  let raw: string;
  try {
    raw = readFileSync(daemonFile(home), 'utf8');
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const result = DaemonConfigSchema.safeParse(parsed);
  if (!result.success) return undefined;
  const config = result.data;
  try {
    // Signal 0 asks whether the process is alive without touching it.
    process.kill(config.pid, 0);
  } catch {
    return undefined;
  }
  return config;
}

export interface ServiceConnection {
  request(tool: string, params: unknown): Promise<ToolResult>;
  close(): void;
}

export function connectService(config: DaemonConfig, client: { name: string; version: string }): Promise<ServiceConnection> {
  return new Promise((resolve, reject) => {
    const socket: Socket = connect(config.endpoint);
    const pending = new Map<number, (result: ToolResult) => void>();
    let nextId = 0;
    let buffer = '';
    let authorized = false;
    const fail = (error: Error): void => {
      socket.destroy();
      reject(error);
    };
    socket.setEncoding('utf8');
    socket.once('error', (error: Error) => {
      if (!authorized) fail(new Error(`the app service did not answer: ${error.message}`));
      else socket.destroy();
    });
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      for (;;) {
        const end = buffer.indexOf('\n');
        if (end < 0) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        let frame: DaemonServerFrame;
        try {
          frame = JSON.parse(line) as DaemonServerFrame;
        } catch {
          fail(new Error('the app service sent a broken frame'));
          return;
        }
        if (frame.type === 'welcome') {
          authorized = true;
          resolve({
            request: (tool, params) =>
              new Promise<ToolResult>((resolveRequest) => {
                const id = ++nextId;
                pending.set(id, resolveRequest);
                socket.write(`${JSON.stringify({ type: 'request', id, tool, params })}\n`);
              }),
            close: () => socket.destroy(),
          });
          continue;
        }
        if (frame.type === 'response') {
          const waiter = pending.get(frame.id);
          pending.delete(frame.id);
          waiter?.(frame.result);
          continue;
        }
        fail(new Error(`the app service refused this client: ${frame.message}`));
        return;
      }
    });
    socket.write(`${JSON.stringify({ type: 'hello', protocol: config.version, token: config.token, client: { kind: 'cli', name: client.name, version: client.version } })}\n`);
  });
}
