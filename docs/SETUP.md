# Set up Aether

Aether Desktop is the browser. Coding hosts (Claude Code, VS Code Copilot,
Antigravity, opencode, Cursor) reach it through one `aether` command and one
linked skill — nothing is configured per host.

```
host skill (/aether) --> `aether exec` --> app service (named pipe) --> Aether Desktop
```

Requirements: Windows, Linux or macOS, Node 22.13 or later, pnpm, Electron
45 (installed by pnpm).

## 1. Install

From the repository root:

```powershell
pnpm install
pnpm aether:install
```

`aether:install` builds everything, writes an `aether` shim on your user
PATH (`%LOCALAPPDATA%\Aether\bin` on Windows, `~/.local/bin` elsewhere),
adds that folder to PATH without admin rights, and links `skills/aether`
into every installed host's skills folder. Open a new terminal afterwards.

To remove all of it: `pnpm aether:uninstall`.

## 2. Check

```powershell
aether doctor
```

It reports the builds, every host link, whether the app is reachable, and
the app version. A missing or foreign link is named with its fix.

## 3. Use it

1. Start the browser: `pnpm desktop`, or just run any `aether` command —
the first one starts the app for you.
2. In your editor, type `/aether <task>` — for example
   `/aether find running shoes under $120 with 4.3 stars or more`.
   The host loads the skill, runs `aether skill` for the working method,
   and sends one TypeScript script per step with `aether exec`.
3. Watch the Agent Space in the app: the frame pulses blue while it works,
   turns amber when it needs you, and the side panel shows milestones and
   decision cards. Approvals, passwords and CAPTCHAs always stay with you.

The command exits 0 done, 1 the script failed, 2 held (a token is printed;
collect it with `aether wait <token>`), 3 the app could not be reached,
4 bad usage.

Other commands: `aether spaces` (list/focus/close), `aether screenshot`,
`aether done`, `aether status`, `aether skill`, `aether install-skill`,
`aether uninstall-skill`.

## Where things live

| What | Where |
|---|---|
| App service address and token | `~/.aether/daemon.json` (removed on a clean exit) |
| Profile (cookies, cache) | `~/.aether/profile/` |
| Spaces, tabs, memory, space state | `~/.aether/aether.db` (SQLite) |
| Settings | `~/.aether/config.json` |
| Log, JSON lines, rotated at 10 MB | `~/.aether/aether.log` |

Settings (`config.json`, editable by you only):

```json
{ "cookieBanners": "reject", "minFreeMemoryRatio": 0.2 }
```

`cookieBanners`: `"reject"` (default, refuses optional cookies), `"accept"`,
or `"off"`. The agent can neither read nor change settings.

## Legacy: the Chrome extension path (until Phase 6)

`aether mcp` still serves the four Code Mode tools over the 2.0 engine:
the Chrome extension bridge, or `--direct --headless` for CI and
evaluations. Setup for that path is unchanged:

1. `pnpm setup:build`
2. Load `apps/extension/.output/chrome-mv3` unpacked on `chrome://extensions`.
3. Register the native host: `powershell -ExecutionPolicy Bypass -File apps/native-host/install.ps1 -ExtensionId <id>`.
4. Point an MCP host at `node <checkout>/apps/cli/dist/index.js mcp` —
   never through `pnpm mcp`, whose banner corrupts the protocol stream.

It is removed in Phase 6 once the app passes every end-to-end task.
