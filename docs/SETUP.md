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
pnpm extension:build
pnpm native-host:build
```

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

For hosts that take a command and arguments:

```json
{
  "mcpServers": {
    "aether": {
      "command": "pnpm",
      "args": ["--dir", "D:\\Agentic Browser\\aether", "mcp"]
    }
  }
}
```

Use the absolute path of your checkout. When the host starts the server, Aether writes `~/.aether/bridge.json` (owner-only) with a random port and token, the native host passes them to the extension, and the extension connects. The side panel then shows **Connected**.

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

| Panel says | Meaning and fix |
|---|---|
| Native host missing | The host is not registered for this extension ID. Run step 3 with the ID shown on `chrome://extensions`, then reload the extension. |
| Waiting for your agent | The engine is not running. Start or reconnect your MCP host. A `bridge.json` left by a killed engine is replaced when the next one starts. |
| An agent error naming a protected page | Chrome does not allow debugging `chrome://` pages, the Web Store or other extensions. Open a regular web page. |

## Deterministic runs without the extension

`pnpm mcp --direct --headless` starts the MCP server on an isolated, throwaway Chrome profile. The test suite and evaluations use this mode; it never touches your profile.

## Native messaging spike

`powershell -ExecutionPolicy Bypass -File scripts/spikes/native-host-stdio.ps1` checks that the Windows command launcher preserves a framed stdio message.
