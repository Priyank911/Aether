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
export const SHELL_HEIGHT = 76;

export interface ShellWindowOptions {
  /** Place the window beyond every display and show it without focus: for tests. */
  offscreen?: boolean;
}

export class ShellWindow implements MainDisplay {
  public readonly window: BaseWindow;
  public readonly shell: WebContentsView;
  private shown?: WebContentsView;
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
      backgroundColor: '#E8EBEF',
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
    this.shell.setBackgroundColor('#E8EBEF');
    this.window.contentView.addChildView(this.shell);
    // The shell never navigates away from its own page and never opens windows.
    this.shell.webContents.on('will-navigate', (event) => event.preventDefault());
    this.shell.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    void this.shell.webContents.loadFile(path.join(here, '..', '..', 'static', 'shell.html'));
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

  public viewportSize(): { width: number; height: number } {
    const { width, height } = this.window.getContentBounds();
    return { width, height: Math.max(1, height - SHELL_HEIGHT) };
  }

  private layout(): void {
    const { width, height } = this.window.getContentBounds();
    this.shell.setBounds({ x: 0, y: 0, width, height: SHELL_HEIGHT });
    const viewport = { x: 0, y: SHELL_HEIGHT, width, height: Math.max(1, height - SHELL_HEIGHT) };
    if (this.shown) this.shown.setBounds(viewport);
    for (const listener of this.resizeListeners) listener({ width: viewport.width, height: viewport.height });
  }
}
