import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BaseWindow, nativeTheme, screen, WebContentsView } from 'electron';
import type { MainDisplay } from './space-manager.js';

/*
 * The main window (plan 3.1, section 4.4): the shell view (tab strip and
 * toolbar) across the top, and the page view of the shown tab below it.
 * Step 4 adds the agent bar, the side panel and the overlay layer; this step
 * has the plain shell needed to browse and to test.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
/** Plan 10.1: tab strip (36) + toolbar (40); tested against renderer geometry. */
export const SHELL_HEIGHT = 76;
/** The Agent bar row (plan 3.2, task 3.3); the Phase 4 layout reserves it always. */
export const AGENT_BAR_HEIGHT = 32;

export interface ShellWindowOptions {
  /** Place the window beyond every display and show it without focus: for tests. */
  offscreen?: boolean;
}

export class ShellWindow implements MainDisplay {
  public readonly window: BaseWindow;
  public readonly shell: WebContentsView;
  /** Transparent layer over the page viewport: suggestions, shield, ghost cursor, toasts (plan 3.1, section 10.3). */
  public readonly overlay: WebContentsView;
  private shown?: WebContentsView;
  private agentBar = false;
  private overlayOpen = false;
  private overlayMode: 'full' | 'find' | 'toast' | 'prompt' = 'full';
  private agentFrame = false;
  private bookmarksBar = false;
  private placeholder = false;
  private internalPage = false;
  private fullscreen = false;
  private panelOpen = false;
  private preferredPanelWidth = 320;
  private readonly resizeListeners: Array<(size: { width: number; height: number }) => void> = [];

  public constructor(options: ShellWindowOptions = {}) {
    const width = 1280;
    const height = 860;
    const displays = screen.getAllDisplays();
    const left = Math.min(...displays.map((display) => display.bounds.x));
    this.window = new BaseWindow({
      width,
      height,
      minWidth: 640,
      minHeight: 420,
      ...(options.offscreen ? { x: left - width - 400, y: 0 } : {}),
      show: false,
      title: 'Aether',
      // Chrome-like: no native title bar or menu; the caption buttons float
      // over the right end of the tab strip (plan 3.1, section 10.2).
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: nativeTheme.shouldUseDarkColors ? '#1B1C1F' : '#E8EBEF', symbolColor: nativeTheme.shouldUseDarkColors ? '#E8EAED' : '#1B1D21', height: 36 },
      autoHideMenuBar: true,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1B1C1F' : '#E8EBEF',
    });
    this.shell = new WebContentsView({
      webPreferences: {
        backgroundThrottling: false,
        preload: path.join(here, '..', 'preload', 'shell.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });
    this.shell.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#1B1C1F' : '#E8EBEF');
    const syncCaptionTheme = () => {
      if (this.window.isDestroyed()) return;
      if (process.platform !== 'darwin') this.window.setTitleBarOverlay({
        color: nativeTheme.shouldUseDarkColors ? '#1B1C1F' : '#E8EBEF',
        symbolColor: nativeTheme.shouldUseDarkColors ? '#E8EAED' : '#1B1D21',
        height: 36,
      });
    };
    nativeTheme.on('updated', syncCaptionTheme);
    this.window.once('closed', () => nativeTheme.removeListener('updated', syncCaptionTheme));
    this.window.contentView.addChildView(this.shell);
    // The shell never navigates away from its own page and never opens windows.
    this.shell.webContents.on('will-navigate', (event) => event.preventDefault());
    this.shell.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const renderer = path.join(here, '..', '..', 'renderer-dist', 'index.html');
    const shellPage = fs.existsSync(renderer) ? renderer : path.join(here, '..', '..', 'static', 'shell.html');
    void this.shell.webContents.loadFile(shellPage);
    this.overlay = new WebContentsView({
      webPreferences: {
        backgroundThrottling: false,
        preload: path.join(here, '..', 'preload', 'shell.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });
    this.overlay.setBackgroundColor('#00000000');
    const overlayPage = path.join(here, '..', '..', 'renderer-dist', 'overlay.html');
    if (fs.existsSync(overlayPage)) {
      this.overlay.webContents.on('will-navigate', (event) => event.preventDefault());
      this.overlay.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      // A WebContentsView has no click-through API: it is attached only while
      // the overlay has interactive UI, so it never swallows page input.
      void this.overlay.webContents.loadFile(overlayPage);
    }
    this.window.on('resize', () => this.layout());
    this.layout();
    if (options.offscreen) this.window.showInactive();
    else this.window.show();
  }

  public onResize(listener: (size: { width: number; height: number }) => void): void {
    this.resizeListeners.push(listener);
  }

  public show(view: WebContentsView | undefined): void {
    if (this.shown === view) return;
    if (this.shown) {
      try {
        this.window.contentView.removeChildView(this.shown);
      } catch {
        // Already removed with its tab.
      }
    }
    this.shown = view;
    if (view) {
      this.window.contentView.addChildView(view);
      this.layout();
    }
  }

  public isShowing(view: WebContentsView): boolean {
    return this.shown === view;
  }

  /** Show or hide the interim Agent bar row; the page view gives back the space. */
  public setAgentBar(visible: boolean): void {
    if (this.agentBar === visible) return;
    this.agentBar = visible;
    this.layout();
  }

  public setBookmarksBar(visible: boolean): void {
    if (this.bookmarksBar === visible) return;
    this.bookmarksBar = visible;
    this.layout();
  }

  public setInternalPage(visible: boolean): void {
    if (this.internalPage === visible) return;
    this.internalPage = visible;
    this.layout();
  }

  public setPlaceholder(visible: boolean): void {
    if (this.placeholder === visible) return;
    this.placeholder = visible;
    this.layout();
  }

  public setPageFullscreen(fullscreen: boolean): void {
    this.fullscreen = fullscreen;
    this.window.setFullScreen(fullscreen);
    this.layout();
  }

  public setAgentFrame(visible: boolean): void {
    if (this.agentFrame === visible) return;
    this.agentFrame = visible;
    this.layout();
  }

  public setPanelOpen(open: boolean): void {
    if (this.panelOpen === open) return;
    this.panelOpen = open;
    this.layout();
  }

  public setPanelWidth(width: number): void {
    this.preferredPanelWidth = Math.min(480, Math.max(280, width));
    this.layout();
  }

  public panelWidth(): number {
    const { width } = this.window.getContentBounds();
    return this.panelOpen && !this.fullscreen ? Math.min(this.preferredPanelWidth, Math.max(280, width - 280)) : 0;
  }

  public viewportSize(): { width: number; height: number } {
    const { width, height } = this.window.getContentBounds();
    return { width: Math.max(1, width - this.panelWidth()), height: Math.max(1, height - this.chromeHeight()) };
  }

  public chromeHeight(): number {
    return this.fullscreen ? 0 : SHELL_HEIGHT + (this.bookmarksBar ? 28 : 0) + (this.agentBar ? AGENT_BAR_HEIGHT : 0);
  }

  /** Attach the overlay only while it has interactive UI; detached it cannot eat page input. */
  public setOverlayOpen(open: boolean, mode: 'full' | 'find' | 'toast' | 'prompt' = 'full'): void {
    if (this.overlayOpen === open && this.overlayMode === mode) return;
    this.overlayOpen = open;
    this.overlayMode = mode;
    this.layout();
  }

  private layout(): void {
    const { width, height } = this.window.getContentBounds();
    const chrome = this.chromeHeight();
    this.shell.setBounds({ x: 0, y: 0, width, height: this.panelOpen || this.agentFrame || this.placeholder || this.internalPage ? height : chrome });
    const viewport = { x: 0, y: chrome, width: Math.max(1, width - this.panelWidth()), height: Math.max(1, height - chrome) };
    const inset = this.agentFrame ? 2 : 0;
    if (this.shown) {
      this.shown.setBounds({ x: inset, y: chrome + inset, width: Math.max(1, viewport.width - inset * 2), height: Math.max(1, viewport.height - inset * 2) });
      if (this.internalPage) {
        if (this.window.contentView.children.includes(this.shown)) this.window.contentView.removeChildView(this.shown);
      } else if (!this.window.contentView.children.includes(this.shown)) this.window.contentView.addChildView(this.shown);
    }
    if (this.overlayOpen) {
      const overlayWidth = Math.min(440, viewport.width);
      const overlayHeight = this.overlayMode === 'prompt' ? 320 : this.overlayMode === 'find' ? 64 : 72;
      this.overlay.setBounds(this.overlayMode === 'full' ? viewport : {
        x: this.overlayMode === 'prompt' ? Math.min(96, viewport.width - overlayWidth) : viewport.width - overlayWidth,
        y: this.overlayMode === 'toast' ? Math.max(chrome, height - overlayHeight) : chrome,
        width: overlayWidth, height: Math.min(overlayHeight, viewport.height),
      });
      // Re-adding keeps the overlay above whichever page view is shown.
      this.window.contentView.addChildView(this.overlay);
    } else {
      try {
        this.window.contentView.removeChildView(this.overlay);
      } catch {
        // Not attached.
      }
    }
    for (const listener of this.resizeListeners) listener({ width: viewport.width, height: viewport.height });
  }
}
