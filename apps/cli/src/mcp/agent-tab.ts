import type { CDPClient, CDPSession } from '@aether/cdp';
import { Actor, PageWatcher } from '@aether/actor';
import { Perceiver } from '@aether/perceiver';

export const NAVIGATION_TIMEOUT_MS = 30000;

/** One attached tab: its session and the perception, action and watch state for it. */
export class AgentTab {
  public readonly targetId: string;
  public readonly session: CDPSession;
  public readonly perceiver: Perceiver;
  public readonly actor: Actor;
  public readonly watcher: PageWatcher;

  private constructor(targetId: string, session: CDPSession, watcher: PageWatcher) {
    this.targetId = targetId;
    this.session = session;
    this.watcher = watcher;
    this.perceiver = new Perceiver(session);
    this.actor = new Actor(this.perceiver, watcher);
  }

  public static async attach(client: CDPClient, targetId: string): Promise<AgentTab> {
    const session = await client.attachToTarget(targetId);
    await session.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    await session.send('Page.enable');
    await session.send('DOM.enable');
    await session.send('Accessibility.enable');
    return new AgentTab(targetId, session, await PageWatcher.attach(session));
  }

  public get isAlive(): boolean {
    return !this.session.isDetached;
  }

  /** Navigate and wait for the load event, or the timeout on pages that never finish loading. */
  public async navigate(url: string): Promise<void> {
    const loaded = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, NAVIGATION_TIMEOUT_MS);
      this.session.once('Page.loadEventFired', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    const result = await this.session.send<{ errorText?: string }>('Page.navigate', { url }, NAVIGATION_TIMEOUT_MS);
    if (result.errorText) throw new Error(`navigation failed: ${result.errorText}`);
    await loaded;
  }

  public dispose(): void {
    this.watcher.dispose();
  }
}
