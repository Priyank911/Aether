<p align="center">
  <img src="assets/logo.svg" alt="Aether" width="700"/>
</p>

# Aether

Aether lets an AI agent in your editor (VS Code Copilot, Claude Code, Cursor, Codex) use your real, logged-in Chrome. The agent sends short TypeScript scripts; Aether runs them against the page, returns compact text instead of whole pages, and hands control to you when a step needs you.

Aether has no model of its own. The MCP host supplies the model and the agent loop; Aether is the browser engine and tool server. Design, decisions and their evidence are in [docs/PLAN.md](docs/PLAN.md).

## How a step works: Code Mode

The agent writes one short TypeScript script per step and sends it to the `aether_exec` tool. The script runs in a sandbox (a worker with no file, network or process access) against a small `space` SDK. Every `space.*` call passes Aether's policy checks before it runs.

```ts
await space.open('https://shop.example/search?q=running+shoes');
const found = await space.survey({ query: 'running shoes', budget: 120, minRating: 4.3, maxPages: 3 });
const top = found.shortlist.slice(0, 3).map((c) => c.item.linkUrl!);
return space.mapPages(top, (page) => ({ name: page.product?.name, price: page.product?.price }));
```

What the SDK does:
1. **Smart Landing on every page load:** `space.open` waits for the page to settle, answers a cookie banner the way your setting says (reject optional cookies by default), and labels the page type (listing, product, form, article, sign-in, CAPTCHA).
2. **Reading:** `space.skim()`, `space.focus(ref)`, `space.text()` and `space.find()` read the page as compact text with refs like `[e12]`.
   - `space.items()` scrolls a whole listing first.
   - `space.survey()` follows next-page links and ranks every item it collected against a budget and a minimum rating.
3. **Acting:** `space.act()` runs up to 8 trusted inputs (`click`, `fill`, `key`, `hover`, `scroll`, `dialog`, `upload`) and returns only what changed.
4. **Waiting for you:** steps that need you are held until you answer in the side panel:
   - questions (`space.ask`);
   - approvals for irreversible steps (buy, send, delete, submitting personal or payment details, uploads, script-built URLs carrying data to a new site);
   - anything only you may do (passwords, codes, CAPTCHAs).

   The script waits at that call; your denial reaches it as an error it can handle.
5. **Memory:** `space.memory()` recalls preferences and routes that worked before; `aether_done` ends the run and stores the route.

A script's result goes back to the agent in one tool result. On the fixture shop, surveying two pages, filtering, and checking three product pages took one call and returned about 200 tokens.

Everything taken from a page is returned inside `<page untrusted nonce=... origin=...>` tags with a fresh nonce per call. Passwords, one-time codes and card numbers are masked as `***` in every view and are never stored.

## In Chrome

- The agent works only in tabs inside a blue **Aether** tab group, never in your other tabs.
- While it acts, a thin blue light runs along the edge of the page, with a small pill showing the current step, **Take over** and **Stop**. When it needs you, the light turns amber and the group title reads "Aether: needs you".
- The side panel shows the connection, the step list, one card for whatever is waiting on you, and a **Memory** tab where you can see, edit and delete what Aether remembers, or turn memory off.
- Chrome shows its "started debugging this browser" bar while the agent is attached. That is Chrome's own notice for the debugger permission.

## Set up

See [docs/SETUP.md](docs/SETUP.md). In short: `pnpm install`, `pnpm setup:build`, load `apps/extension/.output/chrome-mv3` unpacked, register the native host with its extension ID, and add `node <repo>/apps/cli/dist/index.js mcp` to your MCP host (not `pnpm mcp`, whose banner corrupts the stdio stream).

## Develop

```powershell
pnpm install
pnpm typecheck
pnpm lint        # Biome through its WebAssembly build; pnpm lint:native runs the CLI where biome.exe is allowed
pnpm test        # builds the extension, then runs unit, fixture, MCP, bridge and real-extension tests
pnpm probe https://en.wikipedia.org/wiki/Alan_Turing --text --find "Bletchley"
pnpm demo        # headed walkthrough on the form fixture
pnpm mcp --direct --headless   # MCP server on an isolated Chrome, for deterministic runs
```

## Layout

```
packages/shared      zod schemas for tools and every wire message, shared constants
packages/cdp         CDP client over WebSocket, pipe, or the extension bridge; Chrome launcher
packages/perceiver   capture (accessibility tree + DOMSnapshot), refs, skim, focus, text, find, delta
packages/actor       trusted input, fill, dialogs, uploads, settle, batch rules
packages/policy      URL boundary and provenance, action classifier, untrusted wrapper
packages/memory      SQLite memory, run log, file logger
apps/cli             probe, MCP server, run state machine, extension bridge
apps/extension       MV3 service worker, page overlay, side panel
apps/native-host     tells the extension where the engine listens
fixtures             local test pages: forms, frames, shadow DOM, tables, overlays, dialogs, uploads
scripts/spikes       the spikes the plan calls for; results in docs/SPIKES.md
```

## Status

Steps 0 to 6 of the plan are built and tested. Measured skim sizes and capture times are in [docs/probe-results.md](docs/probe-results.md). Step 7, the token comparison against Playwright MCP and browser-use, needs recorded runs with a model and has not been done, so no token-saving figure is claimed yet.
