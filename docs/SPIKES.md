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

## S5: look as=items on real listings

Script: `scripts/spikes/s5-items-real.ts`. Run 2026-11-13, headless, direct CDP.

- books.toscrape.com, Mystery category: all 20 items on the page, each with title, price, stock and the add button. Next page link found. Page count read as 32. 567 tokens. 7 scroll steps to the end.
- webscraper.io test shop, laptops: 117 items with title and price. 1,428 tokens. Scrolling stopped at the 10-step bound before the end. Titles are cut because the site itself truncates link text.
- ebay.com search: the headless browser got a bot challenge, which became a handoff to the person as designed. No item result. Not representative of a headed, signed-in profile.
- news.ycombinator.com: not measured; it was blocked behind the eBay handoff in the same run.

Not covered: ratings drawn only as star images (books.toscrape), carousels, and infinite feeds longer than 10 steps. Re-measure on headed runs in Step 7.
