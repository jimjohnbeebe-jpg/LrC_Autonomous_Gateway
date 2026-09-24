# Phase 0 spikes (AVG-S1 … AVG-S6)

Throwaway harnesses that answer the feasibility questions in PHASES.md Phase 0. Claude Code wrote the harnesses and the report templates. **Jim runs the Lightroom parts and fills the "Observed" sections** in `docs\reports\phase0\S<n>.md`.

| Spike | Question | Lightroom plugin | Node script(s) | README |
|---|---|---|---|---|
| S1 | Is `requestJpegThumbnail` fresh and fast right after `applyDevelopSettings`? | `plugin\spikes\S1.lrplugin` | `spikes\S1\measure.ts` | [S1](S1/README.md) |
| S2 | Do LrSocket receive+send listeners work, how big a message survives, what RTT? | `plugin\spikes\S2.lrplugin` | `spikes\S2\client.ts` | [S2](S2/README.md) |
| S3 | Does Claude Desktop (and Claude Code) show an MCP image result and describe it? | — | `spikes\S3\server.ts` | [S3](S3/README.md) |
| S4 | Is a floating dialog non-modal, live-updating, and polite about focus? | `plugin\spikes\S4.lrplugin` | — | [S4](S4/README.md) |
| S5 | What are the real develop-setting keys and CameraProfile strings? Are profile + lens toggles writable? | `plugin\spikes\S5.lrplugin` | `spikes\S5\pin.ts` | [S5](S5/README.md) |
| S6 | Does `createVirtualCopies` work from Loupe and Grid, and are the copies addressable? | `plugin\spikes\S6.lrplugin` | — | [S6](S6/README.md) |

## One-time setup (PowerShell)

```powershell
cd D:\Developer\LrC_Autonomous_Gateway
npm install          # engine + spikes workspaces (sharp, MCP SDK, zod)
node -v              # must be >= 22.18 (type stripping); dev machine: v24.11.1
```

**Adding a spike plugin to Lightroom:** File > Plug-in Manager > **Add** > select the folder, e.g. `D:\Developer\LrC_Autonomous_Gateway\plugin\spikes\S1.lrplugin` > Done. Menu items are declared as `LrExportMenuItems`, which should appear under **File > Plug-in Extras** in every module [unverified on 15.5.1 — note where they actually appear]. Add only the spike you are running, and remove or disable it afterwards.

All Lightroom-side output goes to `$env:TEMP\LrC-AVG\` (the plugin uses `LrPathUtils.getStandardFilePath("temp")`; if the dialogs show a different folder, pass that folder to the Node scripts).

Suggested order: S5 first (the key dump is needed for Phase 1 and takes 10 minutes), then S1, S2, S4, S6, S3.

## Verified here without Lightroom (Claude Code, 2026-09-23)

- All 20 Lua files parse as Lua 5.1 (`luaparse` 0.3.1, run once via a scratch install, not a project dependency). Parsing proves syntax only, not SDK behaviour.
- `SpikeJson.lua` (S5) was run under fengari 0.1.4 (a Lua 5.3 VM); Node's `JSON.parse` accepts its output and 17/17 value checks pass.
- `spikes\S1\measure.ts` on synthetic JPEGs + CSV, `spikes\S2\client.ts` against a fake Node echo server, `spikes\S3\server.ts` through `smoke-client.ts`, `spikes\S5\pin.ts --dry-run` on the synthetic dumps: all behave as intended. Details are in each report's "Pre-run findings".
