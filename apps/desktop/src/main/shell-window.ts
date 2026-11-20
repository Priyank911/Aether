import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BaseWindow, screen, WebContentsView } from 'electron';
import type { MainDisplay } from './space-manager.js';

/*
 * The main window (plan 3.1, section 4.4): the shell view (tab strip and
 * toolbar) across the top, and the page view of the shown tab below it.
 * Step 4 adds the agent bar, the side panel and the overlay layer; this step
 * has the plain shell needed to browse and to test.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
/** Tab strip (40) + toolbar (44). The Agent bar adds AGENT_BAR_HEIGHT when shown. */
export const SHELL_HEIGHT = 84;
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
      titleBarOverlay: { color: '#DEE1E6', symbolColor: '#1B1D21', height: 40 },
      autoHideMenuBar: true,
      backgroundColor: '#DEE1E6',
    });
    this.shell = new WebContentsView({
      webPreferences: {
        preload: path.join(here, '..', 'preload', 'shell.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });
    this.shell.setBackgroundColor('#DEE1E6');
    this.window.contentView.addChildView(this.shell);
    // The shell never navigates away from its own page and never opens windows.
    this.shell.webContents.on('will-navigate', (event) => event.preventDefault());
    this.shell.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const renderer = path.join(here, '..', '..', 'renderer-dist', 'index.html');
    const shellPage = fs.existsSync(renderer) ? renderer : path.join(here, '..', '..', 'static', 'shell.html');
    void this.shell.webContents.loadFile(shellPage);
    this.overlay = new WebContentsView({
      webPreferences: {
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
    if (this.shown && !this.shown.webContents.isDestroyed()) {
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

  public viewportSize(): { width: number; height: number } {
    const { width, height } = this.window.getContentBounds();
    return { width, height: Math.max(1, height - this.chromeHeight()) };
  }

  private chromeHeight(): number {
    return SHELL_HEIGHT + (this.agentBar ? AGENT_BAR_HEIGHT : 0);
  }

  /** Attach the overlay only while it has interactive UI; detached it cannot eat page input. */
  public setOverlayOpen(open: boolean): void {
    if (this.overlayOpen === open) return;
    this.overlayOpen = open;
    this.layout();
  }

  private layout(): void {
    const { width, height } = this.window.getContentBounds();
    const chrome = this.chromeHeight();
    this.shell.setBounds({ x: 0, y: 0, width, height: chrome });
    const viewport = { x: 0, y: chrome, width, height: Math.max(1, height - chrome) };
    if (this.shown) this.shown.setBounds(viewport);
    if (this.overlayOpen) {
      this.overlay.setBounds(viewport);
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
