# Probe results

Recorded 2026-11-11T14:03:29.742Z by `scripts/run-probes.ts`. Headless Chrome, viewport 1280x800, Node v22.18.0.

Skim tokens are estimated at 3.5 characters per token. Latency is the time for one `Perceiver.capture()` (frame discovery, accessibility tree, DOMSnapshot, extraction), measured after the load event; it does not include rendering the skim.

| Target | Frames | Refs | Skim tokens | Capture p50 | Capture p95 | Note |
|---|---|---|---|---|---|---|
| Fixture: form | 1 | 9 | 112 | 7 ms | 16.5 ms |  |
| Fixture: nested iframes | 3 | 6 | 120 | 4.2 ms | 8.6 ms |  |
| Fixture: cross-origin iframe | 2 | 4 | 86 | 3.8 ms | 6.7 ms |  |
| Fixture: shadow DOM | 1 | 3 | 58 | 3 ms | 4.7 ms |  |
| Fixture: 500-row list | 1 | 502 | 105 | 142.3 ms | 205.2 ms |  |
| Fixture: table | 1 | 21 | 278 | 8.1 ms | 10.3 ms |  |
| Fixture: covered by overlay | 1 | 8 | 125 | 4.6 ms | 6.3 ms |  |
| Wikipedia article | 1 | 2274 | 846 | 1039.1 ms | 1460.8 ms |  |
| Hacker News | 1 | 320 | 1134 | 63.2 ms | 78.3 ms |  |
| DuckDuckGo results | 2 | 4 | 54 | 13 ms | 13.6 ms |  |
| GitHub repository | 1 | 183 | 921 | 144.8 ms | 159.6 ms | no load event before timeout |
| MDN reference | 28 | 2004 | 721 | 1220.6 ms | 1512.5 ms |  |

Real-site results depend on the live page at the time of recording and on network speed while the page settles.
