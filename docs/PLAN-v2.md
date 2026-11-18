# Aether: Agentic Browser Plan

Working title: Aether. Version 2.0. Date: 2026-11-11. Status: Steps 0 to 6 built and tested on 2026-11-11 (spikes S1, S2 and S4 run, S3 needs a person; see `docs/SPIKES.md`). Steps 7 and 8 need recorded runs with a model and are not started. Replaces version 1.0.

---

## 1. Motive

Build an agent engine that operates a real, logged-in Chrome the way a person does: glance at the page, focus on the relevant region, act, and check what changed. It must complete research, search, booking, registration and purchase tasks with at least 80 percent fewer tokens per successful task than a full-snapshot browser agent, and hand control to the human and back without losing state.

Anything that does not serve that paragraph is out of scope.

## 2. Rules that never bend

1. The engine owns perception, action, policy, memory and logging. Chrome owns the browser UI. Aether adds only an edge overlay on agent tabs and a side panel.
2. Never send a page to the model. Send a skim, then a focused region on request, then deltas.
3. We own the CDP client. No agent frameworks. No Playwright or Puppeteer in the control path.
4. Every optimization must beat a recorded baseline or be deleted. Code with no caller is deleted.
5. Page content is untrusted. It never gets authority over tools, policy, approvals or memory.
6. One run state machine in the engine is the single source of truth. The overlay, the side panel and tool results all render that state; none of them keeps its own.
7. Approvals and answers come only from the side panel. A model-supplied argument can never unlock an action.
8. A ref is an identity. It is never re-bound to a different element.

---

## 3. Final stack (one choice per layer)

| Layer | Choice | Notes |
|---|---|---|
| UI | Stock Google Chrome, minimum version 125 | Flat debugger sessions need 125. |
| Eval browser | Stock Chrome or Chrome for Testing, pinned | Isolated `--remote-debugging-port=0` and `--user-data-dir`. |
| Control protocol | Chrome DevTools Protocol, own thin client over `ws` | Frame-level sessions, trusted `Input.*` events. |
| Real-profile transport | MV3 extension using `chrome.debugger`; WebSocket from the extension service worker to the engine; native messaging host for bootstrap only | See 4.2. Subject to spike S1. |
| Eval transport | Direct CDP to an isolated Chrome | Deterministic tests, no extension. |
| Language and runtime | TypeScript (strict), Node LTS >= 22, pinned in `.nvmrc` | |
| Package manager | pnpm workspaces | |
| Extension build | WXT with React | |
| Extension permissions | `debugger`, `nativeMessaging`, `sidePanel`, `tabs`, `tabGroups`, `scripting`, host permission `<all_urls>` | `tabGroups` for the agent workspace, `scripting` and host permission for the overlay content script. |
| Side panel and overlay | React (side panel), plain DOM (overlay), plain CSS with shared design tokens | No component or CSS library. |
| Validation | zod | All tool and wire schemas in `packages/shared`. |
| Logging | pino (JSON lines) | Listed in 1.0 but never installed. |
| Storage | SQLite through `better-sqlite3`, file `~/.aether/aether.db` | Memory and run log. Listed in 1.0 but never installed. |
| Tests | vitest plus the local fixture server | |
| Lint | Biome | |
| Agent reasoning | The connected MCP host supplies the model and the agent loop | No LLM API key in Aether. |
| Agent connection | `@modelcontextprotocol/sdk` over stdio | |
| OS | Windows first | |

No other libraries. Page-to-text conversion and diffing are written in this repo.

---

## 4. Architecture

### 4.1 Components

```
MCP host (model + loop)
   |  MCP stdio, 8 tools
aether engine (Node)
   RunState | Perceiver | Actor | Policy | Memory | Log
   |  CDP over ws (same client for both transports)
   +-- eval:  isolated Chrome, direct
   +-- real:  loopback WebSocket <--- extension service worker --- chrome.debugger --> agent tab
                  ^ port + token
              native host (bootstrap only)

Extension: service worker (CDP proxy, tab group, state fan-out)
           overlay content script (edge light, status pill)
           side panel (steps, questions, approvals, memory)
```

### 4.2 Transport

Version 1.0 relayed every CDP frame through native messaging, which caps a message at 1 MiB. Accessibility trees and screenshots of real pages exceed that, and the perceiver then returned an empty outline.

Version 2.0:

- The engine listens on `127.0.0.1` on a random port and writes `{port, token}` to `~/.aether/bridge.json` (owner-only).
- The native host does one job: read that file and hand `{port, token}` to the extension over native messaging, then report when the file changes or disappears. It carries no CDP traffic.
- The extension service worker opens the WebSocket itself. Chrome sets the `Origin` header, so the engine checks a real extension origin plus the token. The first message is an auth frame carrying the token; the socket is closed if it is wrong or late.
- Two message kinds on the socket: CDP frames (request, response, event) and run-state frames (4.3). Both are zod schemas.
- Application-level keepalive with acknowledgement detects a hibernated service worker. An input command whose reply is lost is never replayed; the tool result says delivery is unverified and the model must look before retrying.
- When the debugger detaches for any reason the extension sends an explicit detach event, the engine clears refs and frames, and the next call re-attaches and re-enables domains.

Spike S1 decides whether a service-worker WebSocket to loopback stays alive for a whole run. If it does not, the fallback is chunked frames over native messaging; the spike result is reported before either is built.

### 4.3 Run state machine

```
idle -> acting -> waiting_human -> resuming -> acting -> ... -> idle
```

`waiting_human` has a reason: `question`, `approval`, `must_perform`, `user_interrupted`, `captcha`.

- `acting`: a tool call is executing. Overlay is blue.
- `waiting_human`: the engine holds the pending tool call. Overlay is amber, the side panel shows one card for the reason.
- `resuming`: the human finished. The engine clears refs, takes a fresh skim and returns it as the result of the held call, prefixed with one line stating what the human did (`answered: ...`, `approved`, `denied`, `human acted`).
- Every transition is one `aether.state` frame to the extension, which fans it out to the overlay and side panel. Reloading either re-reads the current state from the service worker.

A held tool call waits up to 50 seconds, then returns `pending handoff=<id>`; the model calls `ask` with that id to keep waiting. This keeps the pipeline synchronous for the model without exceeding host tool timeouts.

### 4.4 Agent workspace

The agent works only in tabs inside a Chrome tab group named "Aether", coloured blue.

- `open` creates the group's first tab if none exists. Tabs opened by agent clicks join the group and become the active agent tab.
- A mutating action never falls back to the user's active tab. The user can add the current tab to the group from the side panel ("Let Aether use this tab").
- The group shares the profile's cookies and logins. It is a visibility and targeting contract, not a security boundary.
- Internal pages (`chrome:`, extension pages, the Web Store, `file:`) are never attached.

---

## 5. Perception: skim, focus, read

A person does not read a page top to bottom. They glance at the layout, look at the region that matters, and read text only when the task is to read. The perceiver has the same three levels, and the model pays only for the level it asks for.

### 5.1 Capture

Per frame: `Accessibility.getFullAXTree` for roles, names and states; one `DOMSnapshot.captureSnapshot` per session for bounding boxes, paint order, attributes and the `display`, `pointer-events` and `visibility` styles, joined on `backendDOMNodeId`. Spike S2 (`docs/SPIKES.md`) found the snapshot cheaper than batched `DOM.getBoxModel` on every large page, and the accessibility tree itself the dominant cost, so the snapshot is used and capture latency on large pages is a Step 8 item.

A control is marked `[covered]` when a node in a strictly later paint layer sits over its centre and is unrelated to it (not itself, an ancestor, a descendant, or part of the same label). Each such mark in the main frame is then confirmed with the browser's own hit test, because the snapshot does not report clipping.

Kept nodes: interactive roles, headings, landmarks, tables (`table`, `row`, `cell`, `columnheader`), and list containers. Ignored and generic containers are flattened. Nodes with no `backendDOMNodeId` are omitted. Password, one-time-code and payment field values are replaced with `***` at one choke point before anything else sees them.

If a frame cannot be read, the result says so outside the untrusted wrapper: `partial capture: 1 frame not read; its content is unknown, not absent`. A failed capture is never returned as an empty page.

### 5.2 Skim (returned by `open`, and by `look` with no arguments)

- Header line: URL, title, frame count, scroll position as a percentage.
- Elements inside the viewport, one line each, indented under their landmark.
- For each landmark with content outside the viewport, one summary line: `main e14: 38 more below (26 link, 9 button, 3 textbox)`.
- Runs of 6 or more same-role siblings collapse to the first 3 plus a count line that names the container ref to expand. Table rows never collapse.
- A container with a ref (list, table, listbox) keeps its own out-of-view summary line with `look ref=<container> after=<last shown>`, so the model pages through it the way a person scrolls a list. Regions nested inside a region are counted into its summary when out of view; only top-level regions always get a line.
- Empty unnamed containers and table rows with no text and no controls are omitted.
- When most controls in view are covered, a `!` line says so and names the controls that are still reachable, which are usually the overlay's own buttons.
- Any element covered by another element at its centre point is marked `[covered]`; a dialog or overlay that covers the page is listed first.
- Budget: 1,200 tokens, estimated at 3.5 characters per token. When exceeded, regions at any depth collapse to one summary line each, in the order footer, navigation, complementary, banner, search, region, form, frame, larger first; `main` and dialogs never collapse. If still over, the output is cut with `look ref=<container of the last line> after=<last ref shown>`. Nothing is silently dropped: every omission is a line that names the ref to expand or says `use find`.

Line format: `[e7] button "Submit" [disabled]`. Names truncate at 80 characters, values at 60. Names and values are quoted with inner quotes escaped, and bracketed tokens inside them are rewritten with parentheses (`[e5]` becomes `(e5)`), so page text cannot imitate a ref or a state.

### 5.3 Focus (`look` with a ref)

Returns the full subtree of that ref regardless of viewport and a 1,500 token budget, paged with `after=<ref>`. The direct children of the focused ref never collapse, so paging walks through all of them; deeper runs collapse with a pointer to their container. Tables render as one pipe-separated line per row with the row's ref, so filter and sort tasks keep their structure.

### 5.4 Read (`look` with a ref or none, `as: "text"`)

Returns the visible text of the region as compact markdown (headings, lists, links with their refs, table rows), built from the accessibility tree with line breaks taken from CSS `display`. Text typed into fields appears only as the field's value. Budget 2,000 tokens, paged with a line cursor `after=t<N>` given in the footer. This is the reading path for research tasks; it is never returned by action tools.

### 5.4a Items (`look as: "items"`)

Added 2026-11-13 after observed runs that chose from the first screen of a listing. Published evaluations show the same failure. Agents stop at the first plausible offer (WebMall). They skip filters and sorting: Online-Mind2Web attributes most of Operator's failures to this, and DeepShop reports it too. Observing the whole page also beats observing one viewport (AgentOccam).

`look as=items` works in three stages:

1. Scroll. It scrolls the page with trusted wheel input, up to 10 steps, until the height stops growing, so lazily loaded items exist. Then it returns to the top.
2. Detect. It groups links outside navigation landmarks by URL path shape (`/item/#`, `/dp/*`) and picks the group whose segments carry the most item detail. Links inside a heading count, since card titles are usually headings.
3. Print. One line per item: ref, title, prices, rating and review count, sponsored, stock and delivery notes, and the add or select button.

The header gives:
- the item count, and the count the page states;
- how many items are new in this run;
- the sort control;
- the next page or "more" control, or says none was found.

On a product page it adds the schema.org `Product` facts the page declares in JSON-LD (price, availability, rating, seller). These are page content and stay inside the untrusted wrapper. Budget 2,200 tokens. Distinct items seen are counted per run and reset by `done`.

A plain `look` returns one line instead of the skim when nothing has changed since the last skim: same document, same scroll position, no change.

The method itself is sent once as MCP server `instructions` (`apps/cli/src/mcp/instructions.ts`, under 1,500 characters), which hosts add to the model's system context:
1. Restate the criteria.
2. Sort and filter first.
3. Survey every item and page.
4. Shortlist at least three.
5. Open each product page.
6. Ask when options are close.
7. Get approval before anything irreversible.

### 5.4b Procedural Harvest & Graph Matcher (`look as: "survey"`)

Added 2026-11-14 to solve the token burning flaw of multi-step agent browsing. Standard agentic browsers burn 50k–200k tokens per shopping/research run by making dozens of micro-action LLM round-trips (`look` -> model -> `click next` -> model -> `scroll` -> model). Inspired by Cloudflare's procedural payload approach, `as="survey"` accepts a procedural goal and executes the multi-page crawl autonomously inside the engine before returning a single, highly refined token-efficient result.

```
look(as: "survey", query: "running shoe under 100 without Trail", max_pages: 2)
```

How it works:
1. **Autonomous Multi-Page Harvesting (`ItemBucket`)**:
   - For each page up to `max_pages`, the engine executes trusted wheel scrolling to trigger lazy loaders.
   - Extracts candidate item cards (title, price, ratings, reviews, stock, link URL) into an in-memory `ItemBucket`, deduplicating items across pages via normalized URL slugs.
   - Autonomously locates and clicks the next page pagination control (`NEXT_PAGE`), waiting for DOM settle.
2. **Connected Graph & Pattern Matcher (`ProductGraphMatcher`)**:
   - **Constraint Filtering**: Prunes items exceeding budget caps (`under 100`), matching negative terms (`without Trail`), or marked out of stock.
   - **Inter-Item Semantic Graph**: Builds a token similarity graph across candidates (Jaccard token affinity + cluster density/centrality + query alignment). Outliers (e.g. phone cases, socks, sponsored junk) receive low centrality scores and are pruned.
   - **Scoring & Ranking**: Scores valid candidates by query match, rating confidence, price attractiveness, and cluster density.
3. **Compact Token Output**:
   - Returns a structured markdown shortlist of top $k$ candidates with preview links, pricing, rating, and pattern highlights.
   - Groups pruned items into a one-line summary with exact prune reasons.
   - Consumes ~400–600 tokens total for an entire multi-page search, cutting token overhead by ~95-99%.

### 5.5 Find

`find(query, role?)` searches names, values and text across all frames, including content outside the viewport and past any budget. It returns up to 12 matches as `[ref] role "name"` plus the enclosing landmark, ranked by exact match, then word match, then substring. A match outside the viewport is usable directly: acting on it scrolls it into view.

### 5.6 Deltas

Every `act` returns a delta, never a snapshot:

```
step 4 ok 3/3 | url unchanged | scroll 0% -> 22%
~ [e12] textbox "Email" value="a@b.co"
+ [e31] alert "Enter a valid phone number"
- [e9]
text + "2 items in your cart"
```

- Element lines for added, changed and removed kept nodes.
- `text +` and `text -` lines for visible text that appeared or disappeared (multiset line diff, capped at 12 lines, then a count).
- A full skim replaces the delta on navigation, on frame-set change, when more than 40 percent of elements and at least 10 of them changed (a bulk replacement), or when the delta would be longer than the skim. Filling four fields of a small form is not a replacement: the model gets the four `~` lines.
- If nothing changed, the delta says `no page change observed` so the model does not assume success.
- A tab opened by the action is reported (`new tab: <title>, now the agent tab`) and followed by its skim.
- If the settle cap was reached, the header says `page still changing` so the model knows the delta may be incomplete.

### 5.7 Refs

- Format `e1`, `e2`, .... Assigned monotonically per agent tab. Registry key is `(frameOrdinal, backendDOMNodeId)`.
- Never reused and never re-bound. On a document change the mappings clear and the counter continues.
- One uniform stale error: `stale [e5]: no longer on the page, nothing was done. Call look or find for current refs.`
- Refs created by `find` and `look` are as valid as refs from a skim.

---

## 6. Action

`act` takes 1 to 8 actions, a declared risk, and a reason.

| Op | Behaviour |
|---|---|
| `click` | Scroll into view, hit-test the centre point, trusted mouse press and release. A covered target fails with the covering element named. |
| `fill` | Focus, select all, `Input.insertText`. For `select` elements and ARIA comboboxes, choose the option by visible label. For checkboxes and radios, set to the given state only if it differs. |
| `key` | Trusted key event on the focused element (`Enter`, `Escape`, `Tab`, arrows, `PageDown`). |
| `hover` | Trusted mouse move. |
| `scroll` | By ref (scroll that container) or page, by `up`, `down`, `top`, `bottom`. |
| `dialog` | Accept or dismiss an open JavaScript dialog. |
| `upload` | `DOM.setFileInputFiles` on a file input. Step 6. |

Rules:

- All input is CDP `Input.*`, so events are trusted. No synthetic DOM events.
- Each action yields one receipt in the delta header (`3/3`). The batch stops at the first failure, at any navigation, and when a JavaScript dialog opens; remaining actions are reported as not run.
- Settle after the batch: poll a structural accessibility hash every 150 ms until two samples match, cap 2.5 s, extended while a navigation or a tracked network request started by the action is in flight.
- A JavaScript dialog is surfaced in the next tool result as `dialog confirm "Leave site?"`; nothing else can run until it is handled.
- The overlay never intercepts input: it has no pointer events except the status pill, which moves aside when a click targets its area.

---

## 7. Tools

Eight tools. Names and schemas are fixed after Step 2 so the host's prompt cache stays valid. `look as` supports `items` (5.4a) and procedural `survey` (5.4b).

| Tool | Arguments | Returns |
|---|---|---|
| `open` | `url`, `new_tab?` | Skim of the loaded page, plus one memory line if procedures exist for the site. |
| `look` | `ref?`, `as?: "outline" \| "text" \| "items" \| "survey"`, `after?`, `query?`, `max_pages?` | Skim, focused subtree, text, listing items (5.4a), or procedural survey & graph-matching (5.4b). |
| `find` | `query`, `role?` | Ranked matches with refs. |
| `act` | `actions[1..8]`, `risk`, `why` | Delta. |
| `screenshot` | `ref?` | Downscaled PNG with the overlay hidden. For visual widgets only. |
| `ask` | `question`, `options?`, `handoff?` | The human's answer and a fresh skim. Blocks per 4.3. |
| `memory` | `op: "recall" \| "save"`, `site?`, `key?`, `value?` | Matching memory, or a save receipt. |
| `done` | `result`, `evidence`, `success` | Closes the run, records metrics, may save a procedure. |

Tool results are plain text, not JSON. Every result that contains page-derived text is wrapped as `<page untrusted nonce=... origin=...>` ... `</page untrusted nonce=...>`, with a random nonce per call so page text cannot forge the closing tag. Engine messages (errors, receipts, state lines, capture warnings) stay outside the wrapper. Budget for all eight tool definitions together: 900 tokens.

---

## 8. Policy and safety

The working assumption is that a prompt injection will sometimes succeed. Policy bounds what it can achieve.

1. **Four outcomes**: `allow`, `needs_approval`, `human_must_perform`, `refuse`.
2. **Checked once**, in the engine, immediately before execution, on the resolved element and its DOM attributes, not on the model's description.
3. **`human_must_perform`**: typing into password, one-time-code and payment-card fields; CAPTCHAs. The run enters `waiting_human`; the debugger stays attached unless spike S3 shows it interferes with CAPTCHA completion.
4. **`needs_approval`**: declared `irreversible` risk; a target whose name matches the irreversible trigger list (buy, pay, place order, send, post, publish, delete, submit, confirm, transfer, subscribe) inside a form or dialog; the final submit of any form containing payment or personal-identity fields. The approval card shows the site, the element, the form values about to be submitted with sensitive ones masked, and the model's stated reason labelled as the agent's claim.
5. **Navigation**: scheme and origin are checked on the parsed final URL, default deny, only `http` and `https`. Redirect targets are re-checked.
6. **URL provenance**: `open` is allowed without approval when the origin is already in the run's origin set, or the exact URL was observed as a link, or the URL has no query string or fragment. Anything else (a model-built URL carrying data to a new origin) is `needs_approval`. Spike S4 measures the false-positive rate on the task suite before this ships.
7. **Untrusted wrapper** on all page-derived text, with wrapper-escape and role-token sequences neutralised. This is a signal, not a defence.
8. **No general script execution tool**, no local file access, no reading of extension or settings pages.
9. **User interruption**: Take over in the page pill or the side panel moves the run to `waiting_human(user_interrupted)` before the next action; the batch stops and the remaining actions are reported as not run. Interruption is explicit because CDP input is trusted in the page and cannot be told apart from the person's own input. Stop ends the run at the next tool call.

---

## 9. Human in the loop UI

Design language: the page stays the page. Aether draws light on the edge of the viewport and one small pill, nothing else. No gradients, no sparkle icons, no chat bubbles on the page.

### 9.1 Edge overlay (content script, agent tabs only)

- A 2 px line on the inner edge of the viewport with a soft inward falloff of about 28 px, drawn with fixed-position layers in a closed shadow root.
- `acting`: blue (`#2F6BFF`), opacity breathing between 0.55 and 1.0 over 3.6 s. Animation is on opacity only; no animated `box-shadow`. With reduced motion the line is static.
- `waiting_human`: amber (`#F5A524`), static, and the tab group title changes to "Aether: needs you".
- `idle`: no overlay.
- Status pill, bottom centre: current step as a verb phrase ("Filling the passenger form"), a Stop button, and a "Take over" button. While `waiting_human` it shows the reason and a Resume button.
- The overlay root is `aria-hidden` and `inert` except the pill, is excluded from capture by its marker attribute, and is hidden for the duration of any screenshot.
- It removes itself when the service-worker port disconnects or the debugger detaches, so it cannot outlive the run.

### 9.2 Side panel

- Header: connection state and the agent tab title.
- Step list: one line per tool call from the run log, newest first, with the step's token cost.
- One card at a time for `waiting_human`: a question with option buttons and a free-text field; an approval with Approve and Deny; a must-perform instruction with "I've done it".
- Memory tab: list, edit and delete stored facts and procedures; a switch to turn memory off.
- "Let Aether use this tab" and "Stop run".

### 9.3 Resume contract

After any human action the engine clears refs, re-captures, and returns a fresh skim. The agent never continues from a pre-handoff snapshot and never reclaims control before the human presses Resume, answers, or decides.

---

## 10. Memory

Stored locally in `~/.aether/aether.db`. Nothing leaves the machine except what a tool result returns to the host.

| Kind | Example | Written by | Retrieved by |
|---|---|---|---|
| Profile fact | `seat preference = aisle`, `home airport = AMD` | The user in the side panel, or `memory save` after an approval card | `memory recall`, by key or keyword |
| Site procedure | `irctc.co.in / search trains`: ordered steps as text with roles and names, not refs | The engine on `done success=true`, from its own action log | One line appended to `open` when procedures exist for the origin; full text via `memory recall` |
| Site note | `this site's date picker needs typed dd/mm/yyyy` | `memory save` with `site` set | Same as procedures |

Rules:

- Credentials, card numbers, one-time codes and anything matching the sensitive pattern are never stored. The save is refused.
- Procedures are built from engine-recorded actions and element names the engine observed, with names passed through the sanitizer. Free page text is never written to memory.
- A procedure records success and failure counts; after two consecutive failures it is marked stale and no longer advertised.
- Recall results are capped at 300 tokens and wrapped as untrusted when they contain site-derived names.
- Memory can be turned off; then `memory` returns an empty result and nothing is written.

Procedures replace the unused replay cache from version 1.0: the model still decides each step, but starts from a known route instead of exploring.

---

## 11. Measurement

The 80 percent target is a claim about tokens per successful task, not about snapshot size.

- **Baselines**, same model, same host, same step cap, pinned versions: Playwright MCP in default (incremental) mode, Playwright MCP in `full` snapshot mode, and browser-use. Reported separately.
- **Suite**: the 20 tasks in `docs/METRICS.md`, extended in Step 8 with a live-site subset covering search, research, booking and registration up to the final submit, and purchase up to checkout. Three runs per task.
- **Recorded per run** in the run log: success (state check on fixtures, fixed judge with human spot checks on live sites), tool-result tokens by tool, tool-definition tokens, input, cached-input and output tokens when the host exposes them, steps, human interventions, wall time.
- **Headline**: total tokens across all attempts divided by successful tasks, with the success-rate difference and its confidence interval. The 80 percent figure is stated only if success is not significantly lower than the baseline. Results are also split by task category, because filter, sort and table tasks are where a compact observation is most likely to cost success.
- **Per-step budgets** (targets, checked in tests on fixtures): skim 1,200 tokens, typical delta 150, `find` result 200, tool definitions 900.

---

## 12. What changes from the 1.0 code

| Area | Decision |
|---|---|
| `packages/cdp` client, sessions, launcher | Keep. Add a public way to get a session by id (removes the private-field casts). |
| `packages/perceiver` registry, extractor | Keep and extend (tables, masking, boxes). |
| Serializer, collapser, delta | Rewrite for skim, focus, text and text-line deltas. |
| `packages/actor` | Rewrite input around the op table in section 6; remove the shared static mouse position and the ref re-query fallback. |
| `ReplayCache`, `HistoryCompactor`, viewport stub, `classifyBatch`, pick mode | Delete. No callers; replaced by procedures (10) and by the host's own history. |
| `packages/policy` | Keep the URL boundary and sanitizer; rewrite the classifier per section 8; one check per action. |
| MCP server | Rewrite for the eight tools and the run state machine. |
| Bridge and native host | Rewrite per 4.2. The framing code is kept for the bootstrap channel. The relay's reconnect loop is removed: the extension now opens and reconnects the socket itself, and the native host only reports the port and token. |
| Extension | Rewrite: service worker with tab group and state fan-out, overlay content script, side panel with working cards. |
| New packages | `packages/memory`, `packages/runlog`. |
| Fixtures and tests | Keep; add fixtures for tables, a covered element, a JavaScript dialog, a multi-step form, and a long scrolling page. |

---

## 13. Steps

Work one task at a time, in order. After each task run `pnpm typecheck`, `pnpm lint`, `pnpm test`. A step's exit gate must pass before the next step starts.

**Step 0. Clear the ground.** Delete the code listed for deletion in section 12 and its tests. Add the public session lookup. Exit: checks pass; no file references a deleted module.

**Step 1. Perception.** Capture with boxes (after S2), masking, tables, skim, focus, text, find ranking, element and text deltas, budgets. Exit: fixture tests for each level and each budget; refs stable across repeats and never reused; `probe` prints a skim and its token count for the five fixtures and five real sites, recorded in `docs/probe-results.md`.

**Step 2. Action and tools.** Op table, receipts, batch stop rules, dialog handling, settle. MCP server with the eight tools over direct CDP. Exit: an MCP client completes the four fixture tasks in `docs/METRICS.md` through stdio; tool definitions fit the 900 token budget.

**Step 3. Run state and policy.** State machine, held calls, classifier, approvals, provenance (after S4), interruption. Exit: tests drive every transition with a fake human channel; password, payment and irreversible fixtures produce the right outcome exactly once per action.

**Step 4. Transport.** Spike S1, then the loopback socket, bootstrap native host, auth frame, keepalive, detach propagation. Exit: bridge tests pass with a 5 MiB CDP response; lost-reply and detach cases covered.

**Step 5. Extension.** Service worker, tab group, overlay, side panel cards wired to the state machine. Exit: on the real profile a run shows the blue edge, a question pauses to amber and resumes with a fresh skim, Stop ends the run and removes the overlay; overlay absent from screenshots and from the accessibility capture.

**Step 6. Memory and run log.** SQLite schema, facts, procedures, notes, side panel memory tab, pino logging, upload op. Exit: a repeated fixture task uses a stored procedure and takes fewer steps; sensitive saves are refused. If Step 7 shows procedures do not reduce tokens per successful task, they are removed in Step 8 and only profile facts remain.

**Step 7. Measurement.** Baseline harness and the comparison in section 11. Exit: results committed to `docs/METRICS.md` with the headline figure and per-category split, whatever the number is.

**Step 8. Tune or cut.** Each optimization is switched off in turn; any that does not reduce tokens per successful task is deleted.

### Spikes

Each spike is a small isolated script under `scripts/spikes/` and its result is reported before the dependent work starts.

| Id | Question | Blocks |
|---|---|---|
| S1 | Does a service-worker WebSocket to loopback survive a 10 minute run, and what closes it? | Step 4 |
| S2 | Latency of `DOMSnapshot.captureSnapshot` joined to the accessibility tree versus batched `DOM.getBoxModel`, on the real-site set | Step 1 capture. Done 2026-11-11: snapshot chosen, see `docs/SPIKES.md` |
| S3 | Does an attached debugger stop a human from passing common CAPTCHAs? | Step 3 `captcha` handling |
| S4 | False-positive rate of the URL provenance rule on the task suite | Step 3 provenance |

---

## 14. Research basis

Findings that shaped this plan. Sources are in the research reports from 2026-11-11.

- **Shared pattern** across Comet, Claude for Chrome, ego lite and others: a remote model, a small tool set, a local executor with input-level control of a real logged-in tab, an accessibility tree filtered to interactive nodes with short refs, a separate page-to-text tool, screenshots as fallback, a coloured glow on the agent's tab, Stop and take-over controls, and confirmation for irreversible actions. Aether keeps the pattern and differs in what it returns per step (skim, focus, delta) and in holding the tool call during human input.
- **Comet** runs its agent as a bundled extension over `chrome.debugger` with a cloud planner and batched actions. Its published failures were page text mixed with instructions, model-built URLs used for exfiltration, a privileged message surface open to a whole web origin, test handlers shipped in production, and string-matched URL blocks. Sections 4.2 and 8 address each.
- **ego lite** gives agents separate Spaces with a blue glow and an explicit hand-off and take-over contract that requires re-reading the page. Sections 4.4 and 9.3 follow that contract; its docs note Spaces are not an auth boundary, which 4.4 states for the tab group.
- **Interceptor** avoids the debugger and uses synthetic events, which forces OS-level input for trusted clicks. Aether keeps CDP input. Taken from it: refs that never re-bind, the uniform stale error, never replaying input after a lost reply, text-line diffs, tab-group isolation, large payloads off native messaging, and masking at one choke point.
- **Dia** published the URL provenance rule after finding blocklists and guard models bypassable. Section 8.6.
- **Token evidence**: diff-based history measured about 65 percent fewer input tokens at equal success; a find call returned 1.6 percent of a full snapshot; per-site workflow memory measured about 25 percent fewer steps with higher success. Counter-evidence: strong models scored 6 to 18 points higher on raw HTML than on a compact accessibility tree, mainly on filter, sort and table tasks, which is why focus mode keeps table structure and nothing is omitted without a ref to expand. Playwright MCP now defaults to incremental snapshots, which is why section 11 reports two Playwright baselines.
- **Overlay pitfalls** reported for other products: high GPU use from animated shadows, a border that outlived the session, and the glow appearing in the agent's own screenshots. Section 9.1.
- **BrowserOS** drives the page over CDP from a local server and, in its newer generation, is a pure MCP tool server with no built-in model loop, the same shape as Aether. It returns a whole-page accessibility snapshot once and a line diff after every action, has a blocking human-help tool, and fences page content with a per-call nonce. Its Chromium fork removes the debugger infobar and fills saved credentials natively, which a stock-Chrome extension cannot do. Taken from it: the nonce and origin on the untrusted wrapper (7), quoted names so page text cannot forge a ref (5.2), partial-capture reporting (5.1), pending-dialog state on every result (6), reporting a tab opened by a click (5.6), and surfacing a settle timeout instead of swallowing it (6). Not taken: whole-page snapshots with no viewport strategy, a general script or raw-CDP tool, prompt-only confirmation, and a server with no auth token. It built and then removed both a tool-approval UI and a file-based memory system; the reasons are not in its code, so Steps 3 and 6 each carry an exit gate that must show the feature earns its place.
