# Aether: Agentic Browser Plan

Working title: Aether. Version 3.1. Date: 2026-11-18. Status: Step 0 done (2026-11-18). Step 1 done (2026-11-18): spike S5 (Design A), Code Mode as `aether mcp --codemode`, Smart Landing with the cookie banner setting (D3). The eight 2.0 MCP tools were removed on 2026-11-18: `aether mcp` serves only the four Code Mode tools. Step 2 done (2026-11-18): Electron core in `apps/desktop` (`pnpm desktop`), Electron CDP transport, Spaces with sleeping tabs, agent host window, memory watchdog, request filter, hardening, SQLite persistence; exit tests pass. Next: Step 3. Supersedes 3.0 (draft of 2026-11-18, kept at `D:\.md\aether plan v3.md`) and 2.0 (Chrome MV3 extension and 8-tool MCP server, kept at `docs/PLAN-v2.md`). The perception, action, policy and memory packages from 2.0 are kept as the engine kernel.

Baseline on 2026-11-18: 17 test files, 146 tests, all passing; `pnpm typecheck` and `pnpm lint` clean (2 pre-existing lint warnings).

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
| Desktop shell | Electron (`BaseWindow` + `WebContentsView`), current stable at Step 2 | Must bundle Node >= 22.13 for `stripTypeScriptTypes` (Electron 35 or later). |
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
| Host connection | `@modelcontextprotocol/sdk` stdio shim -> one local daemon in Aether Desktop | |
| Chrome import | Own importer using the SQLite driver and `node:crypto` | Subject to S6. |
| Packaging | Decision D1 | Not chosen; run from source until decided. |
| Tests | `vitest` + `@aether/fixtures` | Electron end-to-end tests drive the app through the daemon socket and `--remote-debugging-port` on the shell (14, Step 2). |
| Lint | Biome (WASM runner, `scripts/lint.mjs`) | |
| OS | Windows, Linux, macOS | Windows is the first development target, because it is the person's machine. |

No other libraries. `apps/extension` and `apps/native-host` stay working until Step 6, so there is always a usable path.

---

## 4. Architecture

### 4.1 Components

```
Host (Claude Code / VS Code Copilot / Cursor / Antigravity)
  |  /aether skill or MCP instructions; shows reasoning, code and answers
  |  MCP stdio -> `aether mcp` (stateless forwarder)
  v
Local daemon (named pipe on Windows, ~/.aether/aether.sock elsewhere; token in ~/.aether/daemon.json)
  v
Aether Desktop main process (Electron + Node)
  +-- SpaceManager        Human Space + Agent Spaces, one SpaceRunState each
  +-- TabLifecycle        live views, hibernated tabs, MemoryWatchdog, crash isolation
  +-- SmartLanding        settle, consent banner, archetype
  +-- CodeModeHost        sandbox per run, capability RPC for space.*
  +-- Kernel              Perceiver | Actor | Policy | Memory | RunLog
  +-- ShellWindow         BaseWindow with three view layers (4.4)
```

### 4.2 Single-instance daemon

1. Aether Desktop owns the only daemon. It uses `app.requestSingleInstanceLock()` so a second launch focuses the first window.
2. `aether mcp` is a stateless stdio-to-daemon forwarder. If the daemon is absent, it starts Aether Desktop, waits up to 15 s for the socket, then forwards. Nothing is printed to stdout except JSON-RPC (the 2.0 launch test is kept).
3. Every connection authenticates with the token from `~/.aether/daemon.json`, which is readable only by the owner. Each host session gets its own Agent Space, and sessions never disconnect each other.
4. `aether mcp --direct --headless` keeps the 2.0 headless Chrome path for CI and the Step 1 trial.

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

   Found in Step 2 testing: without these exceptions, real memory pressure put a just-opened agent tab to sleep before the agent read it.
7. **Crash isolation**: on `render-process-gone`, only that tab becomes `crashed`. The SDK call on it rejects with a recoverable error, and the tab shows the crashed page (10.6).

---

## 6. Smart Landing and perception

### 6.1 Smart Landing (deterministic, no model tokens)

Every navigation runs these steps before returning:

1. **Settle**: main-frame DOM ready, then network quiet or a stable AX structure hash. Target 250 ms after load; hard cap 2.5 s.
2. **Consent banner** (decision D3, 2026-11-18): the person's **Cookie banners** setting, `cookieBanners` in `~/.aether/config.json`, edited later on the Settings page in Step 4. Only the person can change it.
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

`ProductGraphMatcher` scoring must be written down in `docs/PERCEPTION.md` before Step 1 ends. 3.0 calls it "Jaccard centrality" without a definition.

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

1. **Installer** (Step 3; packaging per D1). It installs the app and puts `aether` on PATH. It links one skill folder (`skills/aether`, shipped with the app) into:
   - `~/.claude/skills/aether`
   - `~/.agents/skills/aether`
   - `~/.gemini/config/skills/aether`
   - `~/.gemini/antigravity-cli/skills/aether`
   - `~/.config/opencode/skills/aether`

   On Windows these are directory junctions, which need no admin rights. `aether install-skill` repeats this step and `aether uninstall-skill` removes the links. A folder of the same name that is not Aether's link is left alone and reported.
2. **Skill**. `SKILL.md` is a short bootstrap: run `aether skill`, which prints the usage guide and SDK declaration for the installed version, so an app update updates every host.
3. **Command**. These are the same four operations as the tools in 8.1, over the daemon:

   | Command | Operation |
   |---|---|
   | `aether exec --space <name> --thought <line> --file <script.ts>` (or the script on stdin) | `aether_exec` |
   | `aether wait <token>` | `aether_exec` with `wait` |
   | `aether screenshot`, `aether spaces`, `aether done` | the other three |

   Output is the same text the MCP tool returns. A screenshot is written to a file whose path is printed.
4. **MCP** (`aether mcp`). An optional thin adapter over the same daemon, for hosts with no skills or no shell tool. It is built last in Step 3, and dropped if S10 shows every host the person uses works with the command and skill.

### 8.1 Four operations (as MCP tools: definitions under 450 tokens, excluding the SDK text in the `aether_exec` description)

| Tool | Arguments | Purpose |
|---|---|---|
| `aether_exec` | `space?`, `thought`, `code?`, `wait?` | Runs `code` in the named Agent Space, creating the Space if needed, and posts `thought` as a milestone. If the run is held longer than 50 s, it returns `held: <token>, reason`. Calling again with `wait: <token>` and no code keeps waiting and returns the run's result once released. A held run's result is kept for 10 minutes. |
| `aether_screenshot` | `space`, `ref?` | Downscaled PNG of the active viewport or one element. Overlays are never in it. |
| `aether_spaces` | `op: 'list' \| 'focus' \| 'close'`, `space?` | List Agent Spaces and tabs, show one in the window, or close one. |
| `aether_done` | `space`, `result`, `evidence`, `success` | Ends the run, turns the frame off, writes RunLog, may save a procedure. |

### 8.2 The working method, in three places

1. `skills/aether/SKILL.md`, installed by `aether install-skill` to:
   - `~/.claude/skills/aether/` (Claude Code);
   - the Antigravity skills folder.
2. MCP server `instructions`, for VS Code Copilot and other hosts without skills. The 2.0 text in `apps/cli/src/mcp/instructions.ts` is extended for Code Mode.
3. The `aether_exec` description, which holds the SDK declaration.

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

Ratios are measured against `--surface` (`scripts/check-contrast.mts` in Step 4 recomputes them). All colours, sizes and durations come from these tokens. Hard-coded values in component CSS fail lint review.

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
- **Exit check** for Step 4: a keyboard-only run and an NVDA (Windows screen reader) pass over the decision card flow, recorded in `docs/A11Y.md`.

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
| `packages/codemode` | New. Transpiler, sandbox per S5, stall watchdog, RPC host and client, return guard. |
| `apps/desktop` | New. `main/` (SpaceManager, TabLifecycle, MemoryWatchdog, ChromeImporter, daemon), `preload/`, `renderer/` (shell UI), `overlay/` (Shell Overlay view). |
| `apps/cli` | `aether mcp` forwards to the daemon; `--direct --headless` keeps the 2.0 engine for CI; `aether doctor` checks Electron, the daemon and the skill install; `aether install-skill`. |
| `skills/aether` | New. `SKILL.md`. |
| `apps/extension`, `apps/native-host` | Delete in Step 6, after `apps/desktop` passes every end-to-end task. |

---

## 14. Steps and spikes

Work one step at a time, in order. After each, run `pnpm typecheck`, `pnpm lint` and `pnpm test`, and do not start the next step until all pass. Record each spike in `docs/SPIKES.md`.

### Spikes

| Id | Question | Blocks |
|---|---|---|
| S5 | Sandbox. Does worker plus `vm` (with `codeGeneration` off and frozen intrinsics) resist the known escape classes? Same question for a sandboxed hidden renderer. Also: does `worker.terminate()` stop `while (true) {}`, and does a `space.*` round trip take under 10 ms in each? | Step 1 |
| S6 | Chrome import. Cookie decryption on Windows (v10 vs v20 App-Bound), macOS and Linux. Bookmarks and history. Google and one bank: does sign-in work inside Electron with the Chrome user agent? | Step 5 |
| S7 | Electron CDP and views. Does `webContents.debugger` auto-attach to cross-origin iframes like Chrome? Do lazy loading and `IntersectionObserver` fire in a view that is not shown, with `backgroundThrottling: false` and real bounds? Memory freed when a view is destroyed, and per-page memory for the concurrency formula. | Step 2 |
| S8 | Shell Overlay view. Does a transparent view block the person's mouse and keys over a tab while engine CDP input still reaches the page? Is it absent from `capturePage`? Is input passed through at once when the view is removed? Can omnibox suggestions render in it without focus loss? | Step 2 |
| S9 | SQLite in Electron. `node:sqlite` in Electron's Node: does the API cover the 2.0 memory store, and what does performance look like? Versus `better-sqlite3` rebuilt with `@electron/rebuild`. Feeds decision D2. | Step 2 |
| S10 | Host protocol support. For VS Code Copilot, Claude Code, Cursor and Antigravity, record: the protocol era each sends; whether it reads server `instructions`; whether it declares the Tasks, Skills or elicitation capabilities; and how long it waits on a tool call before timing out. Method: log the raw requests the 2.0 server receives. | Step 3 |

### Steps

**Step 0. Baseline and v3 schemas.**
- Move the plan into `docs/PLAN.md` (this file). Archive 2.0.
- Add `FORM` tag landmark mapping in the perceiver, with a fixture that has an unnamed `<form>`.
- Zod schemas in `packages/shared` for: Spaces, tab records, milestones, Code Mode RPC, the 4 tools, daemon frames, shell IPC.
- Exit: all checks pass; the schemas have round-trip tests.

**Step 1. Code Mode and Smart Landing on the current engine.**
- Run S5 and record the decision.
- Build `packages/codemode`:
  - transpile;
  - sandbox;
  - stall watchdog;
  - cancel on Take over and Stop;
  - return guard;
  - untrusted wrapping;
  - `space.*` over an adapter for the 2.0 `BrowserSession`.
- Add Smart Landing and the archetype tagger, tested on new fixtures: a consent banner with reject and accept, a consent banner with accept only, a login dialog (must not be dismissed).
- Expose `aether_exec` and `aether_done` on the existing MCP server behind `aether mcp --codemode`. The person can then try Code Mode from VS Code with the 2.0 extension before any Electron work.
- Exit:
  - Security tests show the escape attempts fail.
  - `while (true) {}` is stopped and a 2-minute active script is not.
  - Structured returns arrive whole.
  - A script cannot exfiltrate through `open`.
  - One `aether_exec` harvests the 2-page fixture shop, filters, maps 3 product pages, and returns a shortlist.

**Step 2. Electron core.**
- Run S7, S8 and S9. Decide D2.
- Add `ElectronDebuggerTransport`.
- Build `apps/desktop/main`:
  - BaseWindow with the three layers;
  - SpaceManager;
  - TabLifecycle (live views, sleeping tabs, `mapPages` pool, request filter, MemoryWatchdog, crash isolation);
  - `config.json`;
  - SQLite Space and tab tables;
  - log rotation;
  - Electron hardening (9.7).
- Add a test driver: Electron launched with a test flag exposes the daemon socket and `--remote-debugging-port` for the shell.
- Exit:
  - 15 tabs via `openTabs` leave unviewed tabs sleeping with metadata in SQLite.
  - Concurrency rises with free memory and drops under simulated pressure.
  - Deleting a Space keeps cookies and clears caches.
  - Killing one renderer leaves the app and the Space running.

**Step 3. Daemon, command, skill and installer.** (Before UI polish, so a real host drives Electron from here on.)
- The daemon in `apps/desktop` (named pipe or socket plus token), with concurrent sessions.
- The `aether` command (`exec`, `wait`, `screenshot`, `spaces`, `done`, `skill`, `install-skill`, `uninstall-skill`, `doctor`). It auto-launches the app.
- The skill links for all hosts (8.0) and the installer (D1).
- Last, and only if S10 needs it: `aether mcp` forwarding the same 4 operations.
- `skills/aether/SKILL.md` and the MCP instructions, under 1,500 characters.
- Run S10. Use the Tasks extension and Skills over MCP for hosts that declare them, and the `wait` token and installed skill otherwise (8.3).
- Exit:
  - Two concurrent clients get two Agent Spaces in one app with no conflicts.
  - VS Code Copilot and Claude Code both complete the fixture shop task through `aether_exec`.

**Step 4. Shell UI.**
- `tokens.css` per 10.1 and the contrast check script.
- Build the layout in 10.2:
  - tab strip, Space switcher, toolbar and omnibox, Agent bar, side panel (Activity, Memory), decision and approval cards;
  - in the Shell Overlay view: the shield, ghost cursor, omnibox suggestions and find bar;
  - the browser basics in 10.6.
- Copy exactly per 10.4. No chat box and no code block anywhere.
- Exit:
  1. An end-to-end test shows the Human Space untouched while an Agent Space runs blue.
  2. Person clicks in the Agent Space are blocked while acting.
  3. Milestones appear in Activity.
  4. An irreversible fixture turns the Space amber with an approval card.
  5. Take over and "Hand back to Aether" work.
  6. The keyboard and NVDA checks in 10.5 are recorded.

**Step 5. Chrome import and Space downloads.**
- Run S6.
- Build `ChromeImporter`: bookmarks, history, decryptable cookies, temp copies removed in `finally`, and a report of what was skipped. Set the user agent and client hints.
- Space download folders with the free-disk check, removed only when the Space is deleted.
- Exit:
  - Importing a fixture profile fills bookmarks and cookies and leaves no temp files.
  - Deleting a Space removes its folder after confirmation.

**Step 6. Retire 2.0 and record v3 metrics.**
- Delete `apps/extension` and `apps/native-host`. Update `README.md` and `docs/SETUP.md`.
- Run the benchmarks: multi-page shopping, 10-tab fan-out, form, handoff. Record the section 12 metrics.
- Exit: all checks pass; metrics committed.

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
| D1 | Packaging and installer for Aether Desktop | `electron-builder`, `@electron/forge`, or run from source only in 3.1 | Step 6 (or earlier if an installer is wanted) |
| D2 | SQLite driver inside Electron | Decided 2026-11-18 after S9: `node:sqlite` (built in). `better-sqlite3` removed | Done |
| D3 | Cookie banner default | Decided 2026-11-18: a person's setting `cookieBanners` = `reject` (default), `accept` or `off` (6.1) | Done |
| D4 | Vertical tabs as an option | Chrome-like horizontal only (3.1 default), or add a vertical tab layout later | After Step 4 |
