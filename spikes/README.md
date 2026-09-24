# Phase 0 spikes (AVG-S1 … AVG-S6)

Throwaway harnesses that answer the feasibility questions in PHASES.md Phase 0. Claude Code wrote the harnesses and the report templates. **Jim runs the Lightroom parts and pastes results into `docs\reports\phase0\S<n>.md`.**

| Spike | Question | Lightroom plugin | Node script(s) | README |
|---|---|---|---|---|
| S1 | How fast is a fresh `requestJpegThumbnail` after `applyDevelopSettings`? | `plugin\spikes\S1.lrplugin` | `spikes\S1\measure.ts` | [S1](S1/README.md) |
| S2 | Do LrSocket receive+send listeners work, how big a message survives, what RTT? | `plugin\spikes\S2.lrplugin` | `spikes\S2\client.ts` | [S2](S2/README.md) |
| S3 | Does Claude Desktop (and Claude Code) show an MCP image result and describe it? | — | `spikes\S3\server.ts` | [S3](S3/README.md) |
| S4 | Is a floating dialog non-modal, live-updating, and polite about focus? | `plugin\spikes\S4.lrplugin` | — | [S4](S4/README.md) |
| S5 | What are the real develop-setting keys and CameraProfile strings? Are profile + lens toggles writable? | `plugin\spikes\S5.lrplugin` | `spikes\S5\pin.ts` | [S5](S5/README.md) |
| S6 | Does `createVirtualCopies` work from Loupe and Grid, and are the copies addressable? | `plugin\spikes\S6.lrplugin` | — | [S6](S6/README.md) |

## Run order

1. **S1 run 2** (the retry harness; run 1 was inconclusive)
2. S5
3. S2
4. S4
5. S6
6. S3

## One-time setup (already done on this machine)

`npm install` was run in `D:\Developer\LrC_Autonomous_Gateway`, and Node is v24.11.1. Nothing to do.

## Adding a spike plugin to Lightroom (each spike README says when)

1. **File > Plug-in Manager**.
2. Click **Add** (bottom left).
3. Browse to the spike's folder, e.g. `D:\Developer\LrC_Autonomous_Gateway\plugin\spikes\S5.lrplugin`, select the folder itself, and click **Select Folder**.
4. Check that the new entry shows **Enabled**, then click **Done**.

Leave each spike plugin installed after its run; they don't conflict with each other. Their menu items are under **File > Plug-in Extras**.

## How results get into the repo

- Paste each spike's output into its report, `docs\reports\phase0\S<n>.md`, under the heading the README names, and save.
- Save screenshots in `D:\Developer\LrC_Autonomous_Gateway\docs\reports\phase0\`, named `S<n>-<what>.png`, as each README says.
- Do not commit. Tell Claude Code the spike is done; it commits the report and screenshots through a Greptile-reviewed PR.

## Verified here without Lightroom (Claude Code)

- All Lua files parse as Lua 5.1 (`luaparse` 0.3.1, a scratch install, not a project dependency). That proves syntax only, not SDK behaviour.
- `SpikeJson.lua` (S5) runs under fengari 0.1.4 (a Lua 5.3 VM); its output parses with Node's `JSON.parse` and passes 17/17 value checks.
- `spikes\S1\measure.ts` (synthetic CSVs: retry success path, stale frame, and the run-1 error case), `spikes\S2\client.ts` (against a fake Node echo server), `spikes\S3\server.ts` (via `smoke-client.ts`), `spikes\S5\pin.ts --dry-run` (synthetic dumps). Details are in each report's "Pre-run findings".
