# Developing LrC-AVG

For working on LrC-AVG from this repository. To install and use it, see the [README](../README.md).

The project is built with Claude Code. Its rules are in [`CLAUDE.md`](../CLAUDE.md) and [`.claude/rules/`](../.claude/rules/): the stack (01), sourcing (02), Lightroom and the SDK (03), and the workflow (04). The specs (PRD, architecture, tool contracts, phase plans) are kept outside the repository; the reports here in `docs/reports/` are their public record.

## Architecture

```
Claude Desktop ──stdio MCP──► lrc-avg engine (Node/TS) ──LrSocket (127.0.0.1)──► Lightroom Classic plugin (Lua)
                                 metrics (sharp), session state,                 applyDevelopSettings, previews,
                                 guardrails, intents, provenance logs            snapshots, virtual copies, HUD
```

The loop is Claude-orchestrated (`lr_begin_session` → `lr_step` … → `lr_end_session`); the engine is a stateful step function that enforces a pass cap, step decay and clipping guardrails itself. The engine is a fork of [Automaat/lightroom-mcp](https://github.com/Automaat/lightroom-mcp), vendored read-only under `vendor/automaat/` (see the README's NOTICE).

## Repository layout

| Path | Contents |
|---|---|
| `engine/` | Node/TS MCP server: `src/` (strict ESM TypeScript), `tests/` (vitest), `intents/` (the bundled intents), `schemas/` (generated JSON Schemas) |
| `engine/src/devtools/` | Check harnesses and build scripts; not in the package |
| `engine/src/setup/` | `lrc-avg-setup`, which writes the Claude Desktop entry |
| `plugin/LrC-AVG.lrplugin/` | The Lightroom plugin (Lua) |
| `plugin/spikes/`, `spikes/` | Phase 0-5 spike plugins and scripts (throwaway) |
| `docs/` | Reports (`reports/<phase>/`), the Automaat survey, environment and dependency records, the Phase 0 handover |
| `vendor/automaat/` | Upstream reference snapshot (read-only) |
| `fixtures/`, `logs/`, `release/`, `tests/golden/*.jpg` | Test photos, development logs, packaged assets, golden renders: on disk only, gitignored |

## Requirements

Windows 10 or 11, Lightroom Classic 15.5.1, Node.js 22 or newer (developed on 24.11.1). No Python anywhere in the project, tooling included (rule 01).

## Build and test

In PowerShell, from the repo root:

```powershell
npm install          # engine + spikes workspaces
npm run build        # tsc -> engine\dist
npm test             # vitest
npm run typecheck    # engine src + tests, spikes
```

All four pass before every commit (rule 04).

## Development install

Use this instead of the README's install, not next to it: both write the same Claude Desktop entry, `lrc-avg`, and the last command run wins [handle: `engine/src/setup/desktop-config.ts:4-7, 22` `SERVER_NAME`].

1. **Plugin:** in Lightroom, **File > Plug-in Manager > Add**, and choose this repo's `plugin\LrC-AVG.lrplugin` folder. Never copy it into Lightroom's `Modules` folder.
2. **Engine:** `npm run desktop:install`. It builds the engine and points the `lrc-avg` entry at this repo's `engine\dist\mcp\main.js`, with `LRC_AVG_LOG_DIR` set to the repo's `logs\` folder. Then quit Claude Desktop from its tray icon and start it again.
3. After each `npm run build`, restart Claude Desktop to run the new engine; after a plugin change, restart Lightroom. Claude Desktop starts the engine and keeps it running [handle: `engine/src/mcp/main.ts:6-10`]; that a running engine does not pick up a rebuilt `dist` is [inference] (Node loads the modules once).

Development overrides are read from `LRC_AVG_*` environment variables: the ports and token file in `engine/src/mcp/dev-overrides.ts`, the folders in `engine/src/settings/folders.ts` and `engine/src/presets/folder.ts`. The Deck's executable (Phase 7) is `LRC_AVG_HUD_EXE` (`engine/src/hud/launch.ts`).

## Packaging

```powershell
npm run package
```

writes the two release assets to `release\`: `lrc-avg-<version>.tgz` (the engine, its file list checked against `engine/src`) and `LrC-AVG.lrplugin-<version>.zip` (the plugin folder plus `LICENSE`). It packs the working tree [handle: `engine/src/devtools/package-cli.ts:11`], so build release assets from a clean checkout of the tagged commit. The install it makes is described in the README; the package smoke test is `docs/reports/phase6/package-smoke/smoke.txt`.

## Other commands

| Command | What it does |
|---|---|
| `npm run schemas` | Regenerates `engine\schemas\*.schema.json` from the zod schemas (a test fails when they are stale) |
| `npm run preset:capture` | Copies Lightroom's own reference preset and its photo's settings into `engine\tests\fixtures\presets\` (`--precheck`; `--second` for the second raw reference; `--rendered` and `--rendered-mono` for the two JPEG references, `docs\reports\phase8\presets-rendered.md`) |
| `npm run preset:pin` | Regenerates `engine\src\params\preset-format.lrc15.json` from those references (a test fails when it is stale) |
| `npm run goldens` | After a Phase 3 check: golden JPEGs to `tests\golden\` (gitignored) and `golden.json` (committed) |
| `npm run phase1:check` … `npm run phase5:check`, `npm run wb:check`, `npm run offline:check`, `npm run phase8:check` | The acceptance checks against Lightroom (and Claude Desktop from Phase 2 on). Each one's steps and results are in its report under `docs\reports\` |
| `node spikes\S1\measure.ts` | Spike scripts run directly (Node type stripping) |
| `node engine\dist\mcp\main.js` | The stdio MCP server, as Claude Desktop starts it |

## Workflow

Every change reaches `main` through a pull request from a `phase-<n>/<topic>` or `fix/<topic>` branch, reviewed by CodeRabbit (Greptile until 2026-10-03), with every finding triaged in a table on the PR before the merge. The full rule is [`.claude/rules/04-workflow.md`](../.claude/rules/04-workflow.md); a summary is [`REVIEW_WORKFLOW.md`](REVIEW_WORKFLOW.md). Source files are kept to 300 lines (400 enforced by `engine/tests/module-size.test.ts`), as rule 01 sets out.
