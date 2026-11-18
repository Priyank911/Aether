import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { CDPClient, ElectronDebuggerTransport, type DebuggerLike } from '@aether/cdp';

/** A stand-in for Electron's webContents.debugger: records commands, emits events on request. */
class FakeDebugger extends EventEmitter implements DebuggerLike {
  public attached = false;
  public readonly commands: Array<{ method: string; params: unknown; sessionId?: string }> = [];

  public attach(): void {
    if (this.attached) throw new Error('already attached');
    this.attached = true;
  }

  public isAttached(): boolean {
    return this.attached;
  }

  public detach(): void {
    this.attached = false;
  }

  public async sendCommand(method: string, params?: unknown, sessionId?: string): Promise<unknown> {
    if (!this.attached) throw new Error('not attached');
    this.commands.push({ method, params, sessionId });
    if (method === 'Runtime.evaluate') return { result: { value: sessionId ? `child:${sessionId}` : 'root' } };
    return {};
  }

  public event(method: string, params: unknown, sessionId = ''): void {
    this.emit('message', {}, method, params, sessionId);
  }
}

function setup(): { transport: ElectronDebuggerTransport; client: CDPClient; tab: FakeDebugger } {
  const transport = new ElectronDebuggerTransport();
  const client = CDPClient.over(transport);
  const tab = new FakeDebugger();
  transport.addTarget('t1', tab, () => ({ title: 'Shop', url: 'https://shop.example/' }));
  return { transport, client, tab };
}

describe('Electron debugger transport', () => {
  it('lists registered tabs as page targets and attaches on demand', async () => {
    const { client, tab } = setup();
    const targets = await client.sendCommand<{ targetInfos: Array<{ targetId: string; url: string; attached: boolean }> }>('Target.getTargets');
    expect(targets.targetInfos).toEqual([{ targetId: 't1', type: 'page', title: 'Shop', url: 'https://shop.example/', attached: false }]);
    expect(tab.attached).toBe(false);
    const session = await client.attachToTarget('t1');
    expect(tab.attached).toBe(true);
    expect(session.sessionId).toBe('tab-t1');
    const value = await session.send<{ result: { value: string } }>('Runtime.evaluate', { expression: '1' });
    expect(value.result.value).toBe('root');
    expect(tab.commands.at(-1)).toEqual({ method: 'Runtime.evaluate', params: { expression: '1' }, sessionId: undefined });
  });

  it('routes child sessions from auto-attach to the tab that owns them, and their events back', async () => {
    const { client, tab } = setup();
    const root = await client.attachToTarget('t1');
    const children: string[] = [];
    client.on('sessionAttached', (session: { sessionId: string }) => children.push(session.sessionId));
    tab.event('Target.attachedToTarget', { sessionId: 'frame-7', targetInfo: { targetId: 'frame-7', type: 'iframe', url: 'https://ads.example/' }, waitingForDebugger: false }, '');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(children).toEqual(['frame-7']);
    const reply = await client.sendCommand<{ result: { value: string } }>('Runtime.evaluate', { expression: '2' }, 'frame-7');
    expect(reply.result.value).toBe('child:frame-7');
    const seen: string[] = [];
    root.on('Page.loadEventFired', () => seen.push('root load'));
    tab.event('Page.loadEventFired', { timestamp: 1 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(seen).toEqual(['root load']);
  });

  it('ends every session of a tab that goes to sleep, and refuses commands to it afterwards', async () => {
    const { transport, client, tab } = setup();
    const root = await client.attachToTarget('t1');
    tab.event('Target.attachedToTarget', { sessionId: 'frame-9', targetInfo: { targetId: 'frame-9', type: 'iframe' } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    transport.removeTarget('t1', 'tab asleep');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(root.isDetached).toBe(true);
    expect(tab.attached).toBe(false);
    await expect(client.sendCommand('Runtime.evaluate', {}, 'frame-9')).rejects.toThrow(/No session with id frame-9/);
    await expect(client.attachToTarget('t1')).rejects.toThrow(/No target with id t1/);
  });

  it('refuses browser-level calls that only the Space manager may make', async () => {
    const { client } = setup();
    await expect(client.sendCommand('Target.createTarget', { url: 'https://x.example/' })).rejects.toThrow(/Space manager/);
    await expect(client.sendCommand('Browser.getVersion')).rejects.toThrow(/not available at browser level/);
  });
});
