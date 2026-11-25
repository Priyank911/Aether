import { BaseWindow, screen, type WebContentsView } from 'electron';

/*
 * The agent host window (plan 3.1, section 5.2; spike S7). A page view only
 * renders while it is attached to a shown window: detached or hidden views get
 * no trusted input, no IntersectionObserver, no lazy images and no
 * screenshots. Live Agent tabs that the person is not looking at therefore sit
 * here: a window shown without activation, placed beyond every display, with
 * no taskbar entry, that cannot take focus or mouse input.
 * On Linux (Wayland), child window parenting and opacity masking prevent creating
 * an unwanted toplevel desktop surface.
 */

const GAP = 200;

function beyondEveryDisplay(width: number): { x: number; y: number } {
  const displays = screen.getAllDisplays();
  const left = Math.min(...displays.map((display) => display.bounds.x));
  const top = Math.min(...displays.map((display) => display.bounds.y));
  return { x: left - width - GAP, y: top };
}

export class AgentHost {
  private readonly window: BaseWindow;
  private readonly views = new Set<WebContentsView>();

  public constructor(size: { width: number; height: number }, parentWindow?: BaseWindow) {
    const isLinux = process.platform === 'linux';
    const { x, y } = beyondEveryDisplay(size.width);
    this.window = new BaseWindow({
      x: isLinux ? 0 : x,
      y: isLinux ? 0 : y,
      width: size.width,
      height: size.height,
      useContentSize: true,
      show: false,
      frame: false,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      title: 'Aether agent tabs',
      ...(isLinux && parentWindow ? { parent: parentWindow, transparent: true, opacity: 0 } : {}),
    });
    this.window.setIgnoreMouseEvents(true);
    this.window.showInactive();
    if (isLinux) {
      try {
        this.window.setOpacity(0);
      } catch {
        // Platform fallback
      }
    }
    // Displays can change while the app runs (a monitor plugged in); stay beyond all of them.
    if (!isLinux) {
      screen.on('display-added', () => this.reposition());
      screen.on('display-metrics-changed', () => this.reposition());
    }
  }

  public add(view: WebContentsView): void {
    if (this.window.isDestroyed() || view.webContents.isDestroyed() || this.views.has(view)) return;
    const { width, height } = this.window.getContentBounds();
    view.setBounds({ x: 0, y: 0, width, height });
    this.window.contentView.addChildView(view);
    this.views.add(view);
  }

  public remove(view: WebContentsView): void {
    if (!this.views.delete(view)) return;
    if (!this.window.isDestroyed()) {
      try {
        this.window.contentView.removeChildView(view);
      } catch {
        // Already removed
      }
    }
  }

  public holds(view: WebContentsView): boolean {
    return this.views.has(view);
  }

  /** Keep agent pages the size of the main viewport, so layout matches what the person would see. */
  public resize(width: number, height: number): void {
    if (this.window.isDestroyed()) return;
    this.window.setContentSize(Math.max(320, width), Math.max(240, height));
    for (const view of this.views) {
      if (!view.webContents.isDestroyed()) view.setBounds({ x: 0, y: 0, width, height });
    }
    this.reposition();
  }

  public destroy(): void {
    if (!this.window.isDestroyed()) this.window.destroy();
  }

  private reposition(): void {
    if (this.window.isDestroyed() || process.platform === 'linux') return;
    const { width } = this.window.getBounds();
    const { x, y } = beyondEveryDisplay(width);
    this.window.setPosition(x, y);
  }
}
