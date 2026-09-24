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

Repo-side records: `docs\PHASE0_HANDOVER.md` (start here in a fresh session), `docs\AUTOMAAT_SURVEY.md`, `docs\MCP_AVAILABILITY.md`, `docs\DEPENDENCIES.md`.

## Rules (details in `.claude\rules\`)

- **Stack rule.** Lua for the plugin, Node ≥ 22 / TypeScript for the engine. **No Python anywhere, including tooling scripts.** `sharp` does all image work. → `.claude\rules\01-stack.md`
- **Sourcing rule.** Every claim about SDK or runtime behaviour, in reports and in commit messages, carries a handle (script path + observed output, screenshot path, or URL) or is tagged `[unverified]`. Do not write results you did not observe. → `.claude\rules\02-sourcing.md`
- **Interaction rule.** Jim sets direction. When a decision is needed, present the options with a recommendation and stop. Never proceed past a STOP marker. → `.claude\rules\04-workflow.md`
- **Read `LR_SDK_NOTES.md` before touching Lua.** → `.claude\rules\03-lightroom.md`
- **Query Graphify before grepping for structural questions.** The per-repo graph exists: run `graphify query "<question>"` (or `graphify path "A" "B"`, `graphify explain "X"`) from the repo root. After code changes, refresh it with `graphify update .`. Graph answers point you at code; they are not sourced facts. See `docs\MCP_AVAILABILITY.md`.
- **Lightroom-side results are Jim's observations: ask, do not assume.** Claude Code writes harnesses and report templates; Jim runs Lightroom and fills in the "Observed" sections.
- `vendor\automaat\` is a read-only upstream snapshot (MIT, commit `a160e7a`). Never modify it. Its `CLAUDE.md`/`AGENTS.md` are upstream's contributor notes and **do not apply to this project**.

## Layout

```
engine\                   Node/TS MCP server (src\{mcp,session,params,metrics,preview,intents,log,bridge}, tests\, intents\, schemas\)
plugin\LrC-AVG.lrplugin\  Lua plugin (Phase 0: Info.lua stub only)
plugin\spikes\S1-S6.lrplugin\  Phase 0 spike plugins (throwaway)
spikes\S1-S6\             Phase 0 spike READMEs + Node scripts (throwaway)
docs\                     survey, availability, dependencies, handover, reports\ (mirror of vault Reports\)
vendor\automaat\          upstream reference (read-only)
fixtures\                 NEF/DNG test images — on disk only, gitignored
logs\  tests\golden\      dev logs (gitignored) / golden JPEG renders (later phases)
```

## Commands (PowerShell, repo root)

```powershell
npm install                 # installs engine + spikes workspaces
npm run build               # tsc -> engine\dist
npm test                    # vitest (engine)
npm run typecheck           # engine src+tests, spikes
node spikes\S1\measure.ts   # spike scripts run directly (Node type stripping)
graphify query "How does X reach Y?"
```

## PowerShell conventions

- Jim's shell is PowerShell in VS Code. Write every user-facing command as PowerShell with Windows-native paths (`D:\Developer\...`, `$env:TEMP`, `$env:APPDATA`). Put long commands on several lines with backtick (`` ` ``) continuation.
- Quote any path that contains spaces (`"C:\Users\jimbe\Documents\Obsidian Vault\..."`, `"...DxO_DeepPRIME XD3.dng"`).
- Lightroom spike output goes to `$env:TEMP\LrC-AVG\` (Lua `LrPathUtils.getStandardFilePath("temp")`; that it matches `%TEMP%` is [unverified] until a spike runs).
- Lightroom plugins are added through File > Plug-in Manager > Add, pointing at the `.lrplugin` folder in this repo. Never copy them into `%APPDATA%\Adobe\Lightroom\Modules` automatically.
