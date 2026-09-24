# LrC-AVG — Lightroom Classic Autonomous Vision Gateway

A Lightroom Classic plugin (Lua) plus a Node.js/TypeScript MCP server that let Claude (via Claude Desktop) edit raw photos the way a photographer does: apply an adjustment, look at the rendered result, adjust again — up to a capped number of passes, using only native Develop settings. A local metrics engine (`sharp`) handles clipping, histograms and pass-to-pass deltas; Claude's vision handles the aesthetic judgment. Every edit is non-destructive, visible on the Develop sliders, and reversible through History and Snapshots.

**Status: Phase 0 — feasibility spikes.** Nothing here is usable as a product yet. The repo holds the project scaffold, the Phase 0 spike harnesses (`spikes/`, `plugin/spikes/`) and their report templates (`docs/reports/phase0/`). See [`docs/PHASE0_HANDOVER.md`](docs/PHASE0_HANDOVER.md).

## Architecture (target)

```
Claude Desktop ──stdio MCP──► lrc-avg engine (Node/TS) ──LrSocket (127.0.0.1)──► Lightroom Classic plugin (Lua)
                                 metrics (sharp), session state,                 applyDevelopSettings, previews,
                                 guardrails, intents, provenance logs            snapshots, virtual copies, HUD
```

The loop is Claude-orchestrated (`lr_begin_session` → `lr_step` … → `lr_end_session`); the engine is a stateful step function that enforces a pass cap, step decay and clipping guardrails server-side.

## Repository layout

| Path | Contents |
|---|---|
| `engine/` | Node/TS MCP server (strict ESM TypeScript, vitest) |
| `plugin/LrC-AVG.lrplugin/` | Lightroom plugin (Phase 0: `Info.lua` stub) |
| `plugin/spikes/`, `spikes/` | Phase 0 spike plugins and scripts (throwaway) |
| `docs/` | Automaat survey, environment and dependency records, handover, reports |
| `vendor/automaat/` | Upstream reference snapshot (read-only; see NOTICE) |

## Requirements

Windows 10/11, Lightroom Classic 15.5.1 (Camera Raw 18.5.1), Node.js ≥ 22 (developed on 24.11.1). No Python anywhere in the project.

```powershell
npm install        # engine + spikes workspaces
npm run build      # tsc -> engine\dist
npm test           # vitest
npm run typecheck
```

## License

MIT — see [`LICENSE`](LICENSE). Copyright (c) 2026 Jim Beebe.

## NOTICE — third-party code

This project vendors and builds on **Automaat/lightroom-mcp** (npm `@mskalski/lightroom-mcp`):

- Upstream: https://github.com/Automaat/lightroom-mcp
- Vendored commit: `a160e7aa250b3264694d88e51418f7f512f417de` (2026-09-22)
- License: **MIT**, Copyright (c) 2026 Marcin Skalski. The full license text ships unmodified at [`vendor/automaat/LICENSE`](vendor/automaat/LICENSE) (identical copy at `vendor/automaat/server/LICENSE`).
- Vendored as a snapshot, not a GitHub fork: the upstream `.git` was removed and the files are otherwise unmodified; the two upstream Python files under `vendor/automaat/skills/` are excluded from this repository's git (project rule: no Python).
- Code ported from Automaat into `engine/` or `plugin/` will keep Automaat's copyright and permission notice (a `THIRD_PARTY_NOTICES.md` ships with each packaged half), as the MIT license requires.

Details and file-level provenance: [`docs/AUTOMAAT_SURVEY.md`](docs/AUTOMAAT_SURVEY.md) §1–2.

Adobe, Lightroom and Camera Raw are trademarks of Adobe Inc. This project is not affiliated with or endorsed by Adobe or Anthropic.
