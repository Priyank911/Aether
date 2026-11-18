# Set up Aether with your Chrome

Aether runs as an MCP server started by your MCP host. It reaches your logged-in Chrome through the Aether extension. The native host only tells the extension which local port the engine listens on; no page data passes through it.

```
MCP host --stdio--> Aether engine <--WebSocket on 127.0.0.1-- extension service worker --chrome.debugger--> agent tab
                         |                                        ^
                  ~/.aether/bridge.json  --read by-->  native host (port and token only)
```

Requirements: Windows, Google Chrome 125 or later, Node 22 or later, pnpm.

## 1. Build

From the repository root in PowerShell:

```powershell
pnpm install
pnpm setup:build
```

`setup:build` compiles the engine (`apps/cli/dist`), the native host and the extension. Run it again after pulling changes, then reload the extension on `chrome://extensions`.

## 2. Load the extension

1. Open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**.
2. Select `apps/extension/.output/chrome-mv3`.
3. Copy the extension ID from its card. The ID comes from the folder path, so it stays the same as long as you load it from the same place.

## 3. Register the native host

Per user, under `HKCU`; it writes the host manifest and one registry key:

```powershell
powershell -ExecutionPolicy Bypass -File apps/native-host/install.ps1 -ExtensionId YOUR_32_CHARACTER_EXTENSION_ID
```

Then reload the extension on `chrome://extensions`.

## 4. Add Aether to your MCP host

Run the compiled entry point with Node directly. Do not launch it through `pnpm mcp`: pnpm prints a script banner on stdout, which is the MCP protocol stream, and the host then stays at "Starting" or reports a parse error.

VS Code (`.vscode/mcp.json`):

```json
{
  "servers": {
    "aether": {
      "type": "stdio",
      "command": "node",
      "args": ["D:\\Agentic Browser\\aether\\apps\\cli\\dist\\index.js", "mcp"]
    }
  }
}
```

Claude Code, Cursor and other hosts that use `mcpServers`:

```json
{
  "mcpServers": {
    "aether": {
      "command": "node",
      "args": ["D:\\Agentic Browser\\aether\\apps\\cli\\dist\\index.js", "mcp"]
    }
  }
}
```

In VS Code the server starts when a chat session first uses it. Pressing Start in `mcp.json` before any chat exists fails with "Cannot start an MCP server before the session runtime has been created. Send a message first." That message comes from VS Code; open Chat in **Agent** mode and send a message, and VS Code starts Aether itself.

Use the absolute path of your checkout. Run only one Aether server at a time: each one writes `~/.aether/bridge.json`, and the extension connects to the newest. When the host starts the server, Aether writes `~/.aether/bridge.json` (owner-only) with a random port and token, the native host passes them to the extension, and the extension connects. The side panel then shows **Connected**.

## 5. Use it

- Open the side panel from the Aether toolbar button.
- Ask your agent to do something on the web. It opens its own tab in a blue **Aether** group; if you want it to work in a tab you already have open, choose **Let Aether use this tab** in the panel.
- While it works the tab has a blue edge and a pill with **Take over** and **Stop**. When it needs you, the edge turns amber and the panel shows one card: answer the question, approve or deny, or do the step yourself and press **I've done it**. After **Take over**, press **Resume** to hand the tab back.
- The **Memory** tab lists your preferences, the site routes Aether learned from successful runs, and site notes. Add, delete, or switch memory off there.

## Where things live

| What | Where |
|---|---|
| Bridge address, removed on a clean exit | `~/.aether/bridge.json` |
| Memory and run log | `~/.aether/aether.db` (SQLite) |
| Log, JSON lines | `~/.aether/aether.log` (`AETHER_LOG_LEVEL=debug` for more) |

## Troubleshooting

Run `pnpm doctor` first. It checks the builds and the native host registration, reports which engine owns the bridge and whether Chrome is attached to it, and, when no engine is running, starts one for 20 seconds and waits for your extension to connect.

| Symptom | Meaning and fix |
|---|---|
| The MCP host stays at "Starting" or reports a parse error | The server was started through `pnpm`, whose banner corrupts stdout. Use the `node .../apps/cli/dist/index.js mcp` command above. If `dist` is missing, run `pnpm setup:build`. The host's output channel for the server shows its stderr. |
| Native host missing | The host is not registered for this extension ID. Run step 3 with the ID shown on `chrome://extensions`, then reload the extension. |
| Waiting for your agent | The engine is not running. Start or reconnect your MCP host. A `bridge.json` left by a killed engine is replaced when the next one starts. |
| An agent error naming a protected page | Chrome does not allow debugging `chrome://` pages, the Web Store or other extensions. Open a regular web page. |

## Aether Desktop (preview, plan 3.1 Step 2)

The Electron browser that replaces the Chrome extension. Start it from the repository root:

```powershell
pnpm desktop
```

It opens with your Personal Space. Today it has:
- a plain tab strip and address bar, which Step 4 replaces with the full design;
- Spaces;
- tabs that sleep to save memory;
- protection from crashed pages.

Agent Spaces are created by agents. Until Step 3 they are created only by the test suite, because the editor connection to the app arrives in Step 3.

What it stores, all under `~/.aether`:
- `profile/`: Electron cookies and cache;
- `aether.db`: Spaces, tabs and memory, shared with the CLI;
- `config.json`: your settings.

Shortcuts work while the toolbar has focus: Ctrl+T, Ctrl+W, Ctrl+Shift+T, Ctrl+L, Ctrl+R, Alt+Left and Alt+Right. Step 4 makes them work while a page has focus too.

## How the agent works: Code Mode

`aether mcp` serves four tools: `aether_exec`, `aether_screenshot`, `aether_spaces` and `aether_done`. The eight 2.0 tools are gone.

The agent sends one TypeScript script per step to `aether_exec`. The script runs in a sandbox against the `space` SDK, which is printed in the tool's description. A multi-page survey that took a dozen tool calls is one call.

Your host shows each step as an `aether_exec` call to the aether MCP server. That is Code Mode: MCP is only the connection, and every call carries a whole script.

The host entry is the one in step 4 above; no extra flag is needed. An old `--codemode` argument is accepted and ignored.

After pulling changes:
1. Run `pnpm setup:build`.
2. Restart the server in your host.

Approvals, Take over and Stop work as before. Stop ends a running script at once.

If a script waits for you longer than 50 seconds, the agent receives a token and calls `aether_exec` again with `wait` to keep waiting.

With the Chrome extension there is one agent tab, so `space.mapPages` reads pages one after another. `openTabs` and `switchTab` need the Aether app, which arrives in Step 2.

## Settings

Your settings live in `~/.aether/config.json`. A change applies to the next page Aether loads, with no restart needed. Aether never changes this file itself, and the agent cannot change it.

```json
{ "cookieBanners": "reject" }
```

`cookieBanners` decides what Aether does with a cookie consent banner when a page loads:
- `"reject"` (default): clicks the option that refuses optional cookies ("Reject all", "Only necessary" and similar). If a banner offers no such option, Aether leaves it alone and tells the agent. It never accepts for you.
- `"accept"`: clicks "Accept all".
- `"off"`: never touches a banner.

A missing file means the defaults. If the file is not valid JSON, or a value is unknown, Aether uses the defaults and writes one warning to `~/.aether/aether.log`.

## Deterministic runs without the extension

`pnpm mcp --direct --headless` starts the MCP server on an isolated, throwaway Chrome profile. The test suite and evaluations use this mode; it never touches your profile.

## Native messaging spike

`powershell -ExecutionPolicy Bypass -File scripts/spikes/native-host-stdio.ps1` checks that the Windows command launcher preserves a framed stdio message.
