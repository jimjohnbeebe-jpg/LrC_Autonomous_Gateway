# LrC-AVG with other AI apps

LrC-AVG's engine is a standard MCP server that runs on this computer (stdio). The setup writes Claude Desktop's entry by itself ([README](../README.md#install)). Other MCP clients can start the same engine; each one needs an entry that runs the Node.js the setup installed with the engine's `main.js`. **The model must be able to see images:** the AI judges each pass by looking at a render.

Where a claim below carries a mark, the marks are those of [`.claude/rules/02-sourcing.md`](../.claude/rules/02-sourcing.md): `[handle: …]` can be checked, `[unverified]` has not been observed, `[inference]` is reasoning, `[stated]` is the author's word.

## The two paths

The setup installs into `%LOCALAPPDATA%\LrC-AVG` [handle: `hud/src-tauri/tauri.conf.json` `productName`, `tauri.setup.conf.json` `installMode: currentUser`; `hud/src-tauri/windows/hooks.nsh:25-26`]. Every entry uses the same two files:

| In the snippets | File |
|---|---|
| `<node>` | `%LOCALAPPDATA%\LrC-AVG\resources\node\node.exe` |
| `<main.js>` | `%LOCALAPPDATA%\LrC-AVG\resources\engine\dist\mcp\main.js` |

Config files do not expand `%LOCALAPPDATA%` [inference: they are read as plain JSON, YAML or TOML], so write the full paths. To print them, run in PowerShell:

```powershell
"$env:LOCALAPPDATA\LrC-AVG\resources\node\node.exe"
"$env:LOCALAPPDATA\LrC-AVG\resources\engine\dist\mcp\main.js"
```

In JSON, write each `\` as `\\`. The YAML and TOML snippets use single quotes, which take `\` as it is.

When an edit starts, the AI can name its own model; Lightroom's HUD and the Deck then show **name · model**.

| Client | Status |
|---|---|
| Claude Desktop | The setup writes its entry |
| Claude Code | Tested 2026-10-16 ([`reports/phase8.5/clients.md`](reports/phase8.5/clients.md)) |
| OpenCode | Tested 2026-10-16 (same report) |
| Hermes Agent | Tested 2026-10-16 (same report) |
| Antigravity CLI | Tested 2026-10-16 (same report) |
| Codex CLI | Inferred, not tested |

The tests ran against the engine built from this repository, not the installed one [handle: `docs/reports/phase8.5/clients.md:37`, `npm run deck:build` then `engine\dist\devtools\clients-check-cli.js`]. That the installed paths work the same is [inference]: it is the same `main.js` started by another `node.exe`.

**Add the entry before the first edit.** Without it the client has no LrC-AVG tools, and the AI may go looking for the engine on disk instead: on 2026-10-16 Antigravity ran the engine's files directly and OpenCode wrote its own MCP client for them, both from the source folder on the development PC [handle: OpenCode session `ses_ebb672f73ffeZ0SEbaG7NU9115`, `opencode session export`; Antigravity transcript `%USERPROFILE%\.gemini\antigravity-cli\brain\e8187652-…\.system_generated\logs\transcript.jsonl`]. If the AI starts reading folders or writing scripts when you ask for an edit, stop it and check the entry.

Start the client again after you change its configuration [inference: the clients below read their MCP configuration when they start].

**A smaller tool list.** For a model that struggles with LrC-AVG's 62 tools, set the environment variable `LRC_AVG_TOOLS` to `edit` in the entry (in JSON: `"env": { "LRC_AVG_TOOLS": "edit" }`; with `claude mcp add`: `-e LRC_AVG_TOOLS=edit`). The engine then lists only the 14 tools of an edit ([README "Tool profiles"](../README.md#tool-profiles)) [handle: `engine/src/mcp/profiles.ts`; `engine/tests/tool-profiles.test.ts`]. That each client below passes the variable on is [unverified]; `lr_help` names the profile in force (`tool_profile`).

## Claude Code

For every project of this Windows account, in PowerShell:

```powershell
claude mcp add --scope user lrc-avg -- `
  "$env:LOCALAPPDATA\LrC-AVG\resources\node\node.exe" `
  "$env:LOCALAPPDATA\LrC-AVG\resources\engine\dist\mcp\main.js"
```

Or, for one project, a `.mcp.json` in its folder:

```json
{ "mcpServers": { "lrc-avg": { "command": "<node>", "args": ["<main.js>"] } } }
```

[handle: https://code.claude.com/docs/en/mcp, read 2026-10-15]

## OpenCode

OpenCode 2.x, in `%USERPROFILE%\.config\opencode\opencode.jsonc` [handle: `opencode debug config` lists that file, OpenCode 2.0.30, 2026-10-16]. OpenCode allows most tools without asking by default [handle: https://opencode.ai/docs/permissions/, read 2026-10-16], so the entry below also makes it ask before anything except LrC-AVG's own tools:

```json
{
  "permission": { "*": "ask", "lrc-avg_*": "allow" },
  "mcp": { "servers": { "lrc-avg": { "type": "local", "command": ["<node>", "<main.js>"] } } }
}
```

`opencode mcp list` should then show `✓ lrc-avg  connected` [handle: run from `%USERPROFILE%\Documents`, 2026-10-16]. Whether `lrc-avg_*` matches the names OpenCode gives LrC-AVG's tools is [unverified]: if OpenCode asks before every `lr_` call, it does not. OpenCode 1.x took `mcp.lrc-avg` without `servers`; 2.x still reads that form but marks it deprecated [handle: https://opencode.ai/config.json, read 2026-10-16].

OpenCode 2 runs its sessions in a background service, so an edit can go on after you close the OpenCode window [stated: Jim, 2026-10-16]. To stop it, run `opencode service stop`. `opencode --standalone` runs a private server instead of the background service [handle: `opencode --help`, 2.0.30]; whether that ends the edit when the window closes is [unverified].

## Hermes Agent

In `%LOCALAPPDATA%\hermes\config.yaml` [handle: https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp, read 2026-10-15]:

```yaml
mcp_servers:
  lrc_avg:
    command: '<node>'
    args: ['<main.js>']
```

## Antigravity CLI

In `%USERPROFILE%\.gemini\config\mcp_config.json` [handle: https://antigravity.google/docs/mcp?tab=cli, read 2026-10-15]:

```json
{ "mcpServers": { "lrc-avg": { "command": "<node>", "args": ["<main.js>"] } } }
```

## Codex CLI

Inferred, not tested [stated: Jim, 2026-10-15, "I do not have Codex or ChatGPT … these will have to be inferred"]. In `%USERPROFILE%\.codex\config.toml`. Codex gives a tool call 60 s by default; `tool_timeout_sec` raises it, and whether LrC-AVG needs more is [unverified] [handle: https://learn.chatgpt.com/docs/extend/mcp?surface=cli, read 2026-10-15]:

```toml
[mcp_servers.lrc_avg]
command = '<node>'
args = ['<main.js>']
tool_timeout_sec = 120
```

## Uninstalling

The LrC-AVG uninstaller removes only Claude Desktop's entry [handle: `hud/src-tauri/windows/hooks.nsh:133-145`, `setup-cli --remove`]. Delete the entries above from the other clients yourself; with LrC-AVG gone, they point at files that no longer exist.

## A development build

To point a client at an engine built from this repository instead, use your Node.js and the repo's `engine\dist\mcp\main.js`; see [`DEVELOPMENT.md`](DEVELOPMENT.md).
