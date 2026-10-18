# LrC-AVG — Lightroom Classic Autonomous Vision Gateway

LrC-AVG is a Lightroom Classic (Windows) plugin written in Lua, plus a Node.js/TypeScript MCP server (the "engine"). Together they let Claude, running in Claude Desktop, edit raw photos iteratively using only native Develop settings: apply an adjustment, render a preview, measure it, look at it, refine, up to a pass cap and within guardrails. The engine does the deterministic work (metrics with `sharp`, session state, guardrails, provenance logs); Claude's vision does the aesthetic judgement. Every edit is non-destructive, shows on the Develop sliders, and is reversible through History and Snapshots. The engine is a fork of Automaat/lightroom-mcp, vendored read-only under `vendor\automaat\`.

## Spec set (Obsidian vault — the source of truth)

Vault folder: `C:\Users\jimbe\Documents\Obsidian Vault\Projects\LrC_Autonomous_Gateway\`

- `C:\Users\jimbe\Documents\Obsidian Vault\Projects\LrC_Autonomous_Gateway\LrC_AVG_CONTEXT.md` — what/why, decisions summary, environment
- `C:\Users\jimbe\Documents\Obsidian Vault\Projects\LrC_Autonomous_Gateway\LrC_AVG_STATE.md` — current status and next action
- `C:\Users\jimbe\Documents\Obsidian Vault\Projects\LrC_Autonomous_Gateway\PRD.md` — requirements (v1.1)
- `C:\Users\jimbe\Documents\Obsidian Vault\Projects\LrC_Autonomous_Gateway\ARCHITECTURE.md` — topology, bridge protocol, state machine
- `C:\Users\jimbe\Documents\Obsidian Vault\Projects\LrC_Autonomous_Gateway\MCP_TOOLS.md` — tool contracts, intent and log schemas
- `C:\Users\jimbe\Documents\Obsidian Vault\Projects\LrC_Autonomous_Gateway\LR_SDK_NOTES.md` — SDK facts with handles, potholes
- `C:\Users\jimbe\Documents\Obsidian Vault\Projects\LrC_Autonomous_Gateway\PHASES.md` — phases and acceptance
- `C:\Users\jimbe\Documents\Obsidian Vault\Projects\LrC_Autonomous_Gateway\CLAUDE_CODE_LAUNCH.md` — the Phase 0 directive
- Decisions, `C:\Users\jimbe\Documents\Obsidian Vault\Projects\LrC_Autonomous_Gateway\DECISIONS\`:
  `AVG-001-fork-automaat-no-python.md`, `AVG-002-claude-desktop-runtime-client.md`, `AVG-003-claude-orchestrated-step-loop.md`, `AVG-004-lrsocket-transport-http-fallback.md`, `AVG-005-snapshots-for-rollback.md`, `AVG-006-settings-in-plugin-manager-autonomous-default.md`, `AVG-007-intent-library-local-install.md`, `AVG-008-variants-mode-three-copies-v1.md`, `AVG-009-guardrail-and-convergence-defaults.md`, `AVG-010-camera-profile-pass-zero.md`, `AVG-011-provenance-logs.md`
- Reports: `C:\Users\jimbe\Documents\Obsidian Vault\Projects\LrC_Autonomous_Gateway\Reports\` (mirrored in `docs\reports\`)

Repo-side records: `docs\PHASE0_HANDOVER.md` (start here in a fresh session), `docs\AUTOMAAT_SURVEY.md`, `docs\MCP_AVAILABILITY.md`, `docs\DEPENDENCIES.md`, `docs\DEVELOPMENT.md` (developer instructions; the root `README.md` is the user guide).

## Rules (details in `.claude\rules\`)

- **Stack rule.** Lua for the plugin, Node ≥ 22 / TypeScript for the engine, Rust for the HUD shell only (Phase 7, Tauri). **No Python anywhere, including tooling scripts.** `sharp` does all image work. → `.claude\rules\01-stack.md`
- **Sourcing rule.** Every claim about SDK or runtime behaviour, in reports and in commit messages, carries a handle (script path + observed output, screenshot path, or URL) or is tagged `[unverified]`. Do not write results you did not observe. → `.claude\rules\02-sourcing.md`
- **Interaction rule.** Jim sets direction. When a decision is needed, present the options with a recommendation and stop. Never proceed past a STOP marker. → `.claude\rules\04-workflow.md`
- **Every change reaches `main` through a reviewer-triaged pull request** (reviewer: Greptile, `greptile.json`). Branch `phase-<n>/<topic>` or `fix/<topic>`, never commit to `main`, triage every finding in a PR-comment table, merge only with `arch-check` green. → `.claude\rules\04-workflow.md`
- **Read `LR_SDK_NOTES.md` before touching Lua.** → `.claude\rules\03-lightroom.md`
- **Query Graphify before grepping for structural questions.** The per-repo graph exists: run `graphify query "<question>"` (or `graphify path "A" "B"`, `graphify explain "X"`) from the repo root. After code changes, refresh it with `graphify update .`. Graph answers point you at code; they are not sourced facts. See `docs\MCP_AVAILABILITY.md`.
- **Lightroom-side results are Jim's observations: ask, do not assume.** Claude Code writes harnesses and report templates; Jim runs Lightroom and fills in the "Observed" sections.
- `vendor\automaat\` is a read-only upstream snapshot (MIT, commit `a160e7a`). Never modify it. Its `CLAUDE.md`/`AGENTS.md` are upstream's contributor notes and **do not apply to this project**.

## Module Map

The TS core is `engine\src`; each top-level folder is a module. `npm run arch:check` (dependency-cruiser, `.dependency-cruiser.cjs`, run in CI on every PR to `main`) fails any import that this table does not allow, any file-level import cycle, any `enginesrc` folder or file this table does not name, and any edit to this table that its `MODULES` does not match. `npm run arch:graph` redraws `docs\architecture\modules.md`. The table was taken from the imports as they stood on 2026-10-12 [handle: the PR for issue #148, "Survey" section]. "May import" lists other modules; a module may always import its own files, Node built-ins and npm packages. `mcp/errors` is the one file of `mcp` that other modules may import (`ToolError`).

| Module | Responsibility | May import |
|---|---|---|
| `bridge` | The engine <-> Lightroom plugin link: client, endpoint, protocol schemas | — |
| `params` | The pinned LrC 15.5.1 key and preset files and the canonical parameter map | — |
| `metrics` | Measurements of rendered JPEGs (sharp) | — |
| `log` | Provenance logs | — |
| `setup` | `lrc-avg-setup`: writes the Claude Desktop config | — |
| `intents` | The intent library | `params` |
| `preview` | Rendered previews and their files | `bridge`, `metrics` |
| `settings` | The Plug-in Manager values and their precedence for a session | `bridge`, `intents`, `log`, `session` |
| `library` | The catalog tools kept from Automaat | `bridge`, `mcp/errors`, `preview`, `sync` |
| `sync` | `lr_sync_series` | `bridge`, `library`, `log`, `mcp/errors`, `params`, `preview`, `session` |
| `presets` | Develop presets from the selected photo | `bridge`, `mcp/errors`, `params`, `sync` |
| `session` | The edit session: begin/step/end, passes, guardrails, masks, copies, approval | `bridge`, `intents`, `log`, `mcp/errors`, `metrics`, `params`, `preview`, `settings` |
| `hud` | The HUD channel and the Deck | `bridge`, `log`, `mcp/errors`, `params`, `session` |
| `mcp` | The stdio MCP server: tool definitions and handlers, `ToolError` | `bridge`, `hud`, `intents`, `library`, `log`, `metrics`, `params`, `presets`, `preview`, `session`, `settings`, `sync` |
| `devtools` | The `npm run *:check` and probe harnesses (not in the npm package); imported by nothing | `bridge`, `hud`, `intents`, `library`, `log`, `mcp`, `metrics`, `params`, `presets`, `preview`, `session`, `settings`, `setup`, `sync` |

Standing rules:

- **(a) A new top-level module or a new cross-module edge is Jim's decision; then it updates this table and `MODULES` in `.dependency-cruiser.cjs` in the same PR** (and `npm run arch:graph`), and the PR description lists the edge under "Module Map changes" (`.claude\rules\04-workflow.md`, "STOP markers and decisions"). The baseline `.dependency-cruiser-known-violations.json` holds the file cycles that existed on 2026-10-12. Never add to it; after fixing one, shrink it with `npx depcruise engine/src --config .dependency-cruiser.cjs --baseline --baseline-mode shrink-only`.
- **(b) The Lua plugin is a thin adapter.** It relays requests and results between Lightroom and the TS core; decision logic (what to change, by how much, when to stop) lives in TS.

## Commands (PowerShell, repo root)

The Lightroom / Claude Desktop acceptance checks, probes, Deck and setup commands (`npm run phase<n>:check`, `deck:*`, `masks:*`, `setup:*`, `cleanroom`, …) and their prerequisites are in the `lrc-avg-checks` skill (`.claude\skills\lrc-avg-checks\SKILL.md`).

```powershell
npm install                 # installs engine + spikes + hud workspaces
npm run build               # tsc -> engine\dist
npm test                    # vitest (engine)
npm test -w hud             # vitest (hud\ui) + cargo test (hud\src-tauri; rustup MSVC needed)
npm run typecheck           # engine src+tests, spikes, hud
npm run arch:check          # module boundaries + no import cycles in engine\src (see "Module Map"; CI runs it on every PR)
npm run arch:graph          # redraw docs\architecture\modules.md (Mermaid, one node per module)
npm run schemas             # regenerate engine\schemas\*.schema.json from the zod schemas (a test fails when stale)
npm run desktop:install     # register the engine in Claude Desktop as lrc-avg (backup first; removes lrc-avg-spike-s3)
npm run package             # release assets to release\ (gitignored): lrc-avg-<v>.tgz (file list checked) + LrC-AVG.lrplugin-<v>.zip
node engine\dist\mcp\main.js # the stdio MCP server (Claude Desktop starts it; tool log in $env:LRC_AVG_LOG_DIR or %LOCALAPPDATA%\LrC-AVG\logs)
graphify query "How does X reach Y?"
```

## PowerShell conventions

- Jim's shell is PowerShell in VS Code. Write every user-facing command as PowerShell with Windows-native paths (`D:\Developer\...`, `$env:TEMP`, `$env:APPDATA`). Put long commands on several lines with backtick (`` ` ``) continuation.
- Quote any path that contains spaces (`"C:\Users\jimbe\Documents\Obsidian Vault\..."`, `"...DxO_DeepPRIME XD3.dng"`).
- Lightroom plugin and spike output goes to `$env:TEMP\LrC-AVG\` (Lua `LrPathUtils.getStandardFilePath("temp")` is `%TEMP%` [handle: `docs\reports\phase1\PHASE1.md` "Consequences", `plugin_log_copied` in the Phase 1 run files; LR_SDK_NOTES "Recorded in Phase 1"]). Engine previews pass through `$env:TEMP\LrC-AVG\previews\`.
- Lightroom plugins are added through File > Plug-in Manager > Add, pointing at the `.lrplugin` folder in this repo. Never copy them into `%APPDATA%\Adobe\Lightroom\Modules` automatically.
