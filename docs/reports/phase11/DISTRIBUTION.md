---
report: DISTRIBUTION
phase: "11"
status: template
authored_by: "Claude Code (purpose, build, tests, steps); Jim (the Claude Code run, Observed)"
date: 2026-10-27
---

# DISTRIBUTION: MCP prompts, the Claude Code plugin and the .mcpb bundle

## Purpose

GitHub issue #219 (epic #207). Three artefacts that need no decision from Jim on macOS (D4), tool profiles (D6) or D7; nothing is published (no npm publish, registry entry, release or tag).

1. **MCP prompts** (#166). The server answers `prompts/list` and `prompts/get` with two prompts: `lrc-avg-edit` (the standard request template, with an optional `request` argument) and `lrc-avg-help` (the `lr_help` text) [handle: `engine\src\mcp\prompts.ts`; `engine\tests\mcp-prompts.test.ts`, which uses the MCP client]. Shape after upstream's skill prompt [upstream claim: Automaat/lightroom-mcp `1040453`, `server/src/skill-prompt.ts`]. Whether Claude Code or Claude Desktop shows prompts to the user is `[unverified]`.
2. **Claude Code plugin**: `.claude-plugin\plugin.json` and `skills\lrc-avg\SKILL.md` at the repo root, so `claude --plugin-dir <repo>` loads the server and the skill. The server is declared inline in `plugin.json` (`mcpServers`), not in a root `.mcp.json`: Claude Code also reads a root `.mcp.json` as the project's own MCP config, where `${CLAUDE_PLUGIN_ROOT}` is not defined, so every Claude Code session in this repo would be offered a second engine [inference]. It starts `node ${CLAUDE_PLUGIN_ROOT}/engine/dist/mcp/main.js`, so the repo needs `npm run build` first. That the inline `mcpServers` entry loads and `${CLAUDE_PLUGIN_ROOT}` is expanded there is `[unverified]` (not run here).
3. **.mcpb bundle**: `npm run package` also writes `release\lrc-avg-<version>.mcpb` (gitignored): `manifest.json` plus `server\` (the engine package and its production `node_modules`). The manifest is built from the server's tool list at package time (`engine\src\devtools\mcpb-manifest.ts`); `npm run package` stops if the written manifest and the tool list differ, and a test compares the manifest with what a client sees in `tools/list`. The bundle copies nothing into Lightroom's folders: the plug-in is still added in the Plug-in Manager. The manifest field names follow the MCPB format version 0.3 from memory of the format, checked against no copy of the spec `[unverified]`.

## Smoke test run by Claude Code (2026-10-27)

`npm run package` built `lrc-avg-1.4.0.mcpb` (13,056,137 bytes, sha256 `83f2390eb6327a5ce9a935982f63d8616afab90e86b6f2a4926147d827671a91`) with 37 tools in the manifest [handle: the `npm run package` output in the building session]. The bundle was extracted to a temp folder and its `server\dist\mcp\main.js` started over stdio with Node 24.11.1: `initialize` answered `lrc-avg` 1.4.0 with the `prompts` capability, `tools/list` returned the same 37 names as the manifest, `prompts/list` returned `lrc-avg-edit,lrc-avg-help` [handle: a throwaway script in the session scratchpad, output as quoted; not committed]. Not tested: any tool call (sharp loading from the bundled `node_modules`), and Claude Desktop installing the bundle.

## Steps for Jim

### Claude Code plugin

1. In PowerShell, in `D:\Developer\LrC_Autonomous_Gateway`, build the engine:

   ```powershell
   npm run build
   ```

2. Start Claude Code with the repo as a plugin (open Lightroom with the LrC-AVG plug-in enabled and a photo selected first):

   ```powershell
   claude --plugin-dir D:\Developer\LrC_Autonomous_Gateway
   ```

3. Type `/mcp`. You should see `lrc-avg` listed as connected. Write down what it shows.
4. Type `/` and look for the `lrc-avg-edit` and `lrc-avg-help` prompts (Claude Code lists MCP prompts as slash commands) and for the `lrc-avg` skill. Write down which show.
5. Ask: `Call lr_help and tell me in one sentence what a session is.` You should see Claude call `lr_help`.
6. Type `/exit`.

If something goes wrong:

- If `lrc-avg` is not connected: check `engine\dist\mcp\main.js` exists (step 1). If your user config already has an `lrc-avg` server, remove that entry for this test and say so.
- If the server shows as failed: note the message `/mcp` gives.

### .mcpb bundle

7. In PowerShell, in the repo root: `npm run package`. You should see `mcpb bundle: manifest tools equal the server's tool list` and the `.mcpb` in the asset list.
8. Quit Claude Desktop, open it, and drag `release\lrc-avg-<version>.mcpb` onto Settings > Extensions (the install route is `[unverified]`; use whatever Claude Desktop offers for a .mcpb file). Write down whether it installs, whether the 61 tools show (37 before #207 batch 1, which added 24), and whether `lr_help` runs (Lightroom open, plug-in enabled). Remove the extension afterwards if you do not want two `lrc-avg` servers (the setup's entry and the extension).

## Observed

(Blank. Jim's runs.)

## Numbers

(Blank.)
