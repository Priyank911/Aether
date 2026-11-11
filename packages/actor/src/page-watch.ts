import type { CDPSession } from '@aether/cdp';

export interface OpenDialog {
  type: string;
  message: string;
  defaultPrompt?: string;
}

interface FrameEvent {
  frame: { id: string; parentId?: string };
}

/**
 * Follows main-frame navigation and JavaScript dialogs for one tab. A dialog
 * blocks the renderer, so nothing else may be sent to the page while one is open.
 */
export class PageWatcher {
  public dialog?: OpenDialog;
  public navigations = 0;
  public loading = false;
  private readonly session: CDPSession;
  private readonly listeners: Array<[string, (params: unknown) => void]> = [];

  constructor(session: CDPSession) {
    this.session = session;
    this.on('Page.javascriptDialogOpening', (params: OpenDialog) => {
      this.dialog = { type: params.type, message: params.message, defaultPrompt: params.defaultPrompt };
    });
    this.on('Page.javascriptDialogClosed', () => {
      this.dialog = undefined;
    });
    this.on('Page.frameNavigated', (params: FrameEvent) => {
      if (params.frame.parentId) return;
      this.mainFrameId = params.frame.id;
      this.navigations++;
    });
    this.on('Page.frameStartedLoading', (params: { frameId: string }) => {
      if (this.isMainFrame(params.frameId)) this.loading = true;
    });
    this.on('Page.frameStoppedLoading', (params: { frameId: string }) => {
      if (this.isMainFrame(params.frameId)) this.loading = false;
    });
    this.on('Page.loadEventFired', () => {
      this.loading = false;
    });
  }

  private mainFrameId?: string;

  /** Create a watcher and learn the main frame id from the frame tree. */
  public static async attach(session: CDPSession): Promise<PageWatcher> {
    const watcher = new PageWatcher(session);
    try {
      const tree = await session.send<{ frameTree: { frame: { id: string } } }>('Page.getFrameTree');
      watcher.mainFrameId ??= tree.frameTree.frame.id;
    } catch {
      // Learned from the next top-level navigation instead.
    }
    return watcher;
  }

  private isMainFrame(frameId: string): boolean {
    return frameId === (this.mainFrameId ?? this.session.targetId);
  }

  private on<T>(event: string, handler: (params: T) => void): void {
    // CDP event payloads are typed by the caller; the emitter only sees unknown.
    const wrapped = (params: unknown): void => handler(params as T);
    this.session.on(event, wrapped);
    this.listeners.push([event, wrapped]);
  }

  public dispose(): void {
    for (const [event, handler] of this.listeners) this.session.off(event, handler);
  }

  /** Resolve when loading stops, or after the timeout. */
  public async untilLoaded(timeoutMs: number): Promise<boolean> {
    const started = Date.now();
    while (this.loading && Date.now() - started < timeoutMs) {
      if (this.dialog) return false;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return !this.loading;
  }
}
