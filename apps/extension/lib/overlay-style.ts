/**
 * Edge light, input shield, hint and status pill. The page stays the page:
 * light on the inner edge of the viewport, one small pill, and an invisible
 * shield while the agent acts. Only opacity and transform animate.
 */
export const OVERLAY_CSS = `
:host {
  --aether-blue: #2f6bff;
  --aether-amber: #f5a524;
  --aether-ink: #0f1216;
  --aether-ink-2: #1b2027;
  --aether-paper: #f6f7f9;
  all: initial;
  position: fixed;
  inset: 0;
  z-index: 2147483646;
  pointer-events: none;
  contain: strict;
}
:host([data-state="acting"]) { --edge: var(--aether-blue); --edge-soft: rgba(47, 107, 255, 0.3); }
:host([data-state="waiting"]) { --edge: var(--aether-amber); --edge-soft: rgba(245, 165, 36, 0.32); }

.shield { position: absolute; inset: 0; display: none; cursor: not-allowed; background: transparent; }
.shield.active { display: block; pointer-events: auto; }

.edge {
  position: absolute;
  inset: 0;
  pointer-events: none;
  box-shadow: inset 0 0 0 2px var(--edge), inset 0 0 26px 1px var(--edge-soft);
  animation: breathe 3.6s ease-in-out infinite;
}
:host([data-state="waiting"]) .edge { animation: none; opacity: 1; }
@keyframes breathe { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }

.hint {
  position: absolute;
  left: 50%;
  bottom: 68px;
  transform: translate(-50%, 6px);
  opacity: 0;
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--aether-ink);
  color: var(--aether-paper);
  font: 500 12.5px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif;
  box-shadow: 0 8px 28px rgba(15, 18, 22, 0.3);
  transition: opacity 160ms ease, transform 160ms ease;
  pointer-events: none;
  white-space: nowrap;
}
.hint b { color: #9db8ff; font-weight: 600; }
.hint.visible { opacity: 1; transform: translate(-50%, 0); }

.pill {
  position: absolute;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: min(560px, calc(100vw - 32px));
  padding: 6px 6px 6px 8px;
  border-radius: 999px;
  background: var(--aether-ink);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: var(--aether-paper);
  font: 500 12.5px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif;
  letter-spacing: 0.01em;
  box-shadow: 0 6px 24px rgba(15, 18, 22, 0.28);
  pointer-events: auto;
}
.mark { display: inline-flex; flex: none; color: var(--edge); }
.mark svg { display: block; }
.label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-right: 2px; }
.actions { display: flex; gap: 4px; flex: none; }
button {
  all: unset;
  cursor: pointer;
  padding: 6px 11px;
  border-radius: 999px;
  font: 600 11.5px/1 system-ui, -apple-system, "Segoe UI", sans-serif;
}
button.primary { background: var(--edge); color: #ffffff; }
:host([data-state="waiting"]) button.primary { color: var(--aether-ink); }
button.plain { background: rgba(246, 247, 249, 0.1); color: var(--aether-paper); }
button.quiet { color: rgba(246, 247, 249, 0.72); }
button:hover { filter: brightness(1.12); }
button.quiet:hover { color: var(--aether-paper); background: rgba(246, 247, 249, 0.08); }
button:focus-visible { outline: 2px solid var(--edge); outline-offset: 1px; }

@media (prefers-reduced-motion: reduce) {
  .edge { animation: none; opacity: 0.9; }
  .hint { transition: none; }
}
`;
