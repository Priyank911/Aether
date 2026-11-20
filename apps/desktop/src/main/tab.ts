import { EventEmitter } from 'node:events';
import { WebContentsView } from 'electron';
import type { SpaceKind, TabRecord, TabState } from '@aether/shared';

/*
 * One tab (plan 3.1, section 5.2): a metadata record that is always there,
 * plus a page view only while the tab is live. Sleeping ("hibernated") keeps
 * the URL, title and scroll position and releases the page process. A
 * renderer crash affects only this tab: it becomes `crashed`, its view is
 * released, and it can be woken again.
 *
 * Events: 'changed' (record changed), 'opened' (the page asked for a new tab),
 * 'crashed' (reason), 'released' (the view is about to close).
 */

export interface TabOptions {
  id: string;
  spaceId: string;
  kind: SpaceKind;
  /** Electron session partition, e.g. persist:aether. */
  partition: string;
  url: string;
  title?: string;
  favicon?: string;
  scrollY?: number;
  lastViewedAt?: number;
}

const SCROLL_READ_MS = 500;

export class Tab extends EventEmitter {
  public readonly id: string;
  public spaceId: string;
  public kind: SpaceKind;
  public readonly partition: string;
  public url: string;
  public title: string;
  public favicon?: string;
  public scrollY: number;
  public lastViewedAt: number;
  public loading = false;
  public muted = false;
  public crashReason?: string;
  public loadFailure?: string;
  public authenticationRequired = false;
  public certificateRefused = false;
  /** When the page view was last created; 0 while asleep since start. */
  public wokenAt = 0;
  private current?: WebContentsView;
  private crashed = false;

  public constructor(options: TabOptions) {
    super();
    this.id = options.id;
    this.spaceId = options.spaceId;
    this.kind = options.kind;
    this.partition = options.partition;
    this.url = options.url;
    this.title = options.title ?? '';
    this.favicon = options.favicon;
    this.scrollY = options.scrollY ?? 0;
    this.lastViewedAt = options.lastViewedAt ?? Date.now();
  }

  public get view(): WebContentsView | undefined {
    return this.current;
  }

  public get state(): TabState {
    if (this.crashed) return 'crashed';
    if (!this.current) return 'hibernated';
    return this.loading ? 'loading' : 'live';
  }

  public get record(): TabRecord {
    return {
      id: this.id,
      spaceId: this.spaceId,
      url: this.url,
      title: this.title,
      ...(this.favicon ? { favicon: this.favicon } : {}),
      scrollY: this.scrollY,
      state: this.state,
      lastViewedAt: this.lastViewedAt,
    };
  }

  /** Create the page view and load the tab's URL, unless it is already live. */
  public wake(): WebContentsView {
    if (this.current) return this.current;
    this.crashed = false;
    this.crashReason = undefined;
    this.wokenAt = Date.now();
    const view = new WebContentsView({
      webPreferences: {
        partition: this.partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        plugins: true,
        // Agent pages must keep running timers while no one looks at them (spike S7).
        backgroundThrottling: this.kind === 'human',
        spellcheck: this.kind === 'human',
      },
    });
    view.setBackgroundColor('#ffffff');
    this.current = view;
    view.webContents.setAudioMuted(this.muted);
    this.wire(view);
    const target = this.url || 'about:blank';
    const restoreScroll = this.scrollY;
    view.webContents.loadURL(target).then(
      () => {
        if (restoreScroll > 0 && this.current === view) {
          void view.webContents.executeJavaScript(`window.scrollTo(0, ${Math.round(restoreScroll)})`).catch(() => undefined);
        }
      },
      () => {
        // A failed load keeps the tab with Chromium's error page; Step 4 adds Aether's own.
      },
    );
    this.loading = true;
    this.emit('changed');
    return view;
  }

  /** Release the page process, keeping URL, title and scroll position. */
  public async hibernate(): Promise<void> {
    const view = this.current;
    if (!view) return;
    if (!view.webContents.isDestroyed()) {
      const scroll = await Promise.race([
        view.webContents.executeJavaScript('Math.round(window.scrollY)').catch(() => undefined),
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), SCROLL_READ_MS)),
      ]);
      if (typeof scroll === 'number') this.scrollY = scroll;
    }
    this.release();
    this.emit('changed');
  }

  public navigate(url: string): void {
    this.url = url;
    this.loadFailure = undefined;
    if (this.current) void this.current.webContents.loadURL(url).catch(() => undefined);
    else this.wake();
    this.emit('changed');
  }

  public markViewed(): void {
    this.lastViewedAt = Date.now();
  }

  /** Close the view for good (tab closed or app quitting). */
  public close(): void {
    this.release();
    this.removeAllListeners();
  }

  private release(): void {
    const view = this.current;
    if (!view) return;
    this.emit('released', view);
    this.current = undefined;
    this.loading = false;
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }

  private wire(view: WebContentsView): void {
    const contents = view.webContents;
    contents.on('media-started-playing', () => this.emit('changed'));
    contents.on('media-paused', () => this.emit('changed'));
    contents.on('did-start-loading', () => {
      this.loading = true;
      this.emit('changed');
    });
    contents.on('did-stop-loading', () => {
      this.loading = false;
      this.emit('changed');
    });
    contents.on('page-title-updated', (_event, title) => {
      if (this.loadFailure) return;
      this.title = title;
      this.emit('changed');
    });
    const onNavigate = (_event: unknown, url: string): void => {
      if (url.startsWith('aether://error')) return;
      this.loadFailure = undefined;
      this.url = url;
      this.emit('changed');
    };
    contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (!isMainFrame || code === -3 || url.startsWith('aether:') || this.current !== view) return;
      this.loadFailure = description;
      this.url = url;
      this.loading = false;
      void contents.loadURL(`aether://error/?url=${encodeURIComponent(url)}&code=${code}`).catch(() => undefined);
      this.emit('changed');
    });
    contents.on('did-navigate', onNavigate);
    contents.on('did-navigate-in-page', onNavigate);
    contents.on('page-favicon-updated', (_event, favicons) => {
      this.favicon = favicons[0];
      this.emit('changed');
    });
    contents.on('render-process-gone', (_event, details) => {
      if (details.reason === 'clean-exit') return;
      this.crashed = true;
      this.crashReason = details.reason;
      this.release();
      this.crashed = true;
      this.emit('crashed', details.reason);
      this.emit('changed');
    });
    // A page that opens a window gets a new tab in the same Space instead (plan 3.1, section 9.7).
    contents.on('will-frame-navigate', (event) => {
      if (event.url.startsWith('aether:') && (!event.isMainFrame || !contents.getURL().startsWith('aether:'))) event.preventDefault();
    });
    contents.on('will-redirect', (event, url) => {
      if (!/^https?:/i.test(url)) event.preventDefault();
    });
    contents.on('will-navigate', (event, url) => {
      if (url.startsWith('aether:') && !contents.getURL().startsWith('aether:')) { event.preventDefault(); return; }
      if (!/^(https?|aether|about|blob|data|javascript):/i.test(url)) { event.preventDefault(); this.emit('external-protocol', url); return; }
      if (url.startsWith('aether://retry') && this.loadFailure) { event.preventDefault(); this.navigate(this.url); return; }
      if (!url.startsWith('aether://space/')) return;
      event.preventDefault();
      if (this.kind === 'human' && /^aether:\/\/newtab\/?$/.test(contents.getURL())) {
        try { this.emit('switch-space', decodeURIComponent(new URL(url).pathname.slice(1))); } catch { /* Malformed Space links are not followed. */ }
      }
    });
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) this.emit('opened', url);
      else this.emit('external-protocol', url);
      return { action: 'deny' };
    });
  }
}
