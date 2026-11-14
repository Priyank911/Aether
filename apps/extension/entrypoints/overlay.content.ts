import { ConnectionStatusSchema, RunStateFrameSchema, type RunStateFrame } from '@aether/shared';
import { OVERLAY_CSS } from '../lib/overlay-style.js';

/** Must match OVERLAY_ATTRIBUTE in the perceiver, which keeps this element out of coverage checks. */
const OVERLAY_ATTRIBUTE = 'data-aether-overlay';
/** Dispatched by the engine before screenshots and before input that would land on the pill. */
const YIELD_EVENT = 'aether-overlay-yield';
/** Dispatched by the engine just before each of its own actions, so the shield lets that input through. */
const AGENT_INPUT_EVENT = 'aether-agent-input';
const YIELD_MS = 1500;
/** How long the shield stays open after the agent announces an action. */
const AGENT_WINDOW_MS = 2500;
const HINT_MS = 2600;
/** The Aether mark, inline so no extension file has to be exposed to web pages. */
const MARK_SVG = '<svg viewBox="0 0 128 128" width="20" height="20" aria-hidden="true"><rect x="2" y="2" width="124" height="124" rx="28" fill="#1b2027"/><rect x="14" y="14" width="100" height="100" rx="20" fill="none" stroke="currentColor" stroke-width="10"/><path d="M40 94 L64 34 L88 94" fill="none" stroke="#f6f7f9" stroke-width="15" stroke-linecap="round" stroke-linejoin="round"/><rect x="46" y="70" width="36" height="12" rx="6" fill="currentColor"/></svg>';
const BLOCKED_KEY_EVENTS = ['keydown', 'keypress', 'keyup', 'beforeinput', 'paste', 'cut', 'drop'] as const;

interface View {
  host: HTMLElement;
  shield: HTMLElement;
  pill: HTMLElement;
  label: HTMLElement;
  actions: HTMLElement;
  hint: HTMLElement;
}

function build(): View {
  const host = document.createElement('aether-overlay');
  host.setAttribute(OVERLAY_ATTRIBUTE, '');
  host.setAttribute('aria-hidden', 'true');
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>${OVERLAY_CSS}</style>
    <div class="shield"></div>
    <div class="edge"></div>
    <div class="hint" role="status">Aether is working in this tab. Press <b>Take over</b> to use it yourself.</div>
    <div class="pill"><span class="mark">${MARK_SVG}</span><span class="label"></span><span class="actions"></span></div>`;
  const pick = (selector: string): HTMLElement => {
    const element = root.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`overlay part ${selector} is missing`);
    return element;
  };
  return { host, shield: pick('.shield'), pill: pick('.pill'), label: pick('.label'), actions: pick('.actions'), hint: pick('.hint') };
}

function button(text: string, onClick: () => void, kind: 'primary' | 'plain' | 'quiet' = 'plain'): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = text;
  element.className = kind;
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
    let hintTimer: ReturnType<typeof setTimeout> | undefined;
    /** The person's input is blocked only while the agent is acting. */
    let locked = false;
    let agentWindowUntil = 0;

    const blocking = (): boolean => locked && Date.now() > agentWindowUntil;

    const showHint = (): void => {
      if (!view) return;
      view.hint.classList.add('visible');
      if (hintTimer) clearTimeout(hintTimer);
      hintTimer = setTimeout(() => view?.hint.classList.remove('visible'), HINT_MS);
    };

    const syncShield = (): void => {
      if (!view) return;
      view.shield.classList.toggle('active', blocking());
    };

    const remove = (): void => {
      locked = false;
      view?.host.remove();
      view = undefined;
    };

    const render = (frame: RunStateFrame | undefined): void => {
      if (!frame || frame.state === 'idle') {
        remove();
        return;
      }
      if (!view) {
        const built = build();
        view = built;
        document.documentElement.append(built.host);
        for (const type of ['mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'pointerdown', 'auxclick'] as const) {
          built.shield.addEventListener(type, (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (type === 'mousedown' || type === 'contextmenu') showHint();
          });
        }
        built.shield.addEventListener(
          'wheel',
          (event) => {
            event.preventDefault();
            showHint();
          },
          { passive: false },
        );
      }
      const waiting = frame.state === 'waiting_human';
      locked = !waiting;
      view.host.dataset.state = waiting ? 'waiting' : 'acting';
      view.label.textContent = waiting
        ? frame.pending?.reason === 'user_interrupted'
          ? 'You have control'
          : 'Aether needs you in the side panel'
        : frame.label;
      view.actions.replaceChildren();
      if (waiting && frame.pending?.reason === 'user_interrupted') {
        const id = frame.pending.id;
        view.actions.append(button('Resume', () => send({ type: 'aether.reply', id, kind: 'resume' }), 'primary'));
      } else if (!waiting) {
        view.actions.append(
          button(
            'Take over',
            () => {
              // Release the page at once; the engine confirms with a waiting frame that carries Resume.
              locked = false;
              syncShield();
              if (view) {
                view.host.dataset.state = 'waiting';
                view.label.textContent = 'You have control';
                view.actions.replaceChildren();
              }
              send({ type: 'aether.control', kind: 'takeover' });
            },
            'primary',
          ),
          button('Stop', () => send({ type: 'aether.control', kind: 'stop' }), 'quiet'),
        );
      }
      syncShield();
    };

    // Keys go to the focused element, not to the shield, so block them in the capture phase.
    // Keys aimed at the pill's own buttons are allowed.
    for (const type of BLOCKED_KEY_EVENTS) {
      window.addEventListener(
        type,
        (event) => {
          if (!blocking() || (view && event.composedPath().includes(view.host))) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          if (type === 'keydown') showHint();
        },
        { capture: true },
      );
    }

    document.addEventListener(AGENT_INPUT_EVENT, () => {
      agentWindowUntil = Date.now() + AGENT_WINDOW_MS;
      syncShield();
      setTimeout(syncShield, AGENT_WINDOW_MS + 20);
    });

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
