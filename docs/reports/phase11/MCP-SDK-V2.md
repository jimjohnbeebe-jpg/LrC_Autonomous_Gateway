---
report: MCP SDK v2 (issue #208)
phase: 11
status: template
authored_by: "Template + pre-run findings: Claude Code (Opus 5.5 coordinating, Sonnet 5.5 and Haiku 5.5 subagents), 2026-10-26. Observed: Jim (empty)."
date: 2026-10-26 (template)
---

# MCP SDK v2 — the engine on `@modelcontextprotocol/server` 2.4.0

## Purpose

Does the engine, moved from `@modelcontextprotocol/sdk` 1.32.0 to `@modelcontextprotocol/server` 2.4.0, still work in Claude Desktop: the engine starts, the tools are listed, and one tool call returns an image? Issue #208, acceptance line 4; the earlier check of the same thing is `docs\reports\phase0\S3.md`.
PHASES.md rule (Phase 11): "#208's acceptance lines checked."

## Harness

No new harness: the engine Claude Desktop already starts (`npm run desktop:install`, `engine\dist\mcp\main.js`), its start record `%LOCALAPPDATA%\LrC-AVG\last-start.json` (`engine\src\log\last-start.ts`) and its tool log (`%LOCALAPPDATA%\LrC-AVG\logs`, CLAUDE.md "Commands"). Claude Code reads both after Jim's chat.

### Steps for Jim (after the PR is merged and Claude Code says `main` is built)

1. Quit Claude Desktop: right-click the Claude icon in the Windows system tray > **Quit**. Start Claude Desktop again.
2. In Lightroom Classic, select one photo in the Library grid.
3. In a new Claude Desktop chat, type: **Use lrc-avg to show me a preview of the selected photo.** Allow the tool when Claude Desktop asks.
4. Tell Claude Code **"SDK v2 check done"** and whether the photo's preview was shown in the chat (**yes** or **no**).

### If something goes wrong

- **Claude Desktop shows "lrc-avg" as failed or disconnected** (Settings > Developer): tell Claude Code; do not edit the config.
- **Claude answers that no tool is available:** tell Claude Code.

## Pre-run findings (Claude Code)

1. **The tool list is unchanged.** `engine\tests\mcp-tools-list.test.ts` pins the whole `tools/list` result (37 tools: names, titles, descriptions, input schemas, annotations), taken on SDK 1.32.0 in commit `36cd999` before the upgrade; it passes unchanged on 2.4.0 [handle: `npx vitest run tests/mcp-tools-list.test.ts` in `engine\`, 1 passed; the migration commit `13b4700` does not touch `engine\tests\__snapshots__\tools-list.json`].
2. **The official codemod** `@modelcontextprotocol/codemod@2.4.0 v1-to-v2` made 30 changes in 13 files and left no `@mcp-codemod-error` marker [handle: migration subagent's run, 2026-10-26; `grep -rn '@mcp-codemod-error' engine` empty at `13b4700`]. It removed `@modelcontextprotocol/sdk` from `engine\package.json`; it was put back as a dev dependency for test 4.
3. **Cancellation and progress through MCP:** `engine\tests\mcp-cancel.test.ts` shows a client abort reaching the signal `deadline()` gets, no response sent for the cancelled call, a progress notification before it, and the next calls served (the identical call gets the kept result) [handle: 17 of 17 repeat runs passed, subagent report for `33e98a1`].
4. **A v1 client still works:** `engine\tests\mcp-v1-client.test.ts` connects the SDK 1.32.0 `Client` to the v2 server in memory: initialize, the same 37 tool names, `lr_help`, and an `UNKNOWN_TOOL` error result.
5. **The setup bundles 9 npm packages instead of 100** (`engine\tests\setup-bundle.test.ts`); the v1 SDK's express, hono, ajv and jose are gone. The v2 packages are Apache-2.0, the v1 SDK was MIT (`docs\DEPENDENCIES.md`); the setup's notices are generated from `node_modules` at build time (`tools\setup\notices.ts`).
6. **Checks on the branch** at `33e98a1`, 2026-10-26: `npm run build`, `npm run typecheck`, `npm run arch:check` clean; `npm test` 165 of 167 files passed, 1770 tests passed, 9 skipped. The 2 failures, `tests/s14-check.test.ts` and `tests/session-ai-wait-note.test.ts`, then passed 3 of 3 runs alone (16 of 16 tests each time) [handle: `npx vitest run tests/s14-check.test.ts tests/session-ai-wait-note.test.ts` in `engine\`]. Another worktree's full suite was running at the same time, so load timing is the likely cause [inference]; neither test touches `engine\src\mcp\`.

## Observed (Jim)

- Preview shown in the Claude Desktop chat (yes/no):
- Collected by Claude Code after the chat: `last-start.json` engine version and client; the tool log line of the call.

## Numbers

| Field | Value |
|---|---|
| Engine version in `last-start.json` | |
| Client in `last-start.json` | |
| Tool called, result `ok` | |
| Image block in the result | |

## Verdict

(Jim)

## Consequences / open questions

- `serveStdio` and the 2026-07-28 protocol revision are not adopted [stated: Jim, 2026-10-26, decision 2 of the #208/#209 plan]; which revision Claude Desktop speaks is [unverified].
- SDK 2.4.0 marks the low-level `Server` `@deprecated`; the engine keeps it for its own argument errors (`engine\src\mcp\server.ts` header).
- `spikes\` stays on SDK 1.32.0 [stated: Jim, 2026-10-26, decision 4].
