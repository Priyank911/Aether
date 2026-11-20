# Implementation review — 2026-11-20

## Scope and evidence

Reviewed the repository's v3.2 `PLAN.md`, `PERCEPTION.md`, `SPIKES.md`,
source, test coverage and commit history through `e81accd`.
The supplied external v3.1 blueprint was available only as an outline;
its full HTML could not be opened at the supplied Downloads path. A full
artifact comparison remains outstanding. The repository plan is the source
of truth; this report does not change its requirements or ordering.

Automated validation below covers the local fixtures and app, not every
website, host, OS, accessibility flow or release acceptance criterion.

## How the application works

1. The host loads the installed `/aether` skill and uses the CLI. The CLI
   discovers or launches Desktop and authenticates to its local app service.
2. The service dispatches Code Mode to `CodeModeHost`. A worker runs typed
   scripts against capability RPC; the host provides reasoning, not Aether.
3. `DesktopSpaceEngine` reuses `packages/engine` with a per-Space session.
   Policy and the Actor execute in the application; CDP is owned by Aether.
4. `SpaceManager` owns Personal and Agent Spaces, tab lifecycle, persistence
   and run frames. Agent tabs are controlled through Electron's debugger;
   Personal tabs are not registered with that transport.
5. Live background Agent views render in an off-screen host window. Sleeping
   tabs are metadata only; the memory watchdog releases eligible renderers.
6. Perceiver generates compact skims, focused text, items, surveys and deltas.
   `PERCEPTION.md` documents deterministic ranking, not an implementation
   roadmap. Survey's documented output budget is about 400–600 tokens.
7. React receives metadata snapshots through the preload. Native page views
   sit above the shell; a separate transparent renderer is intended for UI
   above pages. CSS pointer-events cannot make a native view click-through.

Aether already uses Chromium through Electron. Google is the current
omnibox search provider (`src/main/omnibox.ts`), not DuckDuckGo. Changing a
search provider does not replace the rendering engine with Google Chrome.
DuckDuckGo references also remain in benchmarks and historical spike results.

## Phase status

| Phase | Evidence and remaining gates |
|---|---|
| 0–2 | Recorded complete in the plan; schema, engine and desktop core tests still pass. |
| 3 | Engine extraction, desktop Code Mode, held runs, service, commands, skill links, source installer and log rotation exist. S10 host acceptance and clean Windows-profile install acceptance are open. Packaged installation depends on D1. Static review found the gaps below; this phase is not fully signed off. |
| 4 | Active phase. React tab strip, toolbar, interim Agent bar, overlay scaffolding, tab reorder backend and panel-toggle state exist. Most interactive shell and browser-basics acceptance work remains. |
| 5 | Pending: S6 import/sign-in spike, importer, import UI, guarded per-Space downloads and deletion confirmation. Downloads currently fail closed. |
| 6 | Pending: retire legacy extension/native host only after desktop acceptance, app-only documentation, measured v3 benchmarks, packaging and clean-machine acceptance. |

There are **three phases with outstanding delivery work (4, 5, 6)**,
plus Phase 3 correctness and manual acceptance carryovers. An exact count
of finished Phase 4 tasks would be misleading: several are only scaffolded.

### Remaining Phase 4 requirements

- Task 1: complete, including both-theme contrast checks and coordinated native geometry.
- Task 2: complete, including drag, keyboard behavior, state icons, mute lifecycle,
  native Space menu and archived-Space restoration.
- Task 3: complete; host-only resting URL, native-overlay suggestions, running
  Agent-Space indicator and native main menu are implemented and tested.
- Task 4: browser shortcuts must work while the native page has focus;
  renderer-only key handlers are insufficient.
- Task 5: Agent bar is interim; elapsed time, review flow and done behavior
  still need completion against the plan.
- Task 6: actual Activity/Memory panel, resize geometry, decision cards,
  batched URL approvals and memory command implementation are missing.
- Task 7: acting-state input shield, Esc takeover, action-target cursor,
  reticle, find UI/results and toasts are missing. Mounting the overlay
  alone does not implement these behaviors.
- Task 8: custom error/crash pages, context menu, permissions, auth,
  certificate handling, protocol prompts, fullscreen, site zoom persistence,
  printing and internal new-tab/history/bookmark surfaces need acceptance.
- Task 9: Settings UI and human-only preference editing are missing.
- Task 10: keyboard-only and NVDA decision-flow checks must be recorded;
  D4 (optional vertical tabs) remains a person decision.

## Correctness findings to reproduce and fix

These are static-code findings, not claims that all exploits were executed.
They require isolated regression tests before their respective fixes.

1. **Keyboard policy context:** `packages/engine/src/browser-session.ts`
   classifies ref-less actions without a resolved target. In
   `packages/policy/src/classifier.ts`, sensitive-field protection only
   covers `fill`. Review typed keys and implicit form submission against
   focused controls; explicit-ref Enter tests do not cover those paths.
2. **Untrusted metadata:** `DesktopTools.spaces()` interpolates page titles
   directly into tool text. `SessionSpaceEngine`'s `tabs` return does not
   mark the current run as reading page data. Code Mode state also needs
   cross-run provenance review. Page-derived metadata is still untrusted.
3. **Windows installer PATH preservation:** `scripts/aether-install.mjs`
   parses `REG_EXPAND_SZ` only. An existing `REG_SZ` Path can be interpreted
   as empty and overwritten during install. Test without changing the
   person's real registry before any installer acceptance run.
4. **Windows service-token ACL:** `service-file.ts` uses POSIX mode `0600`;
   explicit Windows owner-only ACL enforcement required by the plan is
   absent. Do not assume inherited permissions meet that requirement.
5. **Navigation landing consistency:** explicit `open` runs Smart Landing;
   action/popup/tab-switch paths need verification against the plan's
   every-navigation consent and archetype contract.
6. **Fan-out lifecycle:** `worker-source.ts` and `session-engine.ts` do not
   implement the full slot-governed, page-scoped `mapPages` callback/sleep
   lifecycle described by Phase 3.2. Verify callback/tab isolation and batch
   URL approval as well as final result correctness.
7. **Send tab semantics:** `ShellBridge` opens a copy of the URL then closes
   the original tab. This does not preserve navigation history as section
   5.1 requires. OAuth popups also lack the opener-preserving exception.

## Task 4.1 repair — complete

Fixed the renderer startup/build path before undertaking more shell UI work:

- Vite now emits to `apps/desktop/renderer-dist`, where Electron actually
  looks, rather than `apps/renderer-dist`.
- Asset URLs are relative for `file://` loading.
- Overlay has its own mounted React entry and stylesheet.
- Desktop build and the full test command build the renderer.
- Root height and non-shrinking chrome rows preserve tab strip/toolbar/bar
  geometry. Blank strip space is a window drag region; controls are not.
- The default Electron application menu is removed on Windows/Linux;
  macOS retains its application menu.
- Added test-only shell inspection through the existing control channel.
  It is available only with `AETHER_TEST_CONTROL`, not the app service.

Files changed: root and desktop `package.json`, desktop `vite.config.ts`,
`renderer/overlay.html`, `renderer/src/overlay-main.tsx`,
`renderer/src/tokens.css`, `src/main/index.ts`, `src/main/test-control.ts`,
`tests/shell.e2e.test.ts`, `docs/PLAN.md` and this report.

Validation:

- `pnpm typecheck`: passed.
- `pnpm lint`: passed, 0 errors / 9 existing warnings.
- `pnpm --filter @aether/desktop renderer:build`: passed.
- `pnpm exec vitest run apps/desktop/tests/shell.e2e.test.ts`: 5 passed.
- `pnpm test`: first full run passed, 31 files / 234 tests, including the real Electron shell.
- Final `pnpm typecheck && pnpm lint && pnpm test` repeat: typecheck and lint
  completed; the test stage exceeded the 240-second command limit without a
  final suite summary. The 5 shell tests passed again during that run, but a
  second complete suite pass is **not** established. No longer rerun attempted.
- `git diff --check`: passed (Git emitted line-ending conversion warnings).

Early resize assertions assumed requested width equals native content width;
Windows hidden-frame/DPI measurements disproved that assumption. Tests now
compare against Electron's measured content bounds, allowing 1 DIP rounding.
The interrupted session's malformed temporary diagnostic file was removed.
No commits or pushes were made.

Deviation: existing 40/44 px tab/toolbar heights are retained for this repair,
not silently changed to the plan's 36/40 px design tokens. A coordinated token
and native-geometry change belongs to the next UI task. No dependencies added.
The existing `lucide-static` dependency is not newly approved by this report:
section 3 currently forbids icon libraries. The requested icon-library change
needs an explicit plan decision before use. The frontend skill's component,
font and animation libraries likewise do not override the project stack.

## Tasks 4.1 and 4.2 — complete

Task 4.1 now also aligns light/dark design tokens and native chrome to the
plan's 36/40/32 px rows. `scripts/check-contrast.mts` checks 24 token pairs
across both themes and runs at the start of `pnpm test`.

The earlier full-suite hangs were traced to the service test client's
per-request polling loops: completed requests left loops running and fatal
frames could starve the event loop. ID-keyed dispatch, pending rejection,
connection cleanup and two socket regression tests replace that helper.
After this repair, typecheck, lint and all 236 then-current tests passed.

Task 4.2 adds `TabStrip.tsx` and `SpaceMenu.tsx`: adjacent new-tab control,
neutral/loading/crashed/sleeping favicons, drag reorder and scroll overflow,
roving keyboard navigation, middle-click close, real audio mute with
sleep/wake retention, status-labelled native overlay menu, shell-focused
Space shortcuts and archived-Space restoration with background tabs asleep.
Preload subscriptions now unsubscribe on React effect cleanup.

The archived-menu regression exposed a native view lifecycle defect: the
active released tab remained referenced by `ShellWindow` after webContents
closed. Detach on release, and remove old views without dereferencing their
possibly destroyed webContents. Menu dismissal now completes normally.

Additional changed files: `chrome.tsx`, `App.tsx`, overlay entry/styles,
`tokens.css`, `aether.d.ts`, shared `shell-ipc.ts`, preload `shell.cts`,
`main/shell-bridge.ts`, `shell-window.ts`, `space-manager.ts`, `tab.ts`,
`test-control.ts`, `tests/service.test.ts`, `tests/shell.e2e.test.ts`,
`tests/tabstrip.e2e.test.ts` and root `package.json`.

Validation on 2026-11-20:

- Desktop build: passed; targeted shell/tab tests: 14/14 passed.
- Light/dark header PNGs captured and visually inspected under ignored
  `.userData/ui-review/`; this is not a new-tab-page visual acceptance.
- `pnpm typecheck`: passed. `pnpm lint`: 0 errors, 7 warnings.
- Contrast: 24/24 pairs pass.
- Default concurrent full runs exposed an Agent-bar resize assertion race
  (fixed by awaiting the Chromium viewport resize as well as React), then
  intermittent Chrome launch/MCP/legacy-extension failures. No unrelated
  production changes or relaxed assertions were made for those failures.
- `--maxWorkers=1 --minWorkers=1` did not override the configured fork pool.
- Focused single-fork shell/policy/MCP/extension run: 5 files, 61 tests pass.
- `pnpm typecheck && pnpm lint && CI=true pnpm test --poolOptions.forks.maxForks=1 --poolOptions.forks.minForks=1`:
  passed, **32 files / 245 tests**, 208.81 seconds for Vitest.

Deviation: single-fork validation avoids the observed concurrent browser
fixture instability. No dependencies added. Phase 4 exit is not signed off.

## Task 4.3 — complete

Implemented the toolbar and omnibox with no new dependencies:

- Host only at rest, full URL selected on focus, Escape restores the resting
  address, and refused addresses remain editable with an accessible error.
- Back/Forward follow real navigation state; loading swaps Reload for Stop.
- History and bookmark metadata live in Space-scoped local SQLite tables;
  committed main-frame navigations populate history. Ephemeral Spaces are
  not persisted. Metadata is not exposed through the agent service/tools.
- Suggestions draw over native pages; no remote suggest endpoint receives
  typed text. The Google action navigates only when submitted.
- Keyboard selection is owned by main, so arrows and Enter work even before
  either renderer receives its next snapshot. Pointer acceptance verifies
  query and destination, rejecting stale rows instead of navigating elsewhere.
- Native overlay focus transitions do not prematurely dismiss a clicked row.
  Late submission completion does not blur a newer address edit session.
- The shell input owns a same-document accessible listbox mirror because
  ARIA IDs cannot cross WebContents. NVDA acceptance is still outstanding.
- The Agent indicator counts acting/resuming/waiting Spaces and states how
  many need the person. Its click opens the Space switcher.
- The main menu uses `Menu.popup` and native edit roles; it includes only
  implemented actions, not placeholder Chrome services or future surfaces.
- New-tab focus waits for the new tab snapshot rather than focusing the tab
  that is about to be replaced.

Files created: `renderer/src/Toolbar.tsx`, `Omnibox.tsx`,
`OmniboxSuggestions.tsx`; `src/main/navigation-store.ts`,
`omnibox-suggestions.ts`, `browser-menu.ts`; `tests/toolbar.e2e.test.ts`;
root `tests/navigation-store.test.ts`, `omnibox-suggestions.test.ts`,
`browser-menu.test.ts`.
Files changed: renderer `App.tsx`, `TabStrip.tsx`, overlay component/styles,
`tokens.css`; main `index.ts`, `shell-bridge.ts`, `test-control.ts`;
shared `shell-ipc.ts`; this audit, `PLAN.md` and `SPIKES.md`.

Validation:

- `pnpm typecheck`, `pnpm lint`: passed; lint has 0 errors / 7 warnings.
- Desktop build and 12 real-Electron toolbar tests: passed.
- Added 16 store/suggestion/menu unit tests; full suite includes them.
- Light/dark toolbar and suggestion captures under `.userData/ui-review/`
  visually inspected. Transparent overlay capture backgrounds appear black
  in the image viewer; this is not a whole-window or NTP screenshot.
- Earlier integration runs exposed snapshot-selection, stale row, native
  focus and test event-consumption timing races; those failures were not
  counted as passing. Regression coverage was added rather than sleeps.
- Final required run:
  `pnpm typecheck && pnpm lint && CI=true pnpm test --poolOptions.forks.maxForks=1 --poolOptions.forks.minForks=1`
  passed: **36 files / 273 tests**, 245.71 seconds for Vitest; contrast 24/24.
- Independent subagent review could not complete because its configured
  provider exhausted its credits; no completed independent review is claimed.

Deviation: local navigation storage groundwork was needed for the task's
history/bookmark suggestions; their browse/edit surfaces remain task 4.8.
Single-fork validation remains necessary for reliable local browser fixtures.
Native popup templates/actions are covered; manual popup interaction and
cross-OS/accessibility acceptance are not claimed.

## Next task and release gates

Next ordered UI task: **4.4 shortcuts everywhere — blocked by plan ordering**.
Task 4.4 requires every shortcut in §10.5 to work while the page has focus,
but that table includes Find (task 4.7), History/bookmark UI (task 4.8) and
Downloads (Phase 5). Completing those surfaces now would violate the rule to
work in order; installing no-op handlers would not satisfy "work". No task
4.4 code was started. The person must clarify whether task 4.4 should wire
currently implemented actions now and defer each remaining shortcut to its
own feature task, or explicitly reorder those prerequisites.

Continue one task at a time and run typecheck, lint and tests after each.
Phase exits require two passing exit runs, not just one full-suite pass.

Before release, the safety findings above need regression coverage and fixes;
S10 and S6 need real-host/person participation; keyboard/NVDA acceptance,
D1 packaging, D4 layout choice and measured benchmark results remain open.
The current app must not be described as a finished or release-ready agentic
browser solely because the existing automated suite passes.
