<p align="center">
  <img src="assets/logo.svg" alt="Aether" width="700"/>
</p>

# Aether

Aether lets an MCP agent (Claude Code, Codex, Cursor, or any MCP host) use your real, logged-in Chrome the way a person does: glance at the page, look closer where it matters, act, and check what changed. It returns compact text instead of whole pages, and hands control to you when a step needs you.

Aether has no model of its own. The MCP host supplies the model and the agent loop; Aether is the browser engine and tool server. Design, decisions and their evidence are in [docs/PLAN.md](docs/PLAN.md).

## How a step works

1. `open` loads a URL and returns a **skim**: what is on screen, grouped by region, with refs like `[e12]`, and one summary line per region for what is off screen (`[e43] main: 231 more below (116 link, 115 heading): look ref=e43`). The skim fits in 1,200 tokens.
2. `look ref=e43` expands a region, `look as=text` reads it as markdown, and `find` searches the whole page including off-screen content.
3. `act` runs up to 8 actions with trusted Chrome input (`click`, `fill`, `key`, `hover`, `scroll`, `dialog`, `upload`) and returns only what changed:

   ```
   step 4 ok 3/3 | url unchanged
   ~ [e12] textbox "Email" value="a@b.co"
   + [e31] alert "Enter a valid phone number"
   text + "2 items in your cart"
   ```

4. Steps that need you are held until you answer in the side panel: questions (`ask`), approvals for irreversible steps (buy, send, delete, submitting personal or payment details, uploads, model-built URLs carrying data to a new site), and anything only you may do (passwords, codes, CAPTCHAs).
5. `memory` recalls preferences and routes that worked before on a site; `done` ends the run and stores the route.

Everything taken from a page is returned inside `<page untrusted nonce=... origin=...>` tags with a fresh nonce per call. Passwords, one-time codes and card numbers are masked as `***` in every view and are never stored.

## In Chrome

- The agent works only in tabs inside a blue **Aether** tab group, never in your other tabs.
- While it acts, a thin blue light runs along the edge of the page, with a small pill showing the current step, **Take over** and **Stop**. When it needs you, the light turns amber and the group title reads "Aether: needs you".
- The side panel shows the connection, the step list, one card for whatever is waiting on you, and a **Memory** tab where you can see, edit and delete what Aether remembers, or turn memory off.
- Chrome shows its "started debugging this browser" bar while the agent is attached. That is Chrome's own notice for the debugger permission.

## Set up

See [docs/SETUP.md](docs/SETUP.md). In short: `pnpm install`, `pnpm extension:build`, `pnpm native-host:build`, load `apps/extension/.output/chrome-mv3` unpacked, register the native host with its extension ID, and add `pnpm --dir <repo> mcp` to your MCP host.

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
