---
report: PERF
phase: "11"
status: observed
authored_by: "Claude Code (purpose, harness, steps; Observed and Numbers copied from the results file, 2026-10-27); Jim (the runs)"
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

### Baseline, 2026-10-27

Jim ran `npm run perf:check -- --label baseline` and said "done" [stated: Jim, 2026-10-27, "npm run perf:check -- --label baseline done."]. The results file says `headline: WORKED`, 20 timed runs per call after 2 warm-ups, no call failed [handle: `docs\reports\phase11\PERF\baseline\perf_baseline_2026-10-28T02-11-00-711Z.json`]. Claude Code copied that file into the repo; the figures below are from it.

- Engine 1.5.0, plugin 1.5.0, Lightroom Classic 15.6, Node v24.11.1.
- `search_photos` with no filter counted 18,621 photos (`catalog_matches`). 4,588 photos were selected, not 1,000; `get_selection` timed the 500 it returns.

## Numbers

### Baseline

| Call | p50 ms | p95 ms | failed | note |
|---|---|---|---|---|
| ping | 0.3 | 0.4 | 0 | bridge round trip |
| search_photos (no filter) | 250.8 | 329.2 | 0 | limit 100 of 18,621 |
| search_photos (filtered) | 255.6 | 351.2 | 0 | rating == 0, limit 100 |
| get_metadata | 70.5 | 108.0 | 0 | first photo of the search |
| get_selection (max 500) | 1255.4 | 1349.1 | 0 | 4,588 selected, 500 returned |
| list_keywords | 10786.0 | 11035.1 | 0 | limit 100 |

Plugin 1.5.0, Lightroom Classic 15.6, 18,621 photos in the catalog (`search_photos` count), 4,588 selected [handle: `docs\reports\phase11\PERF\baseline\perf_baseline_2026-10-28T02-11-00-711Z.json`].

### After

(Same table; blank until the speed-up PR is merged and the harness rerun with `--label after`.)

## Verdict

(Jim's, after the After run. The baseline alone has no verdict.)

## Consequences / open questions

- `list_keywords` is the slowest call by far: about 10.8 s for a page of 100. The handler walks the whole keyword tree (`KeywordTree.walk`) before it takes the page [handle: `plugin\LrC-AVG.lrplugin\Library.lua:164-173`], so its time likely grows with the size of the tree, not the page [inference]. The size of Jim's keyword tree was not recorded. #212 Work 2 already lists `KeywordTree.lua` among the reads to batch [handle: issue #212 body, "Work" item 2].
- `get_selection` takes about 1.26 s for 500 photos (about 2.5 ms a photo) [handle: the results file above]. #212 puts the cost in per-photo SDK getter calls and their per-call overhead, and Work 2 converts `Library.lua` and `Photos.lua` to batch reads [handle: issue #212 body].
- `search_photos` takes about 250 ms whether or not it filters, with a limit of 100 of 18,621 [handle: the results file above].
- The After run (`--label after`) waits for the #212 speed-up PR.
