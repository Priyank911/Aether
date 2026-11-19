# Spike results

## S2: box capture cost

Script: `scripts/spikes/s2-box-capture.ts`. Run 2026-11-11, headless Chrome, viewport 1280x800, p50 of 5 runs.

| Page | Kept nodes | Layout nodes | AX tree | + DOMSnapshot | + batched getBoxModel |
|---|---|---|---|---|---|
| Fixture form | 12 | 36 | 8 ms | 4 ms | 13 ms |
| Fixture 500-row list | 501 | 2,506 | 124 ms | 19 ms | 158 ms |
| Wikipedia article | 2,120 | 18,073 | 582 ms | 213 ms | 307 ms |
| Hacker News | 227 | 1,272 | 69 ms | 17 ms | 55 ms |
| DuckDuckGo HTML | 4 | 134 | 16 ms | 10 ms | 6 ms |
| MDN reference | 1,716 | 21,909 | 682 ms | 277 ms | 282 ms |

The GitHub row is omitted: the page did not finish loading in that run.

Coordinate check: after scrolling 1000 px, a node's DOMSnapshot bounds did not change (3661.9 before and after, `scrollOffsetY` 0 to 1000), while `DOM.getBoxModel` moved from 3661.9 to 2661.9. DOMSnapshot bounds are document coordinates; subtract the document's scroll offset for the viewport.

Result: one DOMSnapshot per session costs less than or about the same as batched box-model calls on every page, and also returns paint order, attributes and styles. The plan's fallback condition (switch to batched box models when capture p50 exceeds 400 ms) does not apply as written, because on the large pages the accessibility tree alone exceeds 400 ms and the box-model alternative is slower. Decision: use DOMSnapshot. Capture latency on large pages is recorded as a Step 8 item.

## Step 1 observations

- DOMSnapshot paint orders are per paint layer. Nodes in one stacking context share a value, so a tie cannot decide which node is on top. Coverage counts only strictly higher layers, and each mark in the main frame is confirmed with `DOM.getNodeForLocation`. This removed false marks on Wikipedia (float overlapping later paragraph boxes) and GitHub (clipped tooltip text).
- `html.duckduckgo.com` served a bot check to headless Chrome (an `about:blank` frame and 4 refs) during the 2026-11-11 probe. The probe row reflects that page, not the results page.
- On Wikipedia and MDN, capture p50 was 0.7 to 1.2 s, above the 800 ms per-step latency target in `docs/METRICS.md`. The accessibility tree is most of that.

## S3: CAPTCHA with the debugger attached

Not run. It needs a person solving live CAPTCHAs (reCAPTCHA, hCaptcha, Turnstile) in a tab with `chrome.debugger` attached, which cannot be automated here. Until it is run, the plan's default holds: the debugger stays attached and a CAPTCHA moves the run to `waiting_human(captcha)` (the skim says so, and any action inside a CAPTCHA frame is `human_must_perform`). To run it: start a run on a page with each widget, let the agent hand over, solve it by hand, and record pass or fail per widget.

## S4: URL provenance false positives

Script: `scripts/spikes/s4-provenance.ts`. Run 2026-11-11 on hand-written `open` sequences for the 16 live-site tasks in `docs/METRICS.md` (24 opens), written before the rule was applied.

Result: 1 of 24 opens held for approval (4.2%): a research run that moves from DuckDuckGo to Google with a query built from what it read. That is the exfiltration shape the rule exists for, so asking there is intended. Search URLs on the first page of a run, URLs on an origin already visited, and links seen on a page are never held.

Limit: scripted sequences are not model behaviour. The rate is re-measured from recorded runs in Step 7.

## S1: service-worker WebSocket over a long run

Script: `scripts/spikes/s1-sw-socket.mts`. Run 2026-11-11: the built extension in headless Chrome 157, loaded with `Extensions.loadUnpacked` over `--remote-debugging-pipe`, connected to the engine bridge; the test-side debugger session on the service worker was detached before the wait, because an attached debugger keeps a worker alive.

Result: 10 minutes with no tool calls, only the engine's 15-second keepalive pings. 0 disconnects, 0 reconnects, still connected at the end, and a CDP call through the extension worked at the end. Decision: the service worker opens the WebSocket itself; no chunked native-messaging fallback is built.

Not covered: a laptop sleeping or Chrome being suspended. Both close the socket; the extension then reconnects with backoff and any command in flight fails as unverified.

## S4b: look as=items on real listings (recorded as S5 before plan 3.0 reused that id)

Script: `scripts/spikes/s4b-items-real.ts`. Run 2026-11-13, headless, direct CDP.

- books.toscrape.com, Mystery category: all 20 items on the page, each with title, price, stock and the add button. Next page link found. Page count read as 32. 567 tokens. 7 scroll steps to the end.
- webscraper.io test shop, laptops: 117 items with title and price. 1,428 tokens. Scrolling stopped at the 10-step bound before the end. Titles are cut because the site itself truncates link text.
- ebay.com search: the headless browser got a bot challenge, which became a handoff to the person as designed. No item result. Not representative of a headed, signed-in profile.
- news.ycombinator.com: not measured; it was blocked behind the eBay handoff in the same run.

Not covered: ratings drawn only as star images (books.toscrape), carousels, and infinite feeds longer than 10 steps. Re-measure on headed runs in Step 7.

## S5: Code Mode sandbox boundary

Script: `scripts/spikes/s5-sandbox.mts` with `scripts/spikes/s5/vm-worker.cjs`. Run 2026-11-18, Node 22.18.0, headless Chrome 157.

**Design A: a `worker_threads` worker running the script in a `vm` context.**

Setup:
- String and wasm code generation are off for the context.
- Intrinsics and their prototypes are frozen.
- The vm global object itself cannot be frozen ("Cannot freeze"), so each of its properties is locked one by one.
- `WebAssembly`, `SharedArrayBuffer`, `Atomics`, `WeakRef` and `FinalizationRegistry` are removed.
- The host functions are held only in closures created by an in-context prelude, which also keeps its own copies of `JSON`, `Promise`, `Map` and the error classes.
- Only JSON strings and primitives cross in either direction.
- The worker runs with `resourceLimits` and an empty `env`.

Escape attempts: 0 of 16 succeeded. Each attempt and how it was stopped:

| Attempt | Stopped by |
|---|---|
| Globals (`process`, `require`, `fetch`, `Buffer`, `WebAssembly`, `SharedArrayBuffer`, `setTimeout`) | All undefined |
| `eval` and `Function` | `EvalError` |
| Constructor chains from `globalThis`, a `space` method, a reply value and a rejected-call error | `EvalError` (every reachable function belongs to the context) |
| `Error.prepareStackTrace`, prototype pollution, replacing a `space` method, overwriting the reply hook, the `function.caller` walk | `TypeError` |
| Dynamic `import('node:fs')` | `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING` |
| A Proxy passed as an argument | Serialized inside the sandbox; no trap runs in the host |
| Throwing getters, BigInt and circular return values | Rejected with "not plain JSON" |

Other measurements:
- Errors report the line number in the script (3 for an error on line 3).
- `while (true) {}`, both before and after an `await`, is stopped by terminating the worker after the stall time.
- A memory bomb is stopped by the heap limit after 223 ms.
- A script making 400 calls runs to the end without being stopped.
- One `space.*` round trip takes 0.056 ms (2000 calls).

**Design B: a blank Chromium page over CDP.** Every request is failed through the Fetch domain, and calls go through `Runtime.addBinding`.

- `fetch`, image and WebSocket requests are blocked.
- A navigation attempt is blocked too, but the page is left on `chrome-error://`, so the script's context is gone.
- `Runtime.terminateExecution` stops an infinite loop in 314 ms.
- One round trip takes 0.60 ms (500 calls).
- `RTCPeerConnection` is present. UDP traffic is not covered by the Fetch domain, so it needs a browser-level WebRTC policy that cannot be set in the person's own Chrome.

**Decision: Design A**, as plan section 7.1 requires when S5 finds no escape. Rules the implementation must keep:
- No host object, function or error ever enters the context.
- The prelude keeps its own copies of the intrinsics it uses.
- A run is stalled only when no `space.*` call is pending and nothing has been heard from the worker for the stall time (30 s).

Remaining risk: a V8 or Node bug in `vm`. Policy runs in the main process on every call, so an escape would still not bypass approvals for actions the engine performs. It would, however, reach Node inside the worker. Design B stays the fallback if a future probe escapes.

## S9: SQLite inside Electron (decision D2)

Script: `scripts/spikes/s9-sqlite.cjs`, run 2026-11-18 inside Electron 45.2.2 (Node 24.22.2, module ABI 150) and inside Node 22.18.0.

`node:sqlite` (built in) covers everything `packages/memory` uses, in both runtimes:
- prepared statements (`run`, `get`, `all`) and `exec`;
- pragmas: WAL, `auto_vacuum = INCREMENTAL`, `incremental_vacuum`, `foreign_keys`;
- upserts and enforced CHECK constraints.

Two differences from `better-sqlite3`: there is no `.transaction()` helper (use `BEGIN`/`COMMIT`/`ROLLBACK`), and no `.pragma()` helper (use `exec`/`prepare`).

| Measurement | Electron | Node 22 |
|---|---|---|
| 10,000 inserts in one transaction | 29 ms | 33 ms |
| 1,000 indexed selects | 8 ms | 10 ms |

`better-sqlite3`, the current driver, fails to load in Electron: it was built for module ABI 127 and Electron needs 150. Using it means adding `@electron/rebuild`, a dependency not in the plan's stack.

## S7: Electron's debugger and views that are not on screen

Script: `scripts/spikes/s7-s8-electron.cjs`, run 2026-11-18, Electron 45.2.2 (Chrome 156), Windows 11.

**CDP through `webContents.debugger`:**
- Auto-attach finds the cross-origin iframe. Commands on its flat session work: `Runtime.evaluate` returned the child's own origin, and the accessibility tree inside it has 9 nodes.
- `Accessibility.getFullAXTree` and `DOMSnapshot.captureSnapshot` work on the main frame.
- `Page.captureScreenshot` gives no answer for a view never attached to a window. The same view attached to a window placed off screen returns a screenshot.

**Rendering of views that are not shown.** Each case scrolled a 4000 px page with five trusted wheel events:

| View | Trusted wheel | Scrolled | IntersectionObserver | Lazy image | Animation frames | Timers |
|---|---|---|---|---|---|---|
| Shown in the window | yes | yes | fired | requested | 172 | normal |
| Attached, `setVisible(false)` | no answer | no | not fired | not requested | 0 | throttled |
| Attached to a window placed off screen, `backgroundThrottling: false` | yes | yes | fired | requested | 173 | normal |
| Never attached, `backgroundThrottling: false` | no answer | no | not fired | not requested | 0 | normal |
| Never attached, `backgroundThrottling: true` | no answer | no | not fired | not requested | 0 | throttled |

Decision: background Agent tabs live in an agent host window, an invisible `BaseWindow` placed outside every display. It has no taskbar entry and cannot take focus. A tab moves into the main window when the person views it. `backgroundThrottling: false` alone is not enough.

**Memory per real page** (private bytes / working set of the page process, loaded at 1280x800):

| Page | Private | Working set |
|---|---|---|
| books.toscrape.com | 32 MB | 99 MB |
| webscraper.io laptops | 67 MB | 143 MB |
| en.wikipedia.org | 55 MB | 135 MB |

The app's total private memory was 180 MB as a baseline and 286 MB with three pages loaded. It fell to 134 MB 2.5 s after closing them, so closing a view releases its page memory. The concurrency formula starts from 150 MB per page instead of 350 MB and corrects itself from `app.getAppMetrics()` at run time. Heavy retail pages are to be measured in Step 6.

## S8: transparent overlay view as the input shield

Same script and run as S7. The person's input was simulated as Windows mouse and key messages posted to the app's own window handle, so the real cursor was never moved. The window was shown without taking focus.

| Check | Result |
|---|---|
| No overlay: the person clicks the button | Reaches the page (clicks = 1) |
| Overlay on: two person clicks on the button | Page +0; the overlay received 2 mousedowns |
| Overlay on and focused: the person types "xy" | Page field stays empty; the overlay saw "xy" |
| Overlay on: the engine clicks with CDP `Input.dispatchMouseEvent` | Page +1 |
| `capturePage` of the tab where the overlay draws red | White (`rgb(255,255,255)`); the overlay is not in it |
| Overlay removed: the person clicks | Page +1 at once |

Decision: the Shell Overlay view in plan section 4.4 works as designed. Open item for Step 4: omnibox suggestions in the overlay must keep keyboard focus in the omnibox. That is not covered here.

### S7 addendum (Step 2, 2026-11-18): occlusion

In the Step 2 end-to-end run, the agent host window stopped rendering after some minutes: trusted input to its pages timed out. This happened while the machine was under load, and the 3-second spike was too short to show it. Chromium's native window occlusion tracking marks a window placed beyond every display as occluded and then treats its pages as hidden.

Aether Desktop now starts with `--disable-features=CalculateNativeWinOcclusion` and `--disable-backgrounding-occluded-windows`. With both, the Step 2 exit tests pass in two full parallel runs and in two runs under extra load.

## S10: host support for the command-plus-skill connection

Open. It needs each real host (Claude Code, VS Code Copilot, Antigravity,
opencode, Cursor) to load the linked skill, run `/aether`, and let its shell
tool run `aether exec` with a script on stdin. Method: a probe skill that
logs each invocation, plus the request log of the optional MCP adapter.

What is already true without the spike: `pnpm aether:install` links
`skills/aether` into every installed host's skills folder (junctions on
Windows), `aether` is on the user PATH, and `aether doctor` reports each
link. The command and skill path is therefore the default; the optional
`aether mcp` adapter over the app service is built only if a host the
person uses cannot run the command.
