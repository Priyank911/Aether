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
   sit above the shell; a separate transparent renderer now handles UI above
   pages. Its native bounds/attachment, not CSS pointer-events, govern input
   shielding. The page is resized alongside the Activity/Memory panel.

Aether already uses Chromium through Electron. Google is the current
omnibox search provider (`src/main/omnibox.ts`), not DuckDuckGo. Changing a
search provider does not replace the rendering engine with Google Chrome.
DuckDuckGo references also remain in benchmarks and historical spike results.

## Phase status

| Phase | Evidence and remaining gates |
|---|---|
| 0–2 | Recorded complete in the plan; schema, engine and desktop core tests still pass. |
| 3 | Engine extraction, desktop Code Mode, held runs, service, commands, skill links, source installer and log rotation exist. S10 host acceptance and clean Windows-profile install acceptance are open. Packaged installation depends on D1. Static review found the gaps below; this phase is not fully signed off. |
| 4 | Active phase. Tasks 4.1–4.9 implemented with the scope below: native shortcuts, Agent bar, working Activity/Memory panel, decisions, shield/Find, browser basics and Settings. Task 4.10 native keyboard automation passes; NVDA/manual acceptance, OAuth popup exception and D4 remain open. |
| 5 | In progress: isolated S6 fixture probe plus device-independent importer and first-run/Settings UI. Latest full validation: 47 files / 328 tests passed. Live sign-in/other-OS encryption evidence remains open; guarded per-Space downloads and deletion confirmation are not started. Downloads currently fail closed. |
| 6 | Pending: retire legacy extension/native host only after desktop acceptance, app-only documentation, measured v3 benchmarks, packaging and clean-machine acceptance. |

There are **three phases with outstanding delivery work (4, 5, 6)**,
plus Phase 3 correctness and manual acceptance carryovers. Phase 4 is no
longer mostly scaffolding, but implementation is not phase exit acceptance.

### Remaining Phase 4 requirements

- Task 1: complete, including both-theme contrast checks and coordinated native geometry.
- Task 2: complete, including drag, keyboard behavior, state icons, mute lifecycle,
  native Space menu and archived-Space restoration.
- Task 3: complete; host-only resting URL, native-overlay suggestions, running
  Agent-Space indicator and native main menu are implemented and tested.
- Task 4: native page-focus shortcuts implemented. Find/History/bookmark
  actions were wired with their feature tasks; Downloads stays in Phase 5.
- Task 5: state-driven Agent bar, elapsed time, review and done behavior
  implemented; it is no longer the interim Phase 3 bar.
- Task 6: Activity/Memory panel implemented, including native page geometry,
  pointer/keyboard resizing, decisions, batch URLs and local memory controls.
- Task 7: acting shield, Esc takeover, action-target cursor/reticle, native
  Find and toasts implemented and tested. Idle Find uses a small overlay,
  not a full-page input blocker.
- Task 8: error/crash recovery, context menu, prompts, auth, certificate
  refusal, fullscreen/PDF/print hooks, stored zoom, pixel-art new tab,
  history and bookmarks implemented. Downloads remains Phase 5. External
  apps are allowlisted to mailto/tel/sms; other schemes are unsupported.
  OAuth opener-preserving popups and manual platform acceptance remain open.
- Task 9: human-only Settings implemented; explicit saves preserve unknown
  config keys and refuse to overwrite malformed JSON.
- Task 10: automated native keyboard decision flow passes. NVDA and manual
  checks are not run; see `A11Y.md`. D4 remains a person decision.

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
7. **Send tab semantics — partially resolved in 4.8:** same-session sends
   now transfer the live Tab/view, retaining history and form state, with
   fixture coverage. Cross-session/ephemeral transfers fail explicitly;
   they do not silently copy a URL. OAuth popups still lack the required
   opener-preserving exception.

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

## Tasks 4.4–4.9 — implementation evidence

Task status: implemented with the explicitly deferred scope below; no
manual phase-exit sign-off is implied. All changes remain uncommitted.

- **4.4–4.5:** native `before-input-event` routing, browser menu/shortcut
  tables, and the state-driven Agent bar replace renderer-only/interim
  behavior. Relevant files: `shortcuts.ts`, `shortcuts-electron.ts`,
  `browser-menu.ts`, `renderer/src/AgentBar.tsx`.
- **4.6:** `SidePanel.tsx`, `DecisionCard.tsx`, `MemoryPanel.tsx`,
  `panel.css` and `shell-memory.ts` implement the actual panel, trusted
  replies and memory actions. `panel.e2e.test.ts` covers eight real flows.
  Validation at this task: 38 files / 289 tests; this historical run used
  one permitted retry. Later runs below did not use retries.
- **4.7:** `overlay.tsx`, `overlay.css`, `shell-window.ts`, the Actor's
  `action-target.ts` and callbacks implement shielding and projected iframe
  feedback. Projection failure clears feedback instead of guessing.
  `overlay.e2e.test.ts` and `action-target.test.ts` cover the behavior.
  Validation: 40 files / 296 tests, no retries.
- **4.8:** `internal-pages.ts`, `browser-basics.ts`, `browser-prompts.ts`,
  `navigation-store.ts`, `BrowserRequest.tsx` and `BookmarksBar.tsx` add
  browser surfaces. The new tab displays centered white pixel-art Aether
  on a dark page and only real recent Agent Spaces. The Space dropdown
  dismisses on outside shell/page-overlay/panel clicks and blur/resize.
  The reload path now activates crashed/asleep tabs through the manager,
  restoring their placement instead of only waking the renderer.
  `basics.e2e.test.ts` has eight tests, including local HTTP auth and TLS
  refusal. The committed-source candidate certificate/key under
  `tests/helpers/localhost-*.pem` is public, local test-only material, not
  a production credential. Validation: 41 files / 305 tests, no retries.
- **4.9:** `SettingsPage.tsx`, `settings.css`, `shell-settings.ts` and shared
  shell schemas add a real Personal Settings tab. The trusted shell owns
  editing, not a privileged page preload. Atomic explicit saves update
  cookie behavior, memory reserve and memory enablement; agents cannot
  invoke Settings saves. Unit and Electron coverage passes.
  Validation: 43 files / 311 tests, no retries.

Each completed task passed typecheck, lint (0 errors, 7 existing warnings)
and the full single-fork suite before advancement. Paths above are relative
to `apps/desktop/src/main`, `apps/desktop/renderer/src`, or the corresponding
`tests` directory unless a package prefix is given.

Deviations and remaining scope: native shortcut actions followed their
feature availability; Downloads is Phase 5. Same-session live tab transfer
is fixed, but OAuth opener preservation is not. External protocols are
limited to mailto/tel/sms. Fullscreen/print/PDF have hooks, not complete
manual platform acceptance. No dependencies were added. S6, S10, NVDA and
packaged clean-machine acceptance were not run.

## Task 4.10 — partial, manual acceptance pending

Files: `apps/desktop/tests/a11y.e2e.test.ts`, `docs/A11Y.md`, this audit and
`docs/PLAN.md`. The new test performs a live native-keyboard question flow,
including initial focus, F6, Tab, Activity/Memory arrow navigation, answer
submission into the held script and Ctrl+Backslash. No pointer is used.

Command:

```sh
pnpm typecheck && pnpm lint && CI=true pnpm test --poolOptions.forks.maxForks=1 --poolOptions.forks.minForks=1
```

First full run after the new test: typecheck passed; lint had 0 errors and
7 existing warnings; all 24 contrast checks and **44 files / 312 tests**
passed without retries (258.18 s test duration). This is automated evidence,
not the required NVDA or manual phase exit. `A11Y.md` records the unrun
checklist rather than claiming screen-reader acceptance.

The second full run passed typecheck/lint/contrast but failed the Settings
fixture's native number entry (`3` instead of `30`); its dependent test
then found no config file. Result: 43 files passed / 1 failed, 310 tests
passed / 2 failed. Adding complete key sequences and a render barrier did
not resolve it in a targeted run, so no production cause is claimed.
The Settings persistence test now uses the native DOM value setter plus
an input event, as a controlled form-edit test, rather than claiming
keyboard coverage there. The separate accessibility flow still uses real
native keyboard input. Targeted Settings rerun: 3 tests passed. No
production Settings behavior was changed to make the fixture pass.

After that fixture adjustment, typecheck/lint/contrast and the full suite
passed again: **44 files / 312 tests**, no retries (229.17 s). The next
consecutive run passed typecheck/lint/contrast but failed the accessibility
test's initial-focus assertion at `a11y.e2e.test.ts:31`: active-element text
stayed empty rather than becoming Send answer. Result: **43 files passed /
1 failed, 311 tests passed / 1 failed** (280.99 s). The initial-focus failure
is unresolved; it may be native focus/fixture timing or application focus
ordering and needs isolation before a production fix. Two consecutive
passing runs are **not established**. Do not weaken or skip that assertion
to claim the accessibility gate passed.

## Phase 5 task 1 / S6 — partial

At the person's explicit request to move to the next phase, implemented only
the isolated S6 probe. This is an ordering exception for spike work, not a
Phase 4 exit sign-off. No production import behavior was chosen.

Created:

- `scripts/spikes/s6-chrome-import.mts`: explicit-profile or fixture CLI,
  redacted count-only output and generated-fixture cleanup.
- `scripts/spikes/s6/profile.mts`: read-only SQLite copies, integrity/journal
  checks, bookmark counts, DPAPI/v10 authentication and host binding,
  explicit v20 skip counts, key wiping and `finally` cleanup.
- `scripts/spikes/s6/fixture.mts`, `s6/dpapi.ps1`: generated encrypted data and
  Windows CurrentUser DPAPI helper. No personal profile auto-discovery.
- `tests/chrome-import-spike.test.ts`: five regression tests.

Updated `docs/SPIKES.md` and `docs/PLAN.md` with evidence and remaining scope.
Windows fixture: 2 bookmarks / 1 history URL, 7 cookies: valid v10 and legacy
DPAPI decrypted, two malformed/host-mismatched v10 payloads refused, one v20
sentinel skipped, plaintext/unsupported rows counted. Both fixture and
working copies were removed. This does not measure real Chrome App-Bound
resistance or Google/bank sign-in. No new dependencies or app UI changes.

Commands/results:

- `pnpm exec tsx scripts/spikes/s6-chrome-import.mts --fixture`: passed.
- `pnpm exec tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext scripts/spikes/s6-chrome-import.mts`: passed.
- Targeted spike tests: 5 passed after matching the existing SQLite runtime
  loading pattern for Vite 5. Lint remains 0 errors / 7 existing warnings.
- Required `pnpm typecheck && pnpm lint && CI=true pnpm test --poolOptions.forks.maxForks=1 --poolOptions.forks.minForks=1`:
  typecheck/lint/contrast passed; **43 files passed / 2 failed, 314 tests
  passed / 3 failed**. Existing command cold-start returned held (2) instead
  of success (0), approval check found no pending reason, and toolbar focus
  did not settle. The spike tests passed in this run.
- Targeted rerun of command/toolbar files: **17 passed / 2 failed**;
  cold-start still returned 2, and toolbar Escape did not restore resting
  host text. Approval and the original toolbar-history case passed this
  rerun. These failures remain unresolved; no unrelated code was changed.

Next Phase 5 task: finish S6 using an explicitly selected closed Chrome
profile and person-led Google/bank sign-in measurements. Do not start the
production importer until S6 outcomes and full-suite validation are clear.

## Phase 5 tasks 2–3 — generic in-app import implemented

The person explicitly requested a portable app feature, not a hardcoded
path to their personal profile, then continuation to the next phase. Used
S6 fixture evidence for supported decryption paths without claiming live
sign-in or other-OS encryption acceptance. No personal profile was read.

Files created:

- `apps/desktop/src/main/import/profiles.ts`: OS-relative Chrome discovery,
  profile labels and canonical directory registration. A native picker
  supports nonstandard locations; renderer commands carry offered ids,
  never arbitrary paths.
- `import/source.ts`, `cookie-crypto.ts`, `chrome-importer.ts`: read-only
  History/Cookies copies, journal/integrity checks, BigInt Chrome timestamps,
  Windows CurrentUser DPAPI/v10 authenticated decryption and host binding,
  and finally cleanup. Source writes and raw-data diagnostics are absent.
- `import/browser-identity.ts`: UA derives from the bundled Chromium version;
  removes Electron/scoped app product tokens and supplies basic client hints
  on the persistent partition. This does not establish site compatibility.
- `import/import-controller.ts`: serialized person-only registry/import flow;
  existing cookies are retained and imported cookies flushed to persistence.
- `packages/shared/src/browser-import.ts`: profile/selection/report/state
  schemas. Updated shared exports and shell command/snapshot schemas.
- `apps/desktop/renderer/src/ImportSettings.tsx`, `import.css`: profile search,
  folder picker, explicit choices, default cookie opt-out, busy/error states,
  first-run dismissal and per-kind imported/skipped counts with explanations.
- `tests/chrome-import.test.ts`: seven tests, including the production DPAPI
  helper against a generated key, idempotent navigation merging and safe
  unavailable-platform behavior.
- `apps/desktop/tests/import.e2e.test.ts`: four real Electron tests, including
  first-run link, explicit cookie opt-in, context/path refusal, restart
  persistence and local HTTP UA/client-hint assertions.

Also changed `navigation-store.ts`, `index.ts`, `internal-pages.ts`,
`shell-bridge.ts`, `test-control.ts`, `SettingsPage.tsx`, `App.tsx`,
`docs/SETUP.md`, `docs/PLAN.md` and `docs/SPIKES.md`.

Task 2 validation before starting UI: typecheck/lint passed, full suite
**46 files / 323 tests**, no retries. Chrome timestamps initially overflowed
SQLite's default safe-number reads; reading DB integers as BigInt fixed the
actual source-format issue. Temporary-copy cleanup failures are surfaced,
not falsely reported as success.

Task 3 validation:

- Targeted import UI run initially passed; its first full run caught a
  fixture race clicking Import before React enabled it. Waiting for the
  enabled button resolved that test without changing production behavior.
- The next full run passed all import tests but hit existing initial-focus
  failures in accessibility/tabstrip (325 passed / 2 failed).
- A new local HTTP assertion caught the actual scoped app token
  `@aether/desktop` in the UA; removed that token and added regression coverage.
- Latest targeted result: **11 tests passed** across core and UI suites.
- Latest required command, `pnpm typecheck && pnpm lint && CI=true pnpm test --poolOptions.forks.maxForks=1 --poolOptions.forks.minForks=1`:
  **all passed, 47 files / 328 tests**, no retries (272.02 s test duration).
  Lint remains 0 errors / 7 existing warnings; 24 contrast checks passed.
- Captured and visually inspected the offscreen fixture's Settings import
  section. Added spacing from the preceding Settings form after review.
  This is not cross-OS, native-picker interaction or NVDA acceptance.

Scope/deviations: the person's request allowed generic implementation while
S6's personal-profile/sign-in questions remain unmeasured. Windows decryption
is supported only where the OS unwrap succeeds. App-Bound and partitioned
cookies are explicitly skipped; encrypted macOS/Linux cookies are currently
unsupported and reported, not silently assumed decryptable. Plaintext cookie
import works independently of OS. Bookmark folders are flattened because
Aether's current bookmark store is flat. Passwords are not imported. No new
dependencies, packaging choice or legacy removal.

Next ordered task: **5.4 guarded per-Space downloads**, then **5.5 deletion
confirmation**. The request to start Phase 6 conflicts with its desktop
acceptance prerequisite until these and the open acceptance gates clear;
legacy retirement has not started.

## Next task and release gates

Phase 4's next outstanding task remains: **isolate the intermittent 4.10 initial-focus failure,
then finish manual accessibility acceptance**. The native keyboard flow has
passed full runs but the latest run failed its initial-focus assertion;
NVDA has not run. Section 10.5 and task
4.10 require that pass, and section 14 requires phase order. Therefore the
request to finish through Phase 6 cannot be represented as complete or
used to bypass the phase exit gates. D4 must also be put to the person.

The earlier task 4.4 ordering concern was handled by wiring native
shortcuts as each feature became available; Find/History/bookmarks now
work, while Downloads/Ctrl+J remains explicitly deferred to Phase 5.
This dependency handling did not change the plan's feature requirements.
The person subsequently requested the next phase and a portable import UI;
the importer and first-run/Settings flow above are implemented, with live
sign-in/other-OS encryption measurements still open.
This does not imply Phase 4 acceptance. Keep the extension/native-host until desktop acceptance;
Phase 6 removal is not authorized by passing unit tests.

Continue one task at a time and run typecheck, lint and tests after each.
Phase exits require two passing exit runs, not just one full-suite pass.

Before release, the safety findings above need regression coverage and fixes;
S10 and S6 need real-host/person participation; keyboard/NVDA acceptance,
D1 packaging, D4 layout choice and measured benchmark results remain open.
The current app must not be described as a finished or release-ready agentic
browser solely because the existing automated suite passes.
