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

Leave each spike plugin installed after its run. They should not conflict with each other [inference: each plugin has its own `LrToolkitIdentifier` (`plugin\spikes\S<n>.lrplugin\Info.lua`) and its own menu items, and only S2 opens sockets, and only after its Start menu item]. Their menu items are under **File > Plug-in Extras** [inference: S1 run 1 was started from that menu path, as its README said].

## How results get into the repo (every spike)

1. Save each screenshot the spike README asks for in `D:\Developer\LrC_Autonomous_Gateway\docs\reports\phase0\`, using the exact file name it gives (`S<n>-<what>.png`).
2. Open the spike's report, `docs\reports\phase0\S<n>.md`.
3. Paste the output the README names under the heading it names, and save the file.
4. Do not commit anything.
5. Tell Claude Code "S<n> done". Claude Code commits the report and screenshots through a Greptile-reviewed PR.

## Verified here without Lightroom (Claude Code)

- All Lua files parse as Lua 5.1 [handle: Claude Code session 2026-09-23, scratch install `luaparse@0.3.1` (not a project dependency), `luaparse.parse(src, { luaVersion: "5.1" })` over `plugin\**\*.lua` → "20/20 Lua files parse as Lua 5.1"]. That proves syntax only, not SDK behaviour.
- `SpikeJson.lua` (S5) runs under fengari 0.1.4 (a Lua 5.3 VM); its output parses with Node's `JSON.parse` and passes 17/17 value checks [handle: `docs\reports\phase0\S5.md` "Pre-run findings"].
- `spikes\S1\measure.ts` was run on the run-1 CSV and on synthetic CSVs covering the retry success path and a stale frame [handle: `docs\reports\phase0\S1.md` "Pre-run findings" and "Run 1 analysis"].
- `spikes\S2\client.ts` was run against a fake Node echo server [handle: `docs\reports\phase0\S2.md` "Pre-run findings"].
- `spikes\S3\server.ts` was exercised via `node spikes\S3\smoke-client.ts` [handle: `docs\reports\phase0\S3.md` "Pre-run findings"].
- `node spikes\S5\pin.ts engine\tests\fixtures\synthetic-s5-dump-a.json engine\tests\fixtures\synthetic-s5-dump-b.json --dry-run` was run [handle: `docs\reports\phase0\S5.md` "Pre-run findings"].
