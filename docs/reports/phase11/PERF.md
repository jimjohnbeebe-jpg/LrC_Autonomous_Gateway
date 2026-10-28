---
report: PERF
phase: "11"
status: template
authored_by: "Claude Code (purpose, harness, steps); Jim (the runs, Observed)"
date: 2026-10-27
---

# PERF: how long the catalog reads take

## Purpose

GitHub issue #212 (epic #207) wants the catalog read paths made faster, and its Work 1 says to measure first [stated: issue #212 "Work 1"; the baseline is Jim's run]. This report holds the numbers from before any change (Baseline) and from after (After). Nothing in the Lua read paths or the bridge framing was changed to make this harness: it measures the code as it stands.

`npm run perf:check` times, over N runs each (default 20, after 2 untimed warm-up calls): `ping` (the bridge round trip), `search_photos` with no filter and with a filter (`rating == 0`), both with limit 100, `get_metadata` on the first photo found, `get_selection` with max 500, and `list_keywords` with limit 100. It reports the median (p50) and p95 per call, nearest-rank. `get_selection` is capped at 500 photos by the bridge command [handle: `engine\src\bridge\protocol.ts:100`; `plugin\LrC-AVG.lrplugin\Library.lua:41` `MAX_PAGE = 500`]; with 1,000 selected the run records `selected_count` 1000 and times the 500 it returns. Results: `%TEMP%\LrC-AVG\perf\perf_<label>_<time>.json`.

The harness is read only: it selects nothing, writes nothing and asks nothing, so nothing needs putting back. It stops with a message when the plugin is not connected.

## Steps for Jim

Do these twice: once now (label `baseline`), and once after the PR that speeds up the reads is merged and the plug-in reloaded (label `after`).

1. Quit Claude Desktop (the check takes the engine's instance lock).
2. In Lightroom Classic, open the catalog you normally use, with the LrC-AVG plug-in enabled (File > Plug-in Manager shows it as running).
3. In the Library module's grid, press Ctrl+A in a folder or collection with 1,000 photos or more, so that many are selected. If your catalog has fewer, select all that you have; the report records how many.
4. In PowerShell, in `D:\Developer\LrC_Autonomous_Gateway`, run (use `after` instead of `baseline` the second time):

   ```powershell
   npm run perf:check -- --label baseline
   ```

5. You should see a line per call with `p50` and `p95` in ms, then `Perf check: WORKED`, `put back: YES` and the saved file path. Say "done".

### If something goes wrong

- If it says the plugin is not connected or times out: make sure Lightroom is open and the plug-in is enabled, then run it again.
- If it says another engine holds the lock: quit Claude Desktop, then run it again.
- If a call shows `failed`: run it again once; if it still fails, say so.

## Observed

(Blank. Jim's runs.)

## Numbers

### Baseline

| Call | p50 ms | p95 ms | failed | note |
|---|---|---|---|---|
| ping | | | | |
| search_photos (no filter) | | | | |
| search_photos (filtered) | | | | |
| get_metadata | | | | |
| get_selection (max 500) | | | | |
| list_keywords | | | | |

Plugin version, Lightroom version, catalog size, photos selected: (blank).

### After

(Same table; blank until the speed-up PR is merged and the harness rerun with `--label after`.)
