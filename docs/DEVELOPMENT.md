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
| `plugin/spec/` | busted specs of the plugin's Lua, run outside Lightroom ("Lua lint and specs" below) |
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

Use this instead of the README's setup, not next to it: both write the same Claude Desktop entry, `lrc-avg`, and the last one run wins [handle: `engine/src/setup/desktop-config.ts:4-7, 22` `SERVER_NAME`]. The repo's plugin is **LrC-AVG (dev)**, `com.lrcavg.gateway.dev`; the setup stages it as `com.lrcavg.gateway` [handle: `plugin/LrC-AVG.lrplugin/Info.lua:28-29`, `tools/setup/plugin-id.ts`]. To test the setup on a development PC, use the clean room (`npm run cleanroom -- --park`, then `--restore`; see `CLAUDE.md` "Commands").

1. **Plugin:** in Lightroom, **File > Plug-in Manager > Add**, and choose this repo's `plugin\LrC-AVG.lrplugin` folder. Never copy it into Lightroom's `Modules` folder.
2. **Engine:** `npm run desktop:install`. It builds the engine and points the `lrc-avg` entry at this repo's `engine\dist\mcp\main.js`, with `LRC_AVG_LOG_DIR` set to the repo's `logs\` folder [handle: `engine/src/devtools/install-desktop-config-cli.ts:31`], so the dev Claude Desktop sessions log there. The other clients' entries ([`CLIENTS.md`](CLIENTS.md)) set no `LRC_AVG_LOG_DIR`, so their engines log to the default folder, `%LOCALAPPDATA%\LrC-AVG\logs`, or the settings page's Log folder [handle: `engine/src/settings/folders.ts` `log()`]. Then quit Claude Desktop from its tray icon and start it again.
3. After each `npm run build`, restart Claude Desktop to run the new engine; after a plugin change, restart Lightroom. Claude Desktop starts the engine and keeps it running [handle: `engine/src/mcp/main.ts:6-10`]; that a running engine does not pick up a rebuilt `dist` is [inference] (Node loads the modules once).

Development overrides are read from `LRC_AVG_*` environment variables: the ports and token file in `engine/src/mcp/dev-overrides.ts`, the folders in `engine/src/settings/folders.ts` and `engine/src/presets/folder.ts`. The Deck's executable (Phase 7) is `LRC_AVG_HUD_EXE` (`engine/src/hud/launch.ts`).

## Lua lint and specs

The plugin's Lua has its own gate (issue #213): selene lints `plugin/LrC-AVG.lrplugin/` with `selene.toml` and the Lightroom globals in `lightroom.yml`, and busted runs the specs in `plugin/spec/` (`.busted`). The CI workflow `.github/workflows/lua.yml` runs both on Ubuntu, Lua 5.1, on every pull request that touches `plugin/`. Pinned versions: [`DEPENDENCIES.md`](DEPENDENCIES.md) "Lua tooling".

```powershell
npm run lua:lint     # selene; says where to get it when selene.exe is not on PATH
npm run lua:test     # busted; says so when it is not on PATH (CI runs it)
```

- **selene on Windows** is one file: download `selene-0.32.0-windows.zip` from https://github.com/Kampfkarren/selene/releases/tag/0.32.0, unzip `selene.exe` into a folder on your `PATH` (for example `$env:USERPROFILE\bin`), and check with `selene --version` (it prints `selene 0.32.0`). With it on PATH, `npm run lua:lint` printed `0 errors`, `0 warnings` [handle: `npm run lua:lint` on branch `phase-11/lua-quality-gate`, 2026-10-28].
- **busted on Windows** needs Lua 5.1 and LuaRocks, and LuaRocks builds busted's C module (luasystem) with a C compiler. That set-up was not tried on a Windows PC [unverified], so the specs run in CI for now. Where Lua 5.1 and LuaRocks are installed: `luarocks --lua-version=5.1 install busted 2.3.0-1`, then `npm run lua:test` from the repo root.
- A spec loads a plugin module outside Lightroom: `plugin/spec/spec_helper.lua` stubs `import` (each SDK namespace is an empty table the spec fills) and `LrTasks.pcall`, and `helper.load(name, stubs)` loads a module with stand-ins for the modules it requires. The specs cover `Json.lua`, the path helpers of `KeywordTree.lua`, `Pending.lua` and `Dispatch.handleLine`.

## Live checks on a throwaway catalog

The checks that write to photos (`masks:carry`, `masks:combine`, `masks:kinds`, `masks:crop`, `masks:verify`, `masks:parity`, `denoise:check`, `phase2:check` to `phase5:check`, `phase8:check`) refuse to run unless the catalog open in Lightroom is marked as a throwaway one (issue #213). Mark it once with `npm run catalog:throwaway`: it shows the open catalog's path, asks y/n, and writes `lrc-avg-throwaway.json` beside the `.lrcat`. To run a check on an unmarked catalog anyway, add `-- --i-know` (`npm run masks:verify -- --i-know`). The path comes from the plugin's hello (`catalog:getPath()`, `plugin/LrC-AVG.lrplugin/Bridge.lua`), so a plugin loaded before this change is refused until it is reloaded. Report: [`reports/phase11/THROWAWAY.md`](reports/phase11/THROWAWAY.md).

## Packaging

### The setup

```powershell
npm run setup:build
```

builds the unsigned `release\LrC-AVG-Setup-<version>.exe` and `release\SHA256SUMS.txt`: a clean engine build, the pinned Node.js (`tools/setup/node-pin.json`, each download checked by SHA-256), the engine with its production packages from the lockfile, the plugin, the notices, then the Tauri NSIS build with `hud/src-tauri/tauri.setup.conf.json` [handle: `tools/setup/build.ts:1-13`]. It needs Rust (rustup, MSVC) as `npm run deck:build` does. `-- --version 0.99.0` makes a test build under another version.

### A release

[`.github/workflows/release.yml`](../.github/workflows/release.yml) builds the same setup on GitHub's Windows runner. A tag `v<version>` (or `v<version>-rc.<n>`, a pre-release) that matches `engine/package.json` attaches the setup and `SHA256SUMS.txt` to a draft release, which is then published by hand. A pull request that changes `tools/setup/`, `hud/src-tauri/`, the lockfile or the workflow builds the setup without releasing it; its run keeps the files as the `setup` artifact. The setup is not signed: README "Why the setup is not signed", issue #171.

### The npm package and the plugin zip

```powershell
npm run package
```

writes the two release assets to `release\`: `lrc-avg-<version>.tgz` (the engine, its file list checked against `engine/src`) and `LrC-AVG.lrplugin-<version>.zip` (the plugin folder plus `LICENSE`). It packs the working tree [handle: `engine/src/devtools/package-cli.ts:11`], so build release assets from a clean checkout of the tagged commit. These two assets are not part of a release since the setup (Phase 9); installing from npm is issue #172. The package smoke test is `docs/reports/phase6/package-smoke/smoke.txt`.

## Other commands

| Command | What it does |
|---|---|
| `npm run schemas` | Regenerates `engine\schemas\*.schema.json` from the zod schemas (a test fails when they are stale) |
| `npm run preset:capture` | Copies Lightroom's own reference preset and its photo's settings into `engine\tests\fixtures\presets\` (`--precheck`; `--second` for the second raw reference; `--rendered` and `--rendered-mono` for the two JPEG references, `docs\reports\phase8\presets-rendered.md`) |
| `npm run preset:pin` | Regenerates `engine\src\params\preset-format.lrc15.json` from those references (a test fails when it is stale) |
| `npm run goldens` | After a Phase 3 check: golden JPEGs to `tests\golden\` (gitignored) and `golden.json` (committed) |
| `npm run phase1:check` … `npm run phase5:check`, `npm run wb:check`, `npm run offline:check`, `npm run phase8:check` | The acceptance checks against Lightroom (and Claude Desktop from Phase 2 on). Each one's steps and results are in its report under `docs\reports\` |
| `npm run clients:probe` | Issue #155 R5: each installed AI client CLI (Claude Code, OpenCode, Hermes, Antigravity, Codex) started headless against the built engine and the Lightroom simulator, no Lightroom; run by Claude Code (`docs\reports\phase8.5\clients-probe.md`) |
| `npm run clients:check` | Issue #155 R6: builds the Deck, then every installed client CLI (not Codex) edits the selected photo in Lightroom, T2-T7 with Jim's y/n, plus one Claude Desktop chat; resumes after a stop (`-- --new` starts over) (`docs\reports\phase8.5\clients.md`) |
| `npm run develop:check` | Issue #214: the Develop parity tools (Auto, Reset, process version, snapshots, virtual copies, `lr_get_metadata raw`) on two raw virtual copies selected in Library (`docs\reports\phase11\DEVELOP-PARITY.md`) |
| `npm run presets:check` | Issue #215: the six Develop preset tools on one selected virtual copy (`docs\reports\phase11\PRESET-PARITY.md`) |
| `npm run stats:check` | Issue #216: `lr_get_photo_stats` on 2-20 selected photos, fast against exact previews (`docs\reports\phase11\METRICS-PARITY.md`) |
| `npm run catalog:check` | Issue #218: the new catalog and metadata tools on one photo in a throwaway or copied catalog (`docs\reports\phase11\CATALOG-PARITY.md`) |
| `npm run catalog:throwaway` | Issue #213: marks the open catalog as a throwaway one, so the live checks run on it ("Live checks on a throwaway catalog" above; `docs\reports\phase11\THROWAWAY.md`) |
| `npm run lua:lint`, `npm run lua:test` | Issue #213: selene and busted on the plugin's Lua ("Lua lint and specs" above) |
| `npm run perf:check` | Issue #212: read-only timings of the catalog reads, p50/p95; `-- --label baseline` before the speed-up, `-- --label after` after it (`docs\reports\phase11\PERF.md`) |
| `npm test` (`engine\tests\parity-map.test.ts`) | Issue #220: [`PARITY.md`](PARITY.md) has a row for every pinned upstream tool and names every registered `lr_*` tool; renewing the pin: [`UPSTREAM_SYNC.md`](UPSTREAM_SYNC.md) |
| `node spikes\S1\measure.ts` | Spike scripts run directly (Node type stripping) |
| `node engine\dist\mcp\main.js` | The stdio MCP server, as Claude Desktop starts it |

The Lightroom checks of epic #207 parity batch 1, in the order Jim runs them: [`reports/phase11/PARITY-BATCH1-CHECKS.md`](reports/phase11/PARITY-BATCH1-CHECKS.md). `npm run package` also writes `release\lrc-avg-<version>.mcpb` (issue #219, `docs\reports\phase11\DISTRIBUTION.md`).

## Workflow

Every change reaches `main` through a pull request from a `phase-<n>/<topic>` or `fix/<topic>` branch, reviewed by Greptile (CodeRabbit from 2026-10-03 to 2026-10-04), with every finding triaged in a table on the PR before the merge. The full rule is [`.claude/rules/04-workflow.md`](../.claude/rules/04-workflow.md); a summary is [`REVIEW_WORKFLOW.md`](REVIEW_WORKFLOW.md). Source files are kept to 300 lines (400 enforced by `engine/tests/module-size.test.ts`), as rule 01 sets out.
