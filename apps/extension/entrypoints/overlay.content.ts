import { ConnectionStatusSchema, RunStateFrameSchema, type RunStateFrame } from '@aether/shared';
import { OVERLAY_CSS } from '../lib/overlay-style.js';

/** Must match OVERLAY_ATTRIBUTE in the perceiver, which keeps this element out of coverage checks. */
const OVERLAY_ATTRIBUTE = 'data-aether-overlay';
/** Dispatched by the engine before screenshots and before input that would land on the pill. */
const YIELD_EVENT = 'aether-overlay-yield';
const YIELD_MS = 1500;

interface View {
  host: HTMLElement;
  edge: HTMLElement;
  pill: HTMLElement;
  dot: HTMLElement;
  label: HTMLElement;
  actions: HTMLElement;
}

function build(): View {
  const host = document.createElement('aether-overlay');
  host.setAttribute(OVERLAY_ATTRIBUTE, '');
  host.setAttribute('aria-hidden', 'true');
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>${OVERLAY_CSS}</style><div class="edge"></div><div class="pill" role="status"><span class="dot"></span><span class="label"></span><span class="actions"></span></div>`;
  const pick = (selector: string): HTMLElement => {
    const element = root.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`overlay part ${selector} is missing`);
    return element;
  };
  return { host, edge: pick('.edge'), pill: pick('.pill'), dot: pick('.dot'), label: pick('.label'), actions: pick('.actions') };
}

function button(text: string, onClick: () => void, primary = false): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = text;
  if (primary) element.className = 'primary';
  element.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return element;
}

function send(message: unknown): void {
  void chrome.runtime.sendMessage(message).catch(() => undefined);
}

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    let view: View | undefined;
    let yieldTimer: ReturnType<typeof setTimeout> | undefined;

    const remove = (): void => {
      view?.host.remove();
      view = undefined;
    };

    const render = (frame: RunStateFrame | undefined): void => {
      if (!frame || frame.state === 'idle') {
        remove();
        return;
      }
      if (!view) {
        view = build();
        document.documentElement.append(view.host);
      }
      const waiting = frame.state === 'waiting_human';
      view.host.dataset.state = waiting ? 'waiting' : 'acting';
      view.label.textContent = waiting ? (frame.pending?.reason === 'user_interrupted' ? 'You have control' : 'Aether needs you in the side panel') : frame.label;
      view.actions.replaceChildren();
      if (waiting && frame.pending?.reason === 'user_interrupted') {
        const id = frame.pending.id;
        view.actions.append(button('Resume', () => send({ type: 'aether.reply', id, kind: 'resume' }), true));
      } else if (!waiting) {
        view.actions.append(
          button('Take over', () => send({ type: 'aether.control', kind: 'takeover' })),
          button('Stop', () => send({ type: 'aether.control', kind: 'stop' })),
        );
      }
    };

    document.addEventListener(YIELD_EVENT, () => {
      if (!view) return;
      view.host.style.visibility = 'hidden';
      if (yieldTimer) clearTimeout(yieldTimer);
      yieldTimer = setTimeout(() => {
        if (view) view.host.style.visibility = '';
      }, YIELD_MS);
    });

    chrome.runtime.onMessage.addListener((raw: unknown) => {
      const frame = RunStateFrameSchema.safeParse(raw);
      if (frame.success) {
        render(frame.data);
        return;
      }
      const connection = ConnectionStatusSchema.safeParse(raw);
      if (connection.success && connection.data.state !== 'connected') remove();
    });

    void chrome.runtime
      .sendMessage({ type: 'aether.panel.sync' })
      .then((response: unknown) => {
        const frame = RunStateFrameSchema.safeParse((response as { frame?: unknown } | undefined)?.frame);
        render(frame.success ? frame.data : undefined);
      })
      .catch(remove);
  },
});
