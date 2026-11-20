# Aether: Agentic Browser Plan

Working title: Aether. Version 3.2. Date: 2026-11-18.

Supersedes:
- 3.1 (same day): this file before the hands-free connection was written into the architecture and the steps became phases;
- 3.0 (draft of 2026-11-18, kept at `D:\.md\aether plan v3.md`);
- 2.0 (Chrome MV3 extension and 8-tool MCP server, kept at `docs/PLAN-v2.md`).

The perception, action, policy and memory packages from 2.0 are kept as the engine kernel. Phases were called "Steps" in 3.1; code comments, `docs/SPIKES.md` and `docs/SETUP.md` still say "Step N", which means the same as "Phase N" here.

### Progress at a glance

| Phase | What it delivers | Status |
|---|---|---|
| 0 | Plan in the repo, v3 schemas, `FORM` landmark fix | Done 2026-11-18 |
| 1 | Code Mode (`aether_exec`) and Smart Landing on the 2.0 engine | Done 2026-11-18 |
| 2 | Electron core: Spaces, sleeping tabs, agent host window, watchdog, filter, hardening, SQLite | Done 2026-11-18 (24 test files, 201 tests) |
| 3 | Hands-free connection: app service, `aether` command, `/aether` skill linked into every host, installer, Code Mode inside the app | Core implemented; S10 and clean-profile install acceptance remain open; static review found correctness gaps (see `AUDIT.md`) |
| 4 | Shell UI: the Chrome-like design, Agent bar, side panel, overlay, browser basics, Settings | **In progress**; tasks 4.1–4.9 implemented with the scope below; 4.10 keyboard automation has an intermittent initial-focus failure; NVDA/manual acceptance and D4 remain open |
| 5 | Chrome import and per-Space downloads | **In progress**: device-independent Chrome importer, first-run offer and Settings entry implemented; latest validation 47 files / 328 tests passed. S6 live sign-in/other-OS encryption acceptance, downloads and file-deletion confirmation remain open |
| 6 | Retire the extension and native host, measure v3 | Planned |

Current implementation review and remaining work are recorded in [`AUDIT.md`](AUDIT.md). On 2026-11-20, typecheck, lint (0 errors, 7 existing warnings), 24 contrast checks and 44 test files / 312 tests passed with a single test fork and no retries. The Activity/Memory panel, decision cards, acting shield, Find, pixel-art new tab, browser basics and human-only Settings are implemented. Native shortcuts were wired with their features; Downloads and Ctrl+J remain Phase 5 work, not a working placeholder. OAuth opener-preserving popups and manual platform acceptance remain open. Task 4.10 evidence and its unrun NVDA checklist are in [`A11Y.md`](A11Y.md). The latest repeat failed the keyboard test's initial-focus assertion (311 passed / 1 failed); two consecutive passing exit runs are not established. This is not a Phase 3 or Phase 4 exit sign-off; S10/clean-profile installation, NVDA/manual acceptance and D4 remain outstanding.

Baseline before Phase 0 (2026-11-18): 17 test files, 146 tests, all passing; `pnpm typecheck` and `pnpm lint` clean (2 pre-existing lint warnings). After Phase 2: 24 test files, 201 tests, all passing; lint 0 errors, 5 pre-existing warnings.

---

## 0.1 The approach in 3.2 (decided 2026-11-18)

These decisions were made with the person during Phases 1 and 2. They change how hosts reach Aether, not what the engine does.

1. **The product is the browser app.** Aether Desktop is what the person installs and uses. Everything else (the command, the skill, the optional MCP adapter) is a thin way for a coding host to reach that app.
2. **Hands-free, the ego lite way.** After installing, the person does nothing per host. They open Claude Code, VS Code (Copilot), Antigravity or opencode, type `/aether <task>`, and the host finds the skill, runs the `aether` command, and the agent works in the app. No `mcp.json`, no extension ID, no registry step.
3. **Command plus skill first, MCP optional.** The connection is an `aether` command on PATH plus one skill folder linked into every host's skills directory (8.0). MCP is kept only as an adapter for hosts that have no skills and no shell tool. It is built last in Phase 3, and dropped if spike S10 shows no host the person uses needs it.
4. **Code Mode is the only agent interface.** The eight 2.0 tools are removed (2026-11-18). Every agent step is one TypeScript script against the `space` SDK, sent as `aether exec` (or `aether_exec` over MCP). There is no flag to switch modes.
5. **The person's preferences live in Aether, not in the agent.** The first one is `cookieBanners` (`reject` by default, `accept`, `off`; decision D3). The agent can neither read nor change settings; the Settings page in Phase 4 edits them.
6. **No headless or direct mode for the person.** Headless Chrome stays only as the CI and evaluation transport (`--direct --headless`). The person's path is always the app.
7. **One source for the method text.** The skill, the `aether skill` output, the MCP instructions and the `aether_exec` description are generated from the same source in `apps/cli/src/codemode/` (`instructions.ts`, `sdk-declaration.ts`), so they never disagree.

---

## 0. Review of 3.0 (what 3.1 changes and why)

3.0 is kept in substance. These are the gaps and conflicts found when checking it against Electron's behaviour, the 2.0 code, and the stated goal of a minimal, Chrome-like browser. Each item names the section of this plan that resolves it.

| # | Gap or conflict in 3.0 | Resolution in 3.1 |
|---|---|---|
| R1 | The floating pill, ghost cursor and "shell overlay" are drawn in the shell's React DOM, but a `WebContentsView` is a native view stacked above the shell renderer. Shell DOM cannot draw over a page. Omnibox suggestions and menus have the same problem. | One transparent **Shell Overlay view** stacked above the tab view, attached only when needed (4.4). The handoff controls move to an **Agent bar** row above the viewport, as Chrome does with infobars (10.3). |
| R2 | The person asked that their input be blocked while the agent acts, until they press Take over. 3.0 rule 9.6 instead treats any person input as a takeover. | While `acting`, the Shell Overlay view acts as an input shield. Person input is held off and the shield shows "Press Take over or Esc". CDP input from the engine goes straight to the tab renderer and is unaffected (9.6, spike S8). |
| R3 | `node:vm` is documented by Node as not a security boundary. A `vm` escape inside a `worker_threads` worker reaches full Node (`process`, `fs`). | S5 tests both the worker-plus-`vm` design and a sandboxed hidden renderer (Chromium sandbox, no Node, network blocked). The first design is used only if S5 finds no escape (7.1). |
| R4 | `aether_exec` may return a "pending handoff token" after 50 s, but none of the 4 tools accepts that token, so the host cannot collect the result. | `aether_exec` gains `wait?: string`. Calling it with the token and no code resumes waiting (8.1). |
| R5 | `PageBrief`, `BucketItem`, `SurveyResult`, `FindMatch` and `ActDelta` are used in the SDK but never defined. | Defined in 7.2. `BucketItem` matches `packages/perceiver/src/bucket.ts`. |
| R6 | 3.0 claims "zero native addon ABI fragility", but `better-sqlite3` is a native addon that must be rebuilt for Electron's Node ABI. | Decision D2 (16): `node:sqlite` (built in, no rebuild) or `better-sqlite3` plus `@electron/rebuild`. |
| R7 | Packaging and installing an Electron app needs a packager, and none is in the stack. | Decision D1 (16). Until then, run from source with `pnpm desktop`. |
| R8 | On Windows, Chrome 127+ encrypts cookies with App-Bound Encryption. Another app cannot decrypt them without Chrome's elevation service. The person develops on Windows. | S6 must measure this first. Expected outcome on Windows: bookmarks and history import, cookies do not, and the person signs in once inside Aether (11.1). |
| R9 | Google and some banks refuse sign-in from embedded Chromium (Electron) even with a Chrome user agent. This breaks the "already logged in" goal for those sites. | Added to S6. If it fails, the documented path is to sign in from the Human Space and send the tab to the Agent Space (11.1). |
| R10 | Hidden or detached `WebContentsView`s are throttled by Chromium: timers slow, `IntersectionObserver` lazy loading may not fire, and paint order may be stale. `mapPages` and `items` depend on all three. | Agent tab views use `backgroundThrottling: false` and keep real off-screen bounds. Verified in S7 (5.2). |
| R11 | Missing basic browser features a person expects from a Chrome-like browser: error pages, find in page, context menu, downloads UI, permission prompts, HTTP auth, certificate errors, external protocols, fullscreen, PDF, zoom, print, new tab page. | Section 10.6 lists each with the Electron hook used. |
| R12 | Electron security settings are not stated. | Section 9.7. |
| R13 | "Like Chrome" (the person's request) conflicts with the 3.0 left sidebar of vertical tabs. | Horizontal tab strip with a Space switcher at its left, as in Chrome. The side panel on the right holds Activity and Memory (10.2). |
| R14 | The shell UI had no design system, copy rules or accessibility rules. 3.0 colours also fail contrast: amber `#F5A524` on white is 2.0:1, below the 3:1 needed for UI components. | Section 10.1 gives tokens, 10.4 copy, and 10.5 accessibility, written with the design-system, ux-copy and accessibility-review skills. |
| R15 | Approving URLs one by one in `mapPages` over 30 new origins means 30 approvals. | One batched approval card lists all held URLs (9.4). |
| R16 | Two `aether_exec` calls on the same Space at once are undefined. Variables between calls are undefined. | Calls are serialized per Space. Each call gets a fresh context plus `space.state`, a small JSON store that persists across calls (7.2). |
| R17 | Cookie banner auto-dismiss clicks "Accept all", which is a privacy choice made for the person. | Prefer "Reject all" or "Only necessary". Accept only if no reject control exists and the setting allows it (6.1). |
| R18 | The steps put the daemon after the UI, so the person cannot drive Electron from a host until Step 4. Code Mode also could not be tried until Electron existed. | Code Mode is exposed first on the current 2.0 engine. The daemon now comes before UI polish (14). |
| R19 | The skill install path covers Antigravity only. The person currently tests in VS Code Copilot, which has no skills folder. | The skill installs for Claude Code and Antigravity. The same text ships as MCP server `instructions`, and the SDK declaration ships in the `aether_exec` description for hosts without skills (8.2). |
| R20 | Spike id S5 was already used in `docs/SPIKES.md` (items on real listings). | That entry is renamed S4b. 3.0 spike ids are kept. |
| R22 | 3.0 is written against the 2025 MCP handshake. MCP 2026-07-28 removes `initialize`, adds `server/discover`, Multi Round-Trip Requests and a Tasks extension, and has an official Skills extension. | Section 8.3: a dual-era server; Tasks for held runs when the host supports it; no approvals over elicitation; the skill served over MCP when supported. |
| R21 | 3.0 Step 0 says form tests fail. They pass on the 2026-11-18 baseline. | Step 0 keeps the `FORM` tag fix as a hardening task with its own fixture test, not as a regression fix. |

---

## 1. Motive

Build a desktop browser where a person and AI agents work side by side in separate Spaces without getting in each other's way. The connected host (Claude Code, VS Code Copilot, Cursor, Antigravity, Codex) supplies the reasoning, and Aether holds no API keys. Aether supplies:

- an Electron browser that keeps working when a page crashes;
- deterministic page landing;
- a sandboxed TypeScript Code Mode that runs multi-step and multi-tab work in one host turn;
- a quiet, Chrome-like interface with a live activity view and one-click handoff.

Anything that does not serve that paragraph is out of scope.

---

## 2. Rules that never bend

1. **A browser stays a browser.** Chain-of-thought prose, Code Mode source and chat stay in the host. Aether shows only these:
   - tabs and Spaces;
   - pages;
   - one-line activity milestones;
   - the Agent bar and its decision card.
2. **Code Mode over tool ping-pong.** Navigation, pagination, filtering and multi-tab fan-out run as TypeScript in the sandbox, not as many sequential model calls.
3. **The person's focus is protected.** Agents work only in Agent Spaces. An agent never reads, changes or focuses the Human Space, takes OS window focus, or moves the person's cursor.
4. **Resources are governed by measured pressure, not fixed caps.** Live tabs, concurrency and disk use scale from available memory, CPU count and free disk. Unviewed tabs are kept as metadata only. Overrides live in `~/.aether/config.json`.
5. **Never send a raw page to the model.** Only skims, focused regions, item harvests, surveys and deltas leave the engine. Every page-derived value is wrapped in `<page untrusted nonce=... origin=...>`.
6. **Page content is untrusted and Code Mode has only capabilities.** Sandbox code has no filesystem, network, process or raw CDP access. Every `space.*` call passes Policy and URL provenance in the main process.
7. **We own the CDP client and control path.** No Playwright, Puppeteer, LangChain or agent frameworks. Input is trusted CDP `Input.*` over `webContents.debugger`.
8. **One state machine per Space.** The tab strip, viewport frame, Agent bar, side panel and host tool results all render that one state.
9. **Approvals and secrets come only from the person in Aether.** No model argument or script can approve an irreversible action or read a masked value.
10. **A ref is an identity.** It is never reused or re-bound to another element.

---

## 3. Final stack (one choice per layer)

| Layer | Choice | Notes |
|---|---|---|
| Desktop shell | Electron (`BaseWindow` + `WebContentsView`), current stable at Phase 2 (45.2.2) | Must bundle Node >= 22.13 for `stripTypeScriptTypes` (Electron 35 or later). |
| Shell UI | React 19 + plain CSS with shared tokens (10.1), bundled with `vite` and `@vitejs/plugin-react` | No component library, no icon library; icons are inline SVG drawn for Aether. |
| Tab control | In-process CDP via `webContents.debugger`, wrapped in `@aether/cdp` | Same `CDPClient` contract as 2.0. |
| Eval and CI transport | Direct CDP to headless Chrome (`@aether/cdp` launcher) | Fixture tests without a display. |
| Language and runtime | TypeScript strict, Node >= 22.13 | `node:module` `stripTypeScriptTypes` for Code Mode. |
| Package manager | pnpm workspaces | `electron` added to `allowBuilds` for its binary download. |
| Code Mode sandbox | Decided by S5: `worker_threads` + `vm`, or a sandboxed hidden renderer | 7.1. |
| Validation | `zod` | All IPC, daemon, Code Mode RPC and MCP schemas in `packages/shared`. |
| Logging | `pino` | `~/.aether/aether.log`, rotated on start and by size. |
| Storage | SQLite through `node:sqlite` (decision D2), `~/.aether/aether.db` | Built into Node and Electron; no native module. |
| Agent reasoning | The connected host | No model SDKs or keys in Aether. |
| Host connection | `aether` command (the `apps/cli` binary) plus the `/aether` skill, both talking to the app service in Aether Desktop | `@modelcontextprotocol/sdk` only for the optional `aether mcp` adapter (8.0). |
| Chrome import | Own importer using the SQLite driver and `node:crypto` | Subject to S6. |
| Packaging | Decision D1 | Not chosen; run from source until decided. |
| Tests | `vitest` + `@aether/fixtures` | Electron end-to-end tests drive the app through the test control channel (Phase 2) and, from Phase 3, the app service. |
| Lint | Biome (WASM runner, `scripts/lint.mjs`) | |
| OS | Windows, Linux, macOS | Windows is the first development target, because it is the person's machine. |

No other libraries. `apps/extension` and `apps/native-host` stay working until Phase 6, so there is always a usable path.

---

## 4. Architecture

### 4.1 Components

```
Host (Claude Code / VS Code Copilot / Antigravity / opencode / Cursor)
  |  /aether skill (linked into the host's skills folder); shows reasoning, code and answers
  |  shell tool runs:  aether exec --space <name> --thought <line>  < script.ts
  |  (optional) MCP stdio -> `aether mcp`, a stateless forwarder of the same 4 operations
  v
`aether` command (apps/cli)  -- launches the app if it is not running, waits up to 15 s
  |  one JSON frame per line; token from ~/.aether/daemon.json
  v
App service (named pipe \\.\pipe\aether-<user> on Windows, ~/.aether/aether.sock elsewhere)
  v
Aether Desktop main process (Electron + Node)
  +-- ServiceServer       hello/token check, one session per client, requests -> CodeModeHost
  +-- SpaceManager        Human Space + Agent Spaces, one SpaceRunState each        (Phase 2)
  +-- TabLifecycle        live views, sleeping tabs, MemoryWatchdog, crash isolation (Phase 2)
  +-- DesktopSpaceEngine  the `space.*` SDK over SpaceManager + Electron CDP         (Phase 3)
  +-- SmartLanding        settle, consent banner per setting, archetype              (Phase 1)
  +-- CodeModeHost        sandbox per run, capability RPC, held runs                 (Phase 1)
  +-- Kernel              Perceiver | Actor | Policy | Memory | RunLog               (2.0)
  +-- ShellWindow         BaseWindow with three view layers (4.4)                    (Phase 2, UI in Phase 4)
  +-- AgentHost           off-screen BaseWindow for background Agent tabs            (Phase 2)
```

### 4.2 Single-instance app service

1. Aether Desktop owns the only service. It uses `app.requestSingleInstanceLock()`, so a second launch focuses the first window (built in Phase 2).
2. On start the app listens on the endpoint and writes `~/.aether/daemon.json` (`DaemonConfigSchema` in `packages/shared/src/daemon.ts`): protocol version, pid, endpoint, a random 32-byte token, app version, start time. On Windows the file gets an ACL for the current user only; elsewhere mode `0600`. It is removed on a clean exit. A stale file (dead pid) is replaced by the next start.
3. Frames: the client's first frame is `hello` with the token; the service answers `welcome` with a session id, or `fatal` (`bad_token`, `protocol`) and closes. Then `request {id, tool, params}` and `response {id, result}`, where `result` is the same `ToolResult` both connectors render. Requests on one connection may overlap; responses carry the id.
4. Sessions: each connection is one session. A session's Agent Spaces are named by the host (`--space`); two sessions that name the same Space share it, and calls on one Space are serialized (7.2). Sessions never disconnect each other. A held run belongs to its Space, not to the connection, so `aether wait <token>` works from a new process.
5. The `aether` command and `aether mcp` are both clients. Neither keeps state between runs. Nothing but JSON-RPC is printed to stdout by `aether mcp` (the 2.0 launch test is kept).
6. `aether mcp --direct --headless` keeps the headless Chrome engine for CI and evaluations. It never touches the person's profile.
7. Until Phase 6 removes it, the Chrome extension path stays reachable as `aether mcp --extension`, so there is always a working path while the app matures.

### 4.3 Space state machine

```
idle -> acting -> waiting_human -> resuming -> acting -> ... -> done -> idle
```

`waiting_human` carries one reason: `question`, `approval`, `must_perform`, `user_interrupted`, or `captcha`.

- **`acting`**: a script or action runs in this Space.
  - The viewport frame and the Space chip pulse blue.
  - The Shell Overlay shield is attached while the person views the Space.
- **`waiting_human`**: the sandbox is paused at the `space.*` call that caused the hold.
  - Frame, chip and Agent bar turn amber, and the shield is removed.
  - The decision card opens in the side panel.
- **`resuming`**: the person answered, approved, denied, or pressed "Hand back to Aether".
  - The engine re-captures the page, then resolves or rejects the paused call.
  - On a denial, the script gets a rejected promise and may handle it.
- **`done`**: the frame turns off and the tabs stay browsable until the person closes or archives the Space.

Take over and Stop act at once, whether or not an engine call is in flight. This is the behaviour fixed in 2.0 on 2026-11-13.

### 4.4 Window layers (new in 3.1)

A `BaseWindow` holds three view layers, bottom to top:

1. **Shell view**: the React shell (tab strip, toolbar, Agent bar, side panel). Full window bounds.
2. **Tab view**: the active tab's `WebContentsView`, placed in the viewport rectangle. In an Agent Space it is inset by 2 px so the frame drawn by the shell view shows around it.
3. **Shell Overlay view**: a transparent `WebContentsView` (`setBackgroundColor('#00000000')`) over the viewport rectangle. It is attached only while needed:
   - Input shield while `acting` and the Space is visible. It takes the person's clicks and keys and shows the hint "Aether is working. Press Take over or Esc."
   - Ghost cursor and target reticle, drawn from Actor `onActionTarget` coordinates.
   - Omnibox suggestions, the Space switcher menu, and toasts, while open.

When no overlay is needed, the view is removed and the page gets input directly. Overlay content never appears in `capturePage` of the tab, so screenshots stay clean. Native `Menu.popup` is used for the main menu and the page context menu.

### 4.5 End to end: one task from the editor to the app

1. The person types `/aether find a waterproof watch under 3000 with at least 4 stars` in their editor.
2. The host loads `~/.claude/skills/aether/SKILL.md` (or the matching folder for that host). The skill tells it to run `aether skill` once, which prints the working method and the `space` SDK declaration for the installed version.
3. The host writes one script and runs `aether exec --space "Watch hunt" --thought "Searching three shops" < script.ts` through its shell tool.
4. `aether` reads `daemon.json`. If the app is not running it starts it (minimised to nothing new for the person: the window opens only if it was closed) and waits for the service.
5. The service creates the Agent Space "Watch hunt". The script runs in the sandbox. Each `space.*` call goes through Policy, then to the Space's tabs in the agent host window. The person keeps browsing in Personal; the Space chip shows a blue dot.
6. If the script hits an approval, the Space turns amber, the decision card opens, and the call waits. After 50 s the command prints `held: <token>` and exits with code 2; the host runs `aether wait <token>` to keep waiting.
7. The script returns a shortlist. `aether` prints the result text (page data wrapped untrusted) and exits 0. The host answers the person and calls `aether done`, which ends the run, writes the RunLog and turns the frame off.

---

## 5. Spaces, tabs and resource lifecycle

### 5.1 Spaces

1. **Human Space ("Personal")**:
   - The default Space: normal tabs, history, bookmarks, DevTools.
   - Agents have no API to read, list, change or focus its tabs.
   - The only bridge is the person's own command **Send tab to Agent Space** (tab context menu or toolbar). It moves the tab and its history.
2. **Agent Spaces**:
   - One per task, named by the host (`space` argument) or after the task.
   - They share the `persist:aether` partition by default, so signed-in sites work. An `ephemeral` partition is available for clean-room tasks.
3. **Background execution**:
   - Agent Spaces run while the person stays in the Human Space.
   - Choosing an Agent Space in the switcher moves its active view into the viewport at once.

### 5.2 Hibernated tabs and pressure governance

1. **Tab record**: `{ id, spaceId, url, title, favicon, scrollY, state: 'live' | 'loading' | 'hibernated' | 'crashed' }`. A hibernated tab has no renderer.
2. **`space.openTabs(urls, { lazy })`**:
   - Mounts the first tab.
   - Mounts more in the background only while free memory is above the reserve.
   - Records the rest as hibernated.
   - Returns `{ tabIds, live, hibernated }`.
3. **`space.mapPages(urls, fn)`**:
   - Concurrency before each dispatch = `min(availableParallelism() - 1, floor((MemAvailable - reserve) / 350 MB))`, at least 1.
   - The per-page estimate is 150 MB working set, as measured in S7. It is corrected at run time from `app.getAppMetrics()`.
   - Each page hibernates after `fn` returns.
4. **Background views** (S7, 2026-11-18). A view that is not attached to a shown window does not render. Trusted input, `IntersectionObserver`, lazy images, animation frames and screenshots all stop. `setVisible(false)` behaves the same, and `backgroundThrottling: false` alone does not help. Therefore:
   - Live Agent tabs that the person is not viewing sit in the **agent host window**:
     - an invisible `BaseWindow`, shown without activation and placed outside every display;
     - no taskbar entry, not focusable;
     - the size of the main viewport.
   - Viewing an Agent Space moves its active view into the main window. Leaving it moves the view back.
   - Agent tab views use `backgroundThrottling: false`.
5. **Request filtering in Agent Spaces**: `session.webRequest.onBeforeRequest` blocks a short, hand-maintained list of ad and sync hosts in `packages/policy/src/blocklist.ts`, and autoplay media requests for background views. No third-party filter list is bundled, because of licence terms.
6. **MemoryWatchdog**: when available memory falls below `minFreeMemoryRatio` (default 0.2), it hibernates the least recently viewed background tabs, a few per check. Scroll position is kept in the tab record. It never sleeps:
   - the tab on screen;
   - any Space's active tab (the one its agent works in);
   - a tab woken less than 30 s ago, so a page an agent just opened is read before it can sleep.

   Found in Phase 2 testing: without these exceptions, real memory pressure put a just-opened agent tab to sleep before the agent read it.
7. **Crash isolation**: on `render-process-gone`, only that tab becomes `crashed`. The SDK call on it rejects with a recoverable error, and the tab shows the crashed page (10.6).

---

## 6. Smart Landing and perception

### 6.1 Smart Landing (deterministic, no model tokens)

Every navigation runs these steps before returning:

1. **Settle**: main-frame DOM ready, then network quiet or a stable AX structure hash. Target 250 ms after load; hard cap 2.5 s.
2. **Consent banner** (decision D3, 2026-11-18): the person's **Cookie banners** setting, `cookieBanners` in `~/.aether/config.json`, edited later on the Settings page in Phase 4. Only the person can change it.
   - **What counts as a banner:**
     - Any banner in view whose buttons use a consent phrase, with cookie or consent text in the same region or within 10 lines. It does not have to cover the page.
     - A region that holds an input field never counts, so login, paywall and form dialogs are never touched.
   - **`reject`** (default): click the option that refuses optional cookies ("Reject all", "Only necessary", "Necessary only", "Continue without accepting"). If there is none, the banner is left alone and the agent is told. It never accepts for the person.
   - **`accept`**: click "Accept all".
   - **`off`**: never touch a banner. The agent is told its refs.
   - **Check:** after a click the page is captured again to confirm the banner is gone, with up to two attempts. Otherwise the agent is told it is still showing.
   - **Notes:** each outcome is one note, such as "closed a cookie banner (rejected optional cookies) in 120 ms". Notes name refs only, never page text.
   - **Change from 3.0:** 3.0 acted only when more than half the controls were covered. 3.1 follows the setting for any banner in view, because "always reject" is what the person asked for.
3. **Archetype**: `listing`, `product`, `form`, `article`, `auth_gate`, `captcha`, or `other`. Added to `PageBrief`.

### 6.2 Perception views (kept from 2.0)

| View | SDK | Budget |
|---|---|---|
| Skim | `space.skim()` | 1,200 tokens |
| Focus | `space.focus(ref, { after })` | 1,500 |
| Text | `space.text(ref?, { after })` | 2,000 |
| Items | `space.items()` (scrolls, segments, adds JSON-LD product facts) | 2,200 |
| Survey | `space.survey({ query, budget, minRating, maxPages })` (ItemBucket + ProductGraphMatcher) | 400 to 600 |
| Find | `space.find(query, role?)` | ranked list |
| Delta | returned by `space.act()` | |

`ProductGraphMatcher` scoring is documented in `docs/PERCEPTION.md` (task 3.11). It defines the pairwise Jaccard centrality and composite ranking score. That document describes perception, not overall phase completion.

---

## 7. Code Mode (`packages/codemode`)

The host writes one short TypeScript program against the `space` SDK, rather than stepping through loops one MCP call at a time.

### 7.1 Sandbox

1. **Transpile**: `stripTypeScriptTypes(code, { mode: 'strip' })`. Types become whitespace, so line and column numbers in errors match the host's code.
2. **Boundary, chosen by S5**:
   - **Option A**: a `worker_threads` worker running the code in a `vm` context.
     - Only plain ECMAScript intrinsics, `space` and a capped `console.log`.
     - Intrinsics are frozen; code generation from strings is disallowed (`codeGeneration: { strings: false, wasm: false }`).
     - Only structured-clone data crosses the boundary, never host objects.
   - **Option B**: a hidden `WebContentsView` sandboxed by Chromium.
     - Settings: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, on its own partition.
     - All network refused by `webRequest`; CSP `default-src 'none'`.
     - It talks to the main process over a `MessagePort`.
   - Option A is used only if S5 shows no escape to `process`, `require` or host prototypes, using the known escape classes (constructor chains, `Error.prepareStackTrace`, Proxy traps on passed objects, async-hook leaks). Otherwise Option B.
3. **Stall watchdog, no wall-clock limit on a working script**:
   - The run is stopped only when no `space.*` call, settle or hold has happened for 30 s and the event loop is busy.
   - Stopping means `worker.terminate()`, or destroying the view.
   - Stop and Take over end or pause the run at once.
4. **Capability RPC**: each `space.*` call is a message to `CodeModeHost`, which:
   1. validates with zod;
   2. runs Policy;
   3. executes;
   4. logs a milestone when the call is a milestone;
   5. returns plain data.
5. **Errors**: an uncaught error returns `{ error, line, column }` against the host's code, wrapped as untrusted if any page was read.

### 7.2 SDK declaration (shipped in the skill and in the `aether_exec` description, about 700 tokens)

```ts
type Ref = string; // e12
interface PageBrief {
  url: string; title: string; tabId: string;
  archetype: 'listing' | 'product' | 'form' | 'article' | 'auth_gate' | 'captcha' | 'other';
  landing: string[];            // Smart Landing notes, e.g. 'closed cookie banner'
  skim: string;                 // untrusted text, refs inline
  product?: { name?: string; price?: string; availability?: string; rating?: string; seller?: string };
}
interface BucketItem {
  key: string; ref: Ref; title: string; prices: string[]; numericPrice?: number;
  rating?: string; numericRating?: number; reviews?: string; notes: string[];
  isSponsored: boolean; isOutOfStock: boolean; linkUrl?: string; sourceUrl: string; pageNumber: number;
}
interface SurveyResult {
  shortlist: Array<{ item: BucketItem; score: number; highlights: string[] }>;
  pruned: Array<{ key: string; title: string; price?: string; reason: string }>;
  stats: { pages: number; harvested: number };
}
interface FindMatch { ref: Ref; role: string; name: string; context: string }
interface ActionItem { op: 'click' | 'fill' | 'key' | 'hover' | 'scroll' | 'dialog' | 'upload'; ref?: Ref; value?: string }
interface ActDelta { ok: number; total: number; stoppedBy?: 'failure' | 'navigation' | 'dialog' | 'person'; delta: string; url: string }

declare const space: {
  open(url: string, opts?: { newTab?: boolean }): Promise<PageBrief>;
  openTabs(urls: string[], opts?: { lazy?: boolean }): Promise<{ tabIds: string[]; live: number; hibernated: number }>;
  mapPages<T>(urls: string[], fn: (page: PageBrief) => Promise<T> | T): Promise<Array<{ url: string; data?: T; error?: string }>>;
  switchTab(tabId: string): Promise<PageBrief>;
  tabs(): Promise<Array<{ id: string; title: string; url: string; state: 'live' | 'hibernated' | 'crashed' }>>;
  skim(): Promise<PageBrief>;
  focus(ref: Ref, opts?: { after?: string }): Promise<string>;
  text(ref?: Ref, opts?: { after?: string }): Promise<string>;
  items(): Promise<BucketItem[]>;
  survey(opts: { query: string; budget?: number; minRating?: number; maxPages?: number }): Promise<SurveyResult>;
  find(query: string, role?: string): Promise<FindMatch[]>;
  act(actions: ActionItem[], opts: { risk: 'read' | 'reversible' | 'irreversible'; why: string }): Promise<ActDelta>;
  logStep(milestone: string): Promise<void>;
  ask(question: string, opts?: { options?: string[]; handoff?: boolean }): Promise<{ reply: string; page: PageBrief }>;
  memory(op: 'recall' | 'save', params?: { site?: string; key?: string; value?: string }): Promise<string>;
  /** JSON store for this Space, kept across aether_exec calls; 64 KB. */
  state: { get<T>(key: string): Promise<T | undefined>; set(key: string, value: unknown): Promise<void> };
};
```

Calls on one Space are serialized. A second `aether_exec` on a busy Space returns `space busy: <current milestone>`. It is not queued silently.

### 7.3 Untrusted data across Code Mode

If a run read any page, its return value and errors are wrapped in `<page untrusted nonce=... origins="...">`. Engine metadata stays outside: timings, tab counts, policy receipts and milestones.

### 7.4 Compact returns

1. Perception views are compact by construction and paged with `after`.
2. The script's structured return is passed back unchanged. Only a single string over 256 KB, or a total over 1 MB, is rejected, with "return fewer fields".
3. `openTabs` returns counts and ids, not page skims.

---

## 8. Host bridge

### 8.0 Connection: command plus skill first, MCP optional (decided 2026-11-18)

The product is the Aether browser app. Hosts reach it the way ego lite's are reached on this machine:
- an `aether` command on PATH;
- one skill folder linked into every host's skills directory.

Nothing has to be configured per host.

1. **Installer** (Phase 3; packaging per D1). It installs the app and puts `aether` on PATH. It links one skill folder (`skills/aether`, shipped with the app) into every host's skills directory:

   | Host | Link |
   |---|---|
   | Claude Code | `~/.claude/skills/aether` |
   | VS Code (Copilot agent skills) | `~/.copilot/skills/aether` and `~/.agents/skills/aether` |
   | Antigravity | `~/.gemini/config/skills/aether` and `~/.gemini/antigravity-cli/skills/aether` |
   | opencode | `~/.config/opencode/skills/aether` |

   - On Windows these are directory junctions, which need no admin rights; elsewhere symlinks.
   - A host's parent folder that does not exist is skipped and reported, not created, so Aether never invents a config tree for a host that is not installed.
   - A folder named `aether` that is not Aether's own link is left alone and reported.
   - `aether install-skill` repeats this step (after a host is installed later); `aether uninstall-skill` removes only Aether's links.
2. **Skill**. `SKILL.md` is a short bootstrap (under 1,500 characters): when to use Aether, then "run `aether skill` and follow it". `aether skill` prints the working method (8.2) and the SDK declaration (7.2) for the installed version, so an app update updates every host with no relinking.
3. **Command**. The same four operations as the tools in 8.1, over the app service, plus housekeeping:

   | Command | Operation |
   |---|---|
   | `aether exec --space <name> --thought <line> [--file <script.ts>]` (script on stdin when no `--file`) | `aether_exec` |
   | `aether wait <token>` | `aether_exec` with `wait` |
   | `aether screenshot --space <name> [--ref <ref>] [--out <file.png>]` | `aether_screenshot`; prints the PNG path |
   | `aether spaces [list \| focus <name> \| close <name>]` | `aether_spaces` |
   | `aether done --space <name> --success <yes\|no> --result <text> [--evidence <text>]` | `aether_done` |
   | `aether skill` | prints the method and SDK declaration |
   | `aether install-skill`, `aether uninstall-skill` | manage the host links |
   | `aether status` | is the app running, which Spaces are busy |
   | `aether doctor` | checks the install, PATH, every link, the service and the app version |

   - Output is the same text the MCP tool returns, so the method text reads the same in both.
   - Exit codes: `0` done, `1` the script failed (error text printed), `2` held (token printed), `3` the app could not be started or reached, `4` bad usage.
   - The command starts the app when it is not running and waits up to 15 s for the service; it never opens a second app.
4. **MCP** (`aether mcp`). An optional thin adapter over the same service, for hosts with no skills or no shell tool. It is built last in Phase 3, and dropped if S10 shows every host the person uses works with the command and skill.

### 8.1 Four operations (as MCP tools: definitions under 450 tokens, excluding the SDK text in the `aether_exec` description)

| Tool | Arguments | Purpose |
|---|---|---|
| `aether_exec` | `space?`, `thought`, `code?`, `wait?` | Runs `code` in the named Agent Space, creating the Space if needed, and posts `thought` as a milestone. If the run is held longer than 50 s, it returns `held: <token>, reason`. Calling again with `wait: <token>` and no code keeps waiting and returns the run's result once released. A held run's result is kept for 10 minutes. |
| `aether_screenshot` | `space`, `ref?` | Downscaled PNG of the active viewport or one element. Overlays are never in it. |
| `aether_spaces` | `op: 'list' \| 'focus' \| 'close'`, `space?` | List Agent Spaces and tabs, show one in the window, or close one. |
| `aether_done` | `space`, `result`, `evidence`, `success` | Ends the run, turns the frame off, writes RunLog, may save a procedure. |

### 8.2 The working method, in three places

1. `aether skill`, reached from `skills/aether/SKILL.md` in every host listed in 8.0.
2. MCP server `instructions`, for hosts that use the optional adapter. Generated from `apps/cli/src/codemode/instructions.ts`.
3. The `aether_exec` description, which holds the SDK declaration (`apps/cli/src/codemode/sdk-declaration.ts`).

A test checks that all three contain the same method rules and the same SDK text.

The method has six rules:
- Restate the criteria.
- Sort and filter first.
- Use `survey` or `items` across pages.
- Shortlist at least three and verify each product page with `mapPages`.
- Ask when options are close.
- Use `risk: 'irreversible'` before any purchase, booking or submit.

### 8.3 MCP protocol version and extensions (added 2026-11-18)

Code Mode is an integration pattern, not an MCP feature. Cloudflare and Anthropic both describe it as a typed API run in a sandbox behind one or two tools. Aether's `aether_exec` follows that pattern. The protocol under it changed on 2026-07-28, and that revision affects four parts of this plan.

**The 2026-07-28 revision**:
- It is stateless: no `initialize` handshake and no sessions. Version and client capabilities travel in every request's `_meta`.
- Servers must implement `server/discover`. Its result carries `instructions`.
- Server-to-client requests (elicitation, sampling) are replaced by Multi Round-Trip Requests: a tool returns `resultType: "input_required"` with `inputRequests` and an opaque `requestState`, and the client retries with `inputResponses`.
- Tasks moved to an official extension, `io.modelcontextprotocol/tasks`. A call returns a task handle; the client polls `tasks/get` and supplies input with `tasks/update`.
- Sampling, roots and logging are deprecated.

**Where the hosts and SDK are (checked 2026-11-18)**:
- `@modelcontextprotocol/sdk` 1.32.2, the latest on npm and the version installed, speaks `2025-11-25` (handshake era).
- The official client matrix does not show which hosts support Tasks or Skills over MCP. Host support is therefore unknown until S10 measures it.

**Decisions**:
1. **Dual-era server.**
   - The daemon's MCP surface answers both the legacy `initialize` handshake (today's hosts) and modern per-request `_meta` with `server/discover`.
   - The method text is served in both places: `initialize.instructions` and `DiscoverResult.instructions`.
   - Modern-era support waits for an SDK release that implements it. No hand-written protocol layer is built.
2. **Held runs.**
   - If the client declares `io.modelcontextprotocol/tasks`, a run that holds longer than 50 s returns a task. Polling `tasks/get` then replaces the `wait` token, and `tasks/cancel` maps to Stop.
   - Otherwise the `wait` token in 8.1 is used. Both paths read the same held-run record.
3. **No approvals through MRTR elicitation.**
   - Approvals, secrets and Take over stay in Aether (rule 9). An elicitation is shown by the host, can be answered by the host on the person's behalf, and cannot show the page beside the card.
   - Only `space.ask` questions may also be offered as a form elicitation, and only if the client declares support. The first answer from either Aether or the host wins, and the other card is withdrawn.
4. **Skill delivery.**
   - When a host declares `io.modelcontextprotocol/skills`, the server serves `skill://aether/SKILL.md` through `skills/list`, `skills/get` and `resources/read`, with a SHA-256 manifest.
   - Hosts without it use the installed file or the server instructions (8.2).
   - One source file feeds all three.

**Tool definitions**:
- `tools/list` is returned in a fixed order, so host prompt caches stay valid.
- `aether_exec` declares an `outputSchema`. The result keeps its text block (wrapped untrusted text) and adds `structuredContent` for engine metadata only: milestones, timings, tab counts, held state. Page-derived data never goes in `structuredContent`, because hosts may show or forward it without the untrusted wrapper.

**Why not Cloudflare's "search plus execute" pair**: Cloudflare adds a search tool because its API spans thousands of operations. Aether's whole SDK declaration is about 700 tokens, so it ships inline in the `aether_exec` description. A search tool would cost an extra turn to save nothing.

---

## 9. Policy and safety

The working assumption: prompt injection will sometimes steer the host model. Policy in the main process bounds what any script can do.

1. **Four outcomes** on every `space.act`, `space.open`, `openTabs` and `mapPages`: `allow`, `needs_approval`, `human_must_perform`, `refuse`. They are evaluated on the resolved node and parsed URL in the main process.
2. **`human_must_perform`**: typing into password, OTP or card fields, and CAPTCHAs.
3. **`needs_approval`**:
   - declared `irreversible` risk;
   - trigger words on activating controls (buy, pay, place order, send, post, publish, delete, submit, confirm, transfer, subscribe);
   - submits carrying identity or payment fields;
   - uploads from outside `~/.aether/spaces/<id>/downloads`.
4. **URL provenance** (`classifyOpen`) on every URL a script passes. A URL is allowed when any one of these holds:
   - the origin was already visited in the run;
   - the exact URL appeared as a link `href` on a page in the run;
   - the URL goes to a new origin with no query or fragment.

   Otherwise it is held. URLs held in one call are approved or denied together on one card.
5. **Refused schemes**: `file:`, `chrome:`, `devtools:`, `javascript:`, `data:`, and external protocols (`mailto:`, app links) for agents.
6. **Take over**:
   - Pressing Take over, or Esc while the shield is up, sets `user_interrupted` at once.
   - Remaining actions in the current batch are aborted, and the script pauses before its next SDK call.
   - The shield is removed, the frame turns amber, and the person uses the page.
   - "Hand back to Aether" resumes the run.
7. **Electron hardening**:
   - All views use `contextIsolation`, `sandbox: true` and `nodeIntegration: false`. The shell preload exposes only typed IPC.
   - The shell has a strict CSP.
   - `setWindowOpenHandler` opens popups as tabs in the same Space. Exception: OAuth popups that need `window.opener` open as a child window.
   - `will-navigate` checks apply to the shell view.
   - The permission request handler denies camera, microphone, location, notifications, MIDI and clipboard read in Agent Spaces. In the Human Space it asks the person.
   - `webContents.debugger` is never attached to Human Space tabs.

---

## 10. Shell UI (`apps/desktop/renderer`)

Principle: it should look and behave like a quiet Chrome. Agent work shows in exactly three places: the frame, the Agent bar and the side panel. There are no chat threads, code blocks or model settings.

### 10.1 Design tokens (`apps/desktop/renderer/tokens.css`)

Ratios are measured against `--surface` (`scripts/check-contrast.mts` in Phase 4 recomputes them). All colours, sizes and durations come from these tokens. Hard-coded values in component CSS fail lint review.

**Colour, light theme / dark theme**

| Token | Light | Dark | Use |
|---|---|---|---|
| `--frame` | `#E8EBEF` | `#1B1C1F` | Window and tab strip background |
| `--surface` | `#FFFFFF` | `#28292D` | Active tab, toolbar, side panel |
| `--field` | `#F1F3F5` | `#323438` | Omnibox and inputs at rest |
| `--hover` | `#00000012` | `#FFFFFF14` | Hover fill |
| `--border` | `#D5D9DE` | `#3B3D42` | Dividers |
| `--text` | `#1B1D21` | `#E8EAED` | Primary text (16.9:1 / 12.1:1) |
| `--text-muted` | `#5B616B` | `#A2A7B0` | Secondary text (6.2:1 / 6.0:1) |
| `--focus` | `#2558D6` | `#7AA2FF` | Focus ring |
| `--agent` | `#2F6BFF` | `#2F6BFF` | Acting frame and chip (UI only, 4.5:1 / 3.2:1) |
| `--agent-text` | `#2558D6` | `#7AA2FF` | Acting text (6.1:1 / 5.8:1) |
| `--wait` | `#B76E00` | `#F5A524` | Waiting frame and chip (4.0:1 / 7.1:1) |
| `--wait-text` | `#9A5B00` | `#F5A524` | Waiting text (5.4:1 / 7.1:1) |
| `--danger` | `#C5221F` | `#F28B82` | Stop and errors |

The 3.0 amber `#F5A524` is kept for the dark theme only. On white it measures 2.0:1, below the 3:1 required for UI components (WCAG 1.4.11).

**Type**: system font stack (`Segoe UI Variable`, `-apple-system`, `system-ui`). Sizes: 12 (tab titles, meta), 13 (UI default), 14 (omnibox, card body), 16 (card title). Weights: 400 and 600 only. Line height 1.35.

**Space and size**:
- Spacing scale: 4 px (2, 4, 8, 12, 16, 24).
- Row heights: tab strip 36, toolbar 40, Agent bar 32.
- Side panel width: 320, resizable from 280 to 480.
- Hit targets at least 28 × 28 (WCAG 2.2 2.5.8 requires 24).

**Shape**: radius 8 for tab tops, 6 for controls, 999 for the omnibox and chips. One elevation shadow, used for popovers only.

**Motion**:
- UI transitions: 120 ms ease-out.
- Acting pulse: opacity of the frame cycles 0.55 to 1 over 2.4 s.
- Under `prefers-reduced-motion`, the frame is static.
- No other animation.

### 10.2 Layout

```
+--------------------------------------------------------------------------------+
| [● Personal v] | Tab A x | Tab B x | +                              _  []  x   |  tab strip 36
| <  >  C   ( example.com/path                                 )  ◐2  ▣  :       |  toolbar 40
| ●  Comparing 12 listings · 0:42 · 3 open · 9 sleeping      Take over   Stop    |  Agent bar 32 (Agent Spaces only)
| +----------------------------------------------------------+ +---------------+ |
| |                                                          | | Activity      | |
| |   page (WebContentsView), 2 px frame in Agent Spaces     | | ✓ Opened ...  | |
| |                                                          | | ● Comparing.. | |
| |                                                          | |  [decision]   | |
| +----------------------------------------------------------+ +---------------+ |
+--------------------------------------------------------------------------------+
```

- **Space switcher chip** (left of the tabs):
  - Shows the current Space name and a status dot.
  - The menu lists Personal, then Agent Spaces with state, then "Archived".
  - Ctrl+Shift+1..9 switches Space.
- **Tab strip**: Chrome-like horizontal tabs.
  - Agent tabs carry no extra chrome. The Space is the boundary, not the tab.
  - A sleeping tab shows its favicon at 50 % opacity, with the tooltip "Sleeping to save memory. Click to load."
- **Toolbar**:
  - back, forward, reload;
  - omnibox (shows the host only when not focused, the full URL on focus);
  - agent indicator `◐2`: the number of running Agent Spaces, amber if any is waiting; the click opens the switcher;
  - side panel toggle;
  - main menu.
- **Agent bar**: shown only in Agent Spaces. Contents:
  - status dot;
  - the current milestone;
  - elapsed time;
  - tab counts in plain words;
  - Take over and Stop.

  While waiting it reads "Aether needs you: <short reason>" and its button opens the decision card.
- **Side panel**:
  - Tabs: Activity and Memory.
  - It opens by itself when a decision is needed, and closes on Ctrl+\\.
  - Activity holds the milestone timeline (check for done, dot for current, duration on the right) and the decision card on top while waiting.

Windows uses `titleBarOverlay` so the tab strip runs under the system caption buttons. On macOS the traffic lights sit at the left of the tab strip.

### 10.3 Components and states

| Component | States | Notes |
|---|---|---|
| Tab | active, inactive, hover, loading (spinner in favicon slot), sleeping, crashed (warning icon), audible (speaker, click to mute) | Middle click closes. Drag reorders within a Space. |
| Space chip | personal, acting (pulsing blue dot), waiting (amber dot), done (grey dot) | The dot is never the only signal: the menu row also states the state in words. |
| Omnibox | rest, focused, suggestions open (in the Shell Overlay view), error | Suggestions draw on history, bookmarks and the search engine. |
| Agent bar | acting, waiting, done (fades out after 4 s, leaving "Done · result" in Activity) | `role="status"`, `aria-live="polite"`; waiting uses `aria-live="assertive"` once. |
| Decision card | question (options or free text), approval, your turn, you have control, captcha | Exactly one primary button. |
| Approval card | site, element (shown quoted as page text), values with secrets masked, the agent's stated reason labelled "Aether says" | Buttons are fixed copy: "Approve" and "Deny". Labels are never built from page text, because a page could name its button "Cancel". |
| Milestone row | running, done, held, failed | One line, ellipsis, full text in tooltip. |
| Shield | shown while acting and visible | Hint in the bottom centre. Click anywhere shows the hint again; the page receives nothing. |
| Ghost cursor | moving, target bracket | 200 ms glide; static under reduced motion. |

### 10.4 Copy

Rules: verbs on buttons, plain words, the same term for the same thing everywhere. "Sleeping" replaces "hibernated" and "virtual" in the UI; "Space" stays.

| Place | Copy |
|---|---|
| Agent bar, acting | `<milestone> · 0:42 · 3 open · 9 sleeping` |
| Agent bar, waiting | `Aether needs you: <reason>` + button `Review` |
| Take over / Stop | `Take over` / `Stop task` |
| Person has control | Card title `You have control`, body `Aether is paused. Use the page, then hand it back.`, button `Hand back to Aether` |
| Your turn (password, OTP) | Title `Your turn`, body `<handoff text from the agent, quoted>`, button `I'm done` |
| CAPTCHA | Title `Solve the check on this page`, button `I'm done` |
| Approval | Title `Approve this step on <site>?`, buttons `Approve` / `Deny` |
| URL approval | Title `Open <n> new sites?`, list of full URLs, buttons `Open all` / `Deny` |
| Shield hint | `Aether is working. Press Take over or Esc to use this page.` |
| Activity empty | `No agent tasks yet. Ask your editor to use /aether and progress shows here.` |
| Network error page | `This site can't be reached. <host> took too long to respond. Check the address, then try again.` + `Try again` |
| Crashed tab | `This tab stopped working. The page ran out of memory or hit an error.` + `Reload` |
| Done | `Done · <result, first line>` |
| Stopped | `Stopped by you` |

### 10.5 Accessibility (WCAG 2.2 AA)

- **Contrast**: all text pairs in 10.1 are at least 4.5:1, and UI component colours at least 3:1, in both themes. CI checks the token table with a small script (`scripts/check-contrast.mts`).
- **Not colour alone**: every state carries text (Agent bar, menu rows, card titles).
- **Keyboard**: every control is reachable with a visible 2 px `--focus` ring. Chrome-parity shortcuts:

| Keys | Action |
|---|---|
| Ctrl+T | New tab |
| Ctrl+W | Close tab |
| Ctrl+Shift+T | Reopen closed tab |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous tab |
| Ctrl+1..9 | Go to tab 1 to 9 |
| Ctrl+L, Alt+D, F6 | Focus the omnibox |
| Alt+Left / Alt+Right | Back / forward |
| Ctrl+R, F5 | Reload |
| Ctrl+F | Find in page |
| Ctrl+Plus / Ctrl+Minus / Ctrl+0 | Zoom in / out / reset |
| Ctrl+H | History |
| Ctrl+J | Downloads |
| Ctrl+D | Bookmark the page |
| F12 | DevTools |
| Ctrl+\\ | Side panel |
| Ctrl+Shift+1..9 | Switch Space |
| Esc (while the shield is up) | Take over |

- **Roles**:
  - The tab strip is a `tablist` of `tab`s.
  - The omnibox is a `combobox` with a `listbox`.
  - The side panel is a `complementary` landmark.
  - The decision card is a `dialog` that does not trap focus, and moves focus to its primary button when it appears.
- **Motion**: `prefers-reduced-motion` turns off the pulse and the ghost-cursor glide.
- **Zoom**: the shell works at 200 % shell zoom without horizontal scrolling at 1280 px window width.
- **Exit check** for Phase 4: a keyboard-only run and an NVDA (Windows screen reader) pass over the decision card flow, recorded in `docs/A11Y.md`.

### 10.6 Browser basics (Electron hook)

| Feature | Hook |
|---|---|
| Error pages | `did-fail-load`, which loads `aether://error` |
| Crashed tab | `render-process-gone` |
| Find in page | `webContents.findInPage`; the bar sits in the Shell Overlay view |
| Context menu | `context-menu` event and a native `Menu`, including "Send tab to Agent Space" |
| Downloads | `session.on('will-download')`, toolbar popover; Agent Spaces save to the Space folder |
| Permissions | `setPermissionRequestHandler`; the Human Space shows a bubble under the omnibox |
| HTTP auth | `app.on('login')`, a shell dialog; agents get `human_must_perform` |
| Certificate errors | `certificate-error`, an interstitial; agents get `refuse` |
| External protocols | `setWindowOpenHandler` and `will-navigate`, which ask before `shell.openExternal` in the Human Space and refuse in Agent Spaces |
| Fullscreen video | `enter-html-full-screen`; the tab view fills the window |
| PDF | Electron's built-in viewer (`plugins: true`) |
| Zoom, print | `setZoomLevel` per site; `webContents.print` |
| New tab page | `aether://newtab`: focused omnibox and recent Spaces only |
| History and bookmarks | `aether://history`, a bookmarks bar toggle (Ctrl+Shift+B) |

Not in 3.1: Chrome extensions, password manager integration, sync, DRM video (Widevine). Each is stated on the About page so nobody assumes otherwise.

---

## 11. Chrome import, memory, storage

### 11.1 Chrome import (subject to S6)

1. Copy only `Cookies` and `History` to a temp folder, read `Bookmarks` JSON directly, and delete the copies in `finally`.
2. Decrypt cookies where the OS allows:
   - Linux: libsecret or the default key.
   - macOS: Keychain, which prompts the person.
   - Windows: v10 cookies via DPAPI. v20 cookies (App-Bound, Chrome 127+) are expected to be undecryptable, and S6 confirms this.
   - Cookies that cannot be decrypted are skipped, and the import reports how many.
3. Set a current Chrome user agent and `Sec-CH-UA` hints on `persist:aether`.
4. Where import or embedded sign-in fails (R8, R9), the documented path is:
   1. Sign in once in the Human Space of Aether.
   2. The session persists in `persist:aether`, which Agent Spaces share.

### 11.2 Persistence

`aether.db` holds:
- `spaces` and `tabs` as metadata only (about 300 bytes per tab). On launch, only the active Human tab mounts; everything else restores as sleeping.
- `facts`, `notes`, `procedures`, `runs` and `run_steps` from 2.0, unchanged. Secrets are refused.
- `space_state`: the JSON store behind `space.state`.

### 11.3 Storage hygiene

1. The HTTP cache uses Chromium's own sizing unless `config.json` sets a limit.
2. Deleting an Agent Space clears `serviceworkers`, `cachestorage` and `shadercache` for origins used only by that Space. Cookies and local storage are kept.
3. Downloads go to `~/.aether/spaces/<id>/downloads`.
   - A download starts only if free disk (`fs.statfs`) stays above 1 GB after it.
   - The folder is removed only when the person deletes the Space, with a confirmation if it holds files.
4. `aether.db` uses `auto_vacuum = INCREMENTAL`. `aether.log` rotates at start and at 10 MB (configurable).

---

## 12. Measurement

Baselines: Aether 2.0 (8 tools), Playwright MCP, browser-use where it runs. All use the same host model and the same tasks.

Recorded in `docs/METRICS.md`:
- Model turns per task. Target: 3 or fewer for multi-page search plus a 10-tab fan-out (2.0: 11 to 15).
- Wall-clock time. Target: at least 5x faster than 2.0 on multi-tab and listing tasks.
- Host plus result tokens per successful task. Target: at least 80 % fewer than full-snapshot agents.
- Peak renderer memory, and concurrency over a 20-tab run, at normal and simulated low memory.
- Task success, and whether the chosen product meets every stated criterion. This guards against speed bought with worse choices.

---

## 13. What changes from the 2.0 code

| Area | Decision |
|---|---|
| `packages/cdp` | Keep. Add `ElectronDebuggerTransport` (`attach('1.3')`, `sendCommand`, `message`, `detach`). Keep the headless launcher. |
| `packages/perceiver` | Keep. Add `smart-landing.ts` (settle, consent, archetype) and `FORM` tag landmark mapping. Document `ProductGraphMatcher`. |
| `packages/actor` | Keep. Add an `onActionTarget(point)` callback for the ghost cursor. |
| `packages/policy` | Keep. Add `blocklist.ts`, batch URL approval, and the external protocol rule. |
| `packages/memory` | Keep. Add `spaces`, `tabs` and `space_state` tables; driver per D2. |
| `packages/shared` | Extend. Zod schemas for Spaces, tab records, milestones, daemon frames, Code Mode RPC, the 4 tools, shell IPC. |
| `packages/codemode` | New (Phase 1, done). Transpiler, sandbox per S5, stall watchdog, RPC host, return guard. |
| `packages/engine` | New in Phase 3. The engine pieces now in `apps/cli` that both the app and the CLI need: `mcp/browser-session.ts`, `landing/smart-landing.ts`, `codemode/session-engine.ts`, `codemode/render-report.ts`. Moved, not rewritten, so the Phase 1 tests keep passing unchanged. |
| `apps/desktop` | New (Phase 2, done): `main/` (SpaceManager, Tab, AgentHost, MemoryWatchdog, concurrency, request filter, hardening, ShellBridge), `preload/`, interim `static/` shell. Phase 3 adds `main/service/` (service server, DesktopSpaceEngine, held runs). Phase 4 replaces `static/` with `renderer/` (React shell) and `overlay/` (Shell Overlay view). Phase 5 adds `main/import/` (ChromeImporter) and downloads. |
| `apps/cli` | The `aether` command: `exec`, `wait`, `screenshot`, `spaces`, `done`, `skill`, `install-skill`, `uninstall-skill`, `status`, `doctor`, and the optional `mcp` adapter. `--direct --headless` keeps the headless engine for CI. |
| `skills/aether` | New in Phase 3. `SKILL.md` (bootstrap only). |
| `apps/extension`, `apps/native-host` | Delete in Phase 6, after `apps/desktop` passes every end-to-end task. |

---

## 14. Phases and spikes

Work one phase at a time, in order, and one task at a time inside a phase. After each task, run `pnpm typecheck`, `pnpm lint` and `pnpm test`, and do not start the next task until all pass (AGENTS.md rule 7). Record each spike in `docs/SPIKES.md`. Each phase ends with its exit tests passing twice in a row and a report in the AGENTS.md format.

### Spikes

| Id | Question | Blocks | Status |
|---|---|---|---|
| S5 | Sandbox. Does worker plus `vm` (with `codeGeneration` off and frozen intrinsics) resist the known escape classes? Same question for a sandboxed hidden renderer. Also: does `worker.terminate()` stop `while (true) {}`, and does a `space.*` round trip take under 10 ms in each? | Phase 1 | Done: Design A |
| S6 | Chrome import. Cookie decryption on Windows (v10 vs v20 App-Bound), macOS and Linux. Bookmarks and history. Google and one bank: does sign-in work inside Electron with the Chrome user agent? | Phase 5 | Partial: Windows synthetic DPAPI/v10 probe and 5 regression tests pass; actual Chrome/v20/sign-in and other OS measurements not run; see SPIKES.md |
| S7 | Electron CDP and views. Auto-attach to cross-origin iframes; lazy loading and `IntersectionObserver` in a view that is not shown; memory freed on destroy; per-page memory. | Phase 2 | Done: agent host window, plus the occlusion addendum |
| S8 | Shell Overlay view. Does a transparent view block the person's input over a tab while engine CDP input still reaches the page? Absent from `capturePage`? Input passed through at once when removed? | Phase 2 | Done: works; omnibox focus inside the overlay is left to Phase 4 |
| S9 | SQLite in Electron: `node:sqlite` vs `better-sqlite3` rebuilt. Feeds D2. | Phase 2 | Done: `node:sqlite` |
| S10 | Host support. For Claude Code, VS Code Copilot, Antigravity, opencode and Cursor, record: does it load a skill from the linked folder; does `/aether` trigger it; can its shell tool run `aether exec` with a script on stdin; how long does it let a shell command run before cutting it off; which MCP era and capabilities (Tasks, Skills, elicitation) it declares, for the optional adapter. Method: a probe skill that logs each invocation, and the request log of the MCP adapter. | Phase 3 | Open |

### Phase 0. Baseline and v3 schemas (done 2026-11-18)

- The plan moved into `docs/PLAN.md`; 2.0 archived at `docs/PLAN-v2.md`.
- `FORM` tag landmark mapping in the perceiver, with an unnamed-form fixture.
- Zod schemas in `packages/shared`: Spaces, tab records, milestones (`spaces.ts`); Code Mode RPC (`codemode.ts`); the 4 tools (`host-tools.ts`); service frames (`daemon.ts`); shell IPC (`shell-ipc.ts`); settings (`config.ts`).
- Exit met: all checks pass; schema round-trip tests in `tests/schemas-v3.test.ts`.

### Phase 1. Code Mode and Smart Landing on the 2.0 engine (done 2026-11-18)

Built:
- `packages/codemode`: `transpile.ts` (type stripping plus a syntax check), `sandbox.ts` and `worker-source.ts` (worker plus `vm`, frozen intrinsics, closure-only bridges, a `ready` handshake), `codemode-host.ts` (exec, wait, stop, per-Space serialization, held runs), `return-guard.ts`, `call-error.ts`.
- `apps/cli/src/codemode/`: `session-engine.ts` (the `space` SDK over the 2.0 `BrowserSession`), `codemode-server.ts` (the 4 tools, definitions under 450 tokens), `sdk-declaration.ts`, `instructions.ts`, `render-report.ts`.
- Smart Landing (`apps/cli/src/landing/smart-landing.ts`, `packages/perceiver/src/landing/`): settle, consent banner per `cookieBanners`, archetype.
- `wrapUntrustedOrigins` in Policy for multi-origin returns.

Changed from 3.1 during the phase:
- The eight 2.0 MCP tools were removed. `aether mcp` serves only the four Code Mode tools; `--codemode` is accepted and ignored.
- The cookie banner rule became the person's setting (D3).
- The stall clock starts only after the worker reports ready, so a slow machine does not stop a script that has not started.

Not done, carried forward: `docs/PERCEPTION.md` (6.2), moved to Phase 3 task 3.11.

Exit met: escape attempts fail; `while (true) {}` stops and a 2-minute working script does not; structured returns arrive whole; a script cannot exfiltrate through `open`; one `aether_exec` harvests the 2-page fixture shop, maps 3 product pages and returns a shortlist.

### Phase 2. Electron core (done 2026-11-18)

Built (`apps/desktop`, run with `pnpm desktop`):
- `ElectronDebuggerTransport` in `packages/cdp`: each agent tab is a root session `tab-<id>`; auto-attached frames route to their tab; Human tabs are never registered.
- `SpaceManager`, `Tab`, `AgentHost` (off-screen window for background Agent tabs), `ShellWindow` and `ShellBridge`, `MemoryWatchdog`, `concurrency.ts` (slots from free memory and cores), `request-filter.ts`, `hardening.ts`, `omnibox.ts`.
- SQLite through `node:sqlite`: `spaces`, `tabs` and `space_state` tables, `SpaceStore`; `config-file.ts` moved into `packages/memory`.
- A test control channel (`AETHER_TEST_CONTROL`), used only by the exit tests.

Deviations, each recorded with its reason:
- **Watchdog exemptions**: the shown tab, every Space's active tab, and tabs woken in the last 30 s are never put to sleep (5.2).
- **Occlusion switches**: `CalculateNativeWinOcclusion` disabled and `disable-backgrounding-occluded-windows`, so the off-screen host keeps rendering (S7 addendum).
- **Test control instead of `--remote-debugging-port`**: a loopback socket with a token, started only by the test flag. The app service replaces it for real clients in Phase 3; the exit tests then move to the service where they can.
- **Interim shell**: a plain tab strip and address bar in `static/`, using the 10.1 tokens. Shortcuts work only while the toolbar has focus. Phase 4 replaces it.
- **Not built in Phase 2, moved**: the Shell Overlay view (Phase 4, S8 already proved it), log rotation (Phase 3, task 3.9), downloads (refused until Phase 5).

Exit met: 15 lazy tabs leave 14 asleep at under 300 bytes each; concurrency follows free memory and pressure puts background tabs to sleep; deleting a Space clears caches and keeps cookies; a crashed renderer affects only its tab; background Agent tabs render and lazy-load; Human tabs are never debugged; Spaces restore asleep after a restart.

### Phase 3. Hands-free connection (core implemented; exit checks open)

Goal: the person installs Aether once, then types `/aether <task>` in Claude Code, VS Code, Antigravity or opencode and watches the agent work in the app. No per-host setup.

Tasks, in order:

**3.1 Move the engine into `packages/engine`.**
- Move `apps/cli/src/mcp/browser-session.ts`, `apps/cli/src/landing/`, `apps/cli/src/codemode/session-engine.ts` and `render-report.ts` into a new workspace package `@aether/engine`. Imports only; no behaviour change.
- `apps/cli` and `apps/desktop` both depend on it.
- Done when: every existing test passes unchanged.

**3.2 `DesktopSpaceEngine`.**
- Implements `SpaceEngine` (`packages/codemode/src/codemode-host.ts`) over `SpaceManager` and the Electron transport, in `apps/desktop/src/main/service/desktop-engine.ts`.
- `open`, `skim`, `focus`, `text`, `items`, `survey`, `find`, `act` reuse the engine's per-tab perception and action code on a `CDPSession` for the tab.
- `openTabs` and `switchTab` use `SpaceManager.openTabs` and `activateTab`. `mapPages` takes slots from `pageSlots`, wakes each page, runs `fn`, then lets the tab sleep.
- Smart Landing runs on every navigation with the live `cookieBanners` setting.
- Milestones from `logStep` and `thought` go to the Space record and the shell (`ShellBridge`).
- Done when: the Phase 1 Code Mode fixture tests run against the app as well as against headless Chrome, through a shared test table.

**3.3 Run state and held runs inside the app.**
- One `SpaceRunState` per Space (4.3): `idle`, `acting`, `waiting_human` with its reason, `resuming`, `done`.
- Approvals, questions and Take over park the sandbox at the call. Until the Phase 4 cards exist, the interim shell shows a plain bar with the reason and Approve, Deny, Take over and Stop buttons, so the flow can be tested end to end now.
- Held results are kept 10 minutes, keyed by token, owned by the Space.
- Done when: an irreversible fixture holds, returns `held: <token>` after 50 s (shortened by a test setting), and `wait` returns the result after approval.

**3.4 App service.**
- `apps/desktop/src/main/service/`: `server.ts` (named pipe or socket, frames per `daemon.ts`), `sessions.ts`, `service-file.ts` (writes and removes `daemon.json`, owner-only).
- Every frame is validated with zod. A bad token or frame gets `fatal` and the connection closes. Lines over 8 MB are refused.
- On quit: stop accepting, stop running scripts with "the app is closing", remove `daemon.json`.
- Done when: two clients in parallel get two Spaces with no interference; a wrong token is refused; a stale `daemon.json` is replaced.

**3.5 The `aether` command.**
- `apps/cli/src/commands/`: one file per command in 8.0, plus `service-client.ts` (connect, hello, request) and `launch-app.ts`.
- `launch-app.ts` finds the app (installed location, else the source checkout), starts it detached, waits up to 15 s for `daemon.json` and the endpoint, and never starts a second copy (the single-instance lock covers races).
- Script input from `--file` or stdin; output and exit codes per 8.0; screenshots written under `~/.aether/screenshots/` unless `--out`.
- Done when: `aether exec` runs the fixture shop task from a cold start, and every exit code has a test.

**3.6 Skill and method text.**
- `skills/aether/SKILL.md`: front matter (`name: aether`, a description that names browsing tasks), then when to use it and "run `aether skill`". Under 1,500 characters.
- `aether skill` prints the method (8.2) and the SDK declaration (7.2) from the existing sources.
- Done when: the consistency test in 8.2 passes.

**3.7 Host links.**
- `apps/cli/src/install/skill-links.ts`: the table in 8.0; junction on Windows, symlink elsewhere; skip a missing host folder; never replace a folder that is not Aether's link; report each target.
- `install-skill`, `uninstall-skill` and the link checks in `doctor` use it.
- Done when: tests over a temp home cover create, repeat (no change), foreign folder (left alone), missing host (skipped) and uninstall (only Aether's links removed).

**3.8 `aether` on PATH and the installer (needs D1).**
- From source (works before D1): `pnpm aether:install` builds, writes a shim (`%LOCALAPPDATA%\Aether\bin\aether.cmd` on Windows, `~/.local/bin/aether` elsewhere) that runs `node <checkout>/apps/cli/dist/index.js`, adds the folder to the user PATH (HKCU, no admin), then runs `install-skill`. `pnpm aether:uninstall` reverses all of it.
- Packaged (after D1): the installer puts the app and the same shim in place and runs the same `install-skill`. The uninstaller runs `uninstall-skill`.
- Done when: on a clean Windows user profile, after install, a new terminal finds `aether` and `aether doctor` reports every check green.

**3.9 Log rotation.**
- `~/.aether/aether.log` rotates at start and at 10 MB (configurable), keeping 3 files. App and CLI share it, one JSON line per event, with the process name.

**3.10 Spike S10 and the optional MCP adapter.**
- Run S10 against each host the person uses.
- If any host needs MCP: `aether mcp` forwards the 4 tools to the service (no engine inside), serves the method as `instructions`, uses Tasks and Skills over MCP when declared (8.3). Otherwise record that the adapter is not built.

**3.11 Docs.**
- `docs/SETUP.md` rewritten around install, `/aether` and `aether doctor`. The extension sections move under "Legacy (until Phase 6)".
- `docs/PERCEPTION.md`: the `ProductGraphMatcher` scoring as implemented in `packages/perceiver/src/graph-matcher.ts`, carried over from Phase 1.

Exit tests for Phase 3:
1. Two `aether exec` processes at once get two Agent Spaces in one app with no conflicts.
2. From a cold start (app not running), `aether exec` starts the app and completes the fixture shop task.
3. An irreversible step holds; `aether wait <token>` returns after approval in the interim bar; Stop ends the script at once.
4. `install-skill` and `uninstall-skill` pass their temp-home tests; `doctor` reports a broken link.
5. Manual, recorded in `docs/SPIKES.md` under S10: Claude Code and VS Code each complete the fixture shop task by `/aether`, with no per-host setup.
6. The Human Space is never debugged during any of the above (the Phase 2 check, repeated through the service).

### Phase 4. Shell UI

Goal: a quiet, Chrome-like browser that shows agent work in exactly three places: the frame, the Agent bar and the side panel. Built with React 19 and plain CSS tokens (section 10). Uses the design-system, ux-copy and accessibility-review guidance already written into 10.1 to 10.5.

Tasks, in order:
1. **Renderer setup**: `apps/desktop/renderer` with vite and `@vitejs/plugin-react`; strict CSP; typed preload IPC from `shell-ipc.ts`. `tokens.css` per 10.1 and `scripts/check-contrast.mts` in the test run.
2. **Tab strip and Space switcher**: tabs with every state in 10.3 (sleeping, crashed, loading, audible); drag to reorder; middle click closes; the Space chip and its menu; Windows `titleBarOverlay`.
3. **Toolbar and omnibox**: back, forward, reload, the omnibox (host at rest, full URL on focus), the agent indicator, side panel toggle, main menu. Suggestions draw in the Shell Overlay view while keyboard focus stays in the omnibox (the open S8 item).
4. **Shortcuts everywhere**: `before-input-event` on every tab view so the 10.5 shortcuts work while a page has focus, not only the toolbar.
5. **Agent bar**: acting, waiting and done per 10.3 and 10.4, driven by `SpaceRunState`. Replaces the Phase 3 interim bar.
6. **Side panel**: Activity (milestone timeline), Memory (preferences, routes, notes from `packages/memory`), and the decision and approval cards, including the batched URL approval (9.4).
7. **Shell Overlay view**: the input shield while acting (Esc means Take over), the ghost cursor from Actor `onActionTarget`, the find bar, toasts.
8. **Browser basics**: every row of 10.6: error and crashed pages, context menu with "Send tab to Agent Space", permissions bubble, HTTP auth, certificate interstitial, external protocols, fullscreen, PDF, zoom, print, new tab page, history and bookmarks.
9. **Settings page** (`aether://settings`): Cookie banners (Reject optional cookies / Accept all / Leave banners alone), memory reserve, memory on or off. Writes `config.json` only on the person's action.
10. **Accessibility pass**: keyboard-only run and NVDA pass over the decision flow, recorded in `docs/A11Y.md`.

Exit tests for Phase 4:
1. The Human Space stays untouched while an Agent Space runs blue.
2. Person clicks in an acting Agent Space are blocked; Esc takes over.
3. Milestones appear in Activity in order.
4. An irreversible fixture turns the Space amber with an approval card; Approve and Deny resolve the held call.
5. Take over and "Hand back to Aether" work while an engine call is in flight.
6. The contrast script passes for both themes; the keyboard and NVDA checks are recorded.
7. Decision D4 (vertical tabs) is put to the person.

### Phase 5. Chrome import and per-Space downloads

Implementation note (2026-11-20): the person explicitly requested moving to
this phase while Phase 4 acceptance remains open, then explicitly asked
for a generic in-app import option rather than a device-specific profile
probe. Tasks 2–3 now provide OS-relative discovery, a native folder picker,
selectable bookmarks/history/cookies and an itemized import report. No
personal profile was read during implementation. Fixture evidence is in
`SPIKES.md`; task evidence and earlier failing runs are in `AUDIT.md`.
The latest full typecheck/lint/contrast/test run passed: 47 files / 328 tests,
with 7 existing lint warnings and no retries. This is not a Phase 4/5 exit
sign-off or permission to retire the legacy path. S6's real sign-in and
macOS/Linux encryption measurements remain open; those encrypted cookies
are explicitly skipped, not represented as supported. Downloads and
Space-file deletion confirmation are still the next ordered tasks.

Tasks, in order:
1. Run S6 on Windows first, then macOS and Linux where available.
2. `apps/desktop/src/main/import/`: bookmarks, history, decryptable cookies; temp copies deleted in `finally`; a report of what was skipped and why. Current Chrome user agent and `Sec-CH-UA` hints on `persist:aether`.
3. A first-run import offer in the app, and an Import entry in Settings.
4. Downloads: `will-download` per Space into `~/.aether/spaces/<id>/downloads`, the 1 GB free-disk check, a downloads popover (Ctrl+J). Agent uploads only from that folder (9.3).
5. Deleting a Space removes its folder after confirmation when it holds files.

Exit tests: importing a fixture profile fills bookmarks and cookies and leaves no temp files; a download lands in the Space folder; deleting the Space removes it after confirmation; a download that would leave under 1 GB free is refused with a clear message.

### Phase 6. Retire 2.0 and measure v3

Tasks, in order:
1. Delete `apps/extension`, `apps/native-host` and `aether mcp --extension`. Remove their build steps, tests and docs.
2. Update `README.md` and `docs/SETUP.md` to the app-only path.
3. Run the benchmarks: multi-page shopping, 10-tab fan-out, form, handoff, against the baselines in section 12. Record the metrics in `docs/METRICS.md`.
4. Packaging per D1 for a release build, if not done in Phase 3.

Exit: all checks pass; metrics committed; a clean machine goes from installer to a finished `/aether` task with no manual steps.

---

## 15. Research basis

- **Cloudflare Code Mode (2025)**: a typed API run in a sandbox beats long tool lists, in tokens and in speed, because models write TypeScript better than they sequence single tool calls.
- **ego (lite), CitroLabs**: separate person and agent workspaces sharing one signed-in session, a blue glow while acting, explicit handoff, and single-shot script execution.
- **Chromium Memory Saver and Arc Spaces**: retail pages run 50 to 130 subframes and 300 to 500 MB per renderer. Separating tab records from live views prevents out-of-memory failures under fan-out.
- **Node `vm` documentation**: "The node:vm module is not a security mechanism." Hence S5 and the sandboxed renderer option.
- **Chrome App-Bound Encryption (Chrome 127, 2024)**: cookies on Windows are bound to Chrome's identity. Hence the S6 scope and the sign-in fallback.
- **Agent shopping evaluations (WebMall, Online-Mind2Web, DeepShop, AgentOccam)**: agents stop at the first offer and skip filters. Hence `items`, `survey` and the method in 8.2.
- **Aether 2.0 findings (2026-11-11 to 2026-11-17)**: these motivated 3.0:
  - DOMSnapshot plus AX skim cost (S2);
  - item and survey harvesting (S4b);
  - URL provenance (S4);
  - three failure modes:
    - minutes of sequential tool calls on 10-tab tasks;
    - arrivals on pages covered by cookie banners;
    - stdio bridge collisions between MCP processes.

---

## 16. Decisions needed from the person before the step that needs them

| Id | Decision | Options | Needed by |
|---|---|---|---|
| D1 | Packaging and installer for Aether Desktop | `electron-builder`, `@electron/forge`, or run from source with `pnpm aether:install` only | Phase 3, task 3.8 (the from-source path works without it) |
| D2 | SQLite driver inside Electron | Decided 2026-11-18 after S9: `node:sqlite` (built in). `better-sqlite3` removed | Done |
| D3 | Cookie banner default | Decided 2026-11-18: a person's setting `cookieBanners` = `reject` (default), `accept` or `off` (6.1) | Done |
| D4 | Vertical tabs as an option | Chrome-like horizontal only (default), or add a vertical tab layout later | End of Phase 4 |
