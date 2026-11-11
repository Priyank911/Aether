/**
 * Edge light and status pill. The page stays the page: light on the inner edge
 * of the viewport and one small pill. Only opacity animates; box-shadow is
 * static so the compositor does the work.
 */
export const OVERLAY_CSS = `
:host {
  --aether-blue: #2f6bff;
  --aether-amber: #f5a524;
  --aether-ink: #0f1216;
  --aether-paper: #f6f7f9;
  all: initial;
  position: fixed;
  inset: 0;
  z-index: 2147483646;
  pointer-events: none;
  contain: strict;
}
.edge {
  position: absolute;
  inset: 0;
  pointer-events: none;
  box-shadow: inset 0 0 0 2px var(--edge), inset 0 0 28px 2px var(--edge-soft);
  animation: breathe 3.6s ease-in-out infinite;
}
:host([data-state="acting"]) { --edge: var(--aether-blue); --edge-soft: rgba(47, 107, 255, 0.32); }
:host([data-state="waiting"]) { --edge: var(--aether-amber); --edge-soft: rgba(245, 165, 36, 0.34); }
:host([data-state="waiting"]) .edge { animation: none; opacity: 1; }
@keyframes breathe { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .edge { animation: none; opacity: 0.9; } }
.pill {
  position: absolute;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: min(560px, calc(100vw - 32px));
  padding: 7px 8px 7px 14px;
  border-radius: 999px;
  background: var(--aether-ink);
  color: var(--aether-paper);
  font: 500 12.5px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif;
  letter-spacing: 0.01em;
  box-shadow: 0 6px 24px rgba(15, 18, 22, 0.28);
  pointer-events: auto;
}
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--edge); flex: none; }
.label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.actions { display: flex; gap: 4px; flex: none; }
button {
  all: unset;
  cursor: pointer;
  padding: 5px 10px;
  border-radius: 999px;
  color: var(--aether-paper);
  background: rgba(246, 247, 249, 0.1);
  font: 600 11.5px/1 system-ui, -apple-system, "Segoe UI", sans-serif;
}
button:hover { background: rgba(246, 247, 249, 0.2); }
button:focus-visible { outline: 2px solid var(--edge); outline-offset: 1px; }
button.primary { background: var(--edge); color: var(--aether-ink); }
`;
