---
report: PERF
phase: "11"
status: observed
authored_by: "Claude Code (purpose, harness, steps; Observed and Numbers copied from the results files, 2026-10-27, 2026-10-28 and 2026-10-29; the suggested verdict); Jim (the runs, the list_keywords decision, the verdict)"
date: 2026-10-28
---

# PERF: how long the catalog reads take

## Purpose

GitHub issue #212 (epic #207) wants the catalog read paths made faster, and its Work 1 says to measure first [stated: issue #212 "Work 1"; the baseline is Jim's run]. This report holds the numbers from before any change (Baseline) and from after (After). Nothing in the Lua read paths or the bridge framing was changed to make this harness: it measures the code as it stands.

`npm run perf:check` times, over N runs each (default 20, after 2 untimed warm-up calls): `ping` (the bridge round trip), `search_photos` with no filter and with a filter (`rating == 0`), both with limit 100, `get_metadata` on the first photo found, `get_selection` with max 500, and `list_keywords` with limit 100. It reports the median (p50) and p95 per call, nearest-rank. `get_selection` is capped at 500 photos by the bridge command [handle: `engine\src\bridge\protocol.ts:100`; `plugin\LrC-AVG.lrplugin\Library.lua:41` `MAX_PAGE = 500`]; with 1,000 selected the run records `selected_count` 1000 and times the 500 it returns. Results: `%TEMP%\LrC-AVG\perf\perf_<label>_<time>.json`.

The harness is read only: it selects nothing, writes nothing and asks nothing, so nothing needs putting back. It stops with a message when the plugin is not connected.

## Steps for Jim

The baseline and after runs are done (see Observed). These steps were for the **after** run, once the #212 speed-up PR is merged and Claude Code has pulled `main` into `D:\Developer\LrC_Autonomous_Gateway`.

What changed, so you know what the after run measures [handle: the PR's commits on branch `phase-11/perf-212`]:

- The plug-in reads a page of photos (`search_photos`, `get_selection`, and the one photo every command names) with two batch calls per 100 photos instead of 7-9 calls per photo, outside the catalog's read lock; `get_metadata` reads its fields the same way. If a batch call fails, the plug-in falls back to the old reads and writes a `photos: a batch read ... failed` or `get_metadata: the batch read failed` line to `bridge.log`.
- `list_keywords` makes one call fewer per keyword (plain-ASCII names are lower-cased in Lua).
- No answer changed shape. The engine side (line framing, compact JSON) was already as #212 asks; only tests were added.
- No new plug-in file, so Reload Plug-in is enough; Lightroom does not need a restart.

1. Quit Claude Desktop (the check takes the engine's instance lock).
2. In Lightroom Classic, open the same catalog as for the baseline. In File > Plug-in Manager, select LrC-AVG, click **Reload Plug-in**, then click Done. Plug-in Manager shows it as running.
3. In the Library module's grid, select the same photos as for the baseline (Ctrl+A in the same folder or collection; the baseline had 4,588 selected).
4. In PowerShell, in `D:\Developer\LrC_Autonomous_Gateway`, run:

   ```powershell
   npm run perf:check -- --label after
   ```

5. You should see a line per call with `p50` and `p95` in ms, then `Perf check: WORKED`, `put back: YES` and the saved file path. Say "done".

### If something goes wrong

- If it says the plugin is not connected or times out: make sure Lightroom is open and the plug-in is enabled, then run it again.
- If it says another engine holds the lock: quit Claude Desktop, then run it again.
- If a call shows `failed`: run it again once; if it still fails, say so.
- If Plug-in Manager shows the plug-in as not running after Reload Plug-in: quit and restart Lightroom, then go on from step 2.

## Observed

### Baseline, 2026-10-27

Jim ran `npm run perf:check -- --label baseline` and said "done" [stated: Jim, 2026-10-27, "npm run perf:check -- --label baseline done."]. The results file says `headline: WORKED`, 20 timed runs per call after 2 warm-ups, no call failed [handle: `docs\reports\phase11\PERF\baseline\perf_baseline_2026-10-28T02-11-00-711Z.json`]. Claude Code copied that file into the repo; the figures below are from it.

- Engine 1.5.0, plugin 1.5.0, Lightroom Classic 15.6, Node v24.11.1.
- `search_photos` with no filter counted 18,621 photos (`catalog_matches`). 4,588 photos were selected, not 1,000; `get_selection` timed the 500 it returns.

### After, 2026-10-28

Jim ran `npm run perf:check -- --label after` on plugin 1.6.0 (main `de15f22`, with #212's batched reads) and reported the check batch done [stated: Jim, 2026-10-28, "Checks done."]. The results file says `headline: WORKED`, 20 timed runs per call after 2 warm-ups [handle: `docs\reports\phase11\PERF\after\perf_after_2026-10-28T11-34-08-350Z.json`, copied from `%TEMP%\LrC-AVG\perf\`].

- Engine 1.6.0, plugin 1.6.0, Lightroom Classic 15.6, Node v24.11.1.
- `search_photos` with no filter counted 18,641 photos; 4,608 were selected (baseline: 18,621 and 4,588, so nearly, not exactly, the same catalog and selection).
- **One run of `search_photos` (filtered) failed**: `failed` 1, 19 timings kept. The results file keeps no error text for a failed run, so why it failed is not known [handle: the file, `timings[2]`]. Two of the 19 kept runs took over 600 ms (602.4 and 660.3 ms), against 43-75 ms for the other 17.

### After the keyword cache, 2026-10-29

Jim ran `npm run perf:check -- --label after-cache` on 1.7.0 (main `1768ad6`, with the keyword cache from PR #246) as check 1 of the 1.7.0 batch (`BATCH-1.7.0-CHECKS.md`) and said it was done [stated: Jim, 2026-10-29, "Check one and two done."]. The results file says `headline: WORKED`, 20 timed runs per call after 2 warm-ups, no call failed [handle: `docs\reports\phase11\PERF\after-cache\perf_after-cache_2026-10-29T00-25-25-283Z.json`, copied from `%TEMP%\LrC-AVG\perf\`]. It started at 00:25:25 UTC [handle: the file, `started`].

- Engine 1.7.0, plugin 1.7.0, Lightroom Classic 15.6, Node v24.11.1 [handle: the file, `engine_version`, `plugin_version`, `lrc_version`, `node`].
- `search_photos` with no filter counted 18,642 photos; 4,608 were selected (2026-10-28 After: 18,641 and 4,608) [handle: the file, `catalog_matches`, `selected_count`].
- **`list_keywords` p50 went from 10,687.5 ms to 1.5 ms.** All 20 timed calls took 1.3-7.8 ms [handle: the file, `timings[5].ms`]. The first walk of the tree fell in the 2 untimed warm-up calls, so every timed call used the plugin's 120 s keyword cache [inference: the warm-ups run first and are not timed; no call in `ms` is near 10 s].
- The filtered search failed no run this time, and its slowest run took 63.6 ms [handle: the file, `timings[2].failed`, `timings[2].max`]. The failed run and the two 600 ms runs of 2026-10-28 did not show again.

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

| Call | p50 ms | p95 ms | failed | note | p50 against the baseline |
|---|---|---|---|---|---|
| ping | 0.3 | 0.4 | 0 | bridge round trip | unchanged |
| search_photos (no filter) | 41.3 | 53.6 | 0 | limit 100 of 18,641 | 6.1 times faster (-83.5 %) |
| search_photos (filtered) | 47.5 | 660.3 | **1** | rating == 0, limit 100; two kept runs over 600 ms | 5.4 times faster (-81.4 %) |
| get_metadata | 62.8 | 87.1 | 0 | first photo of the search | -10.9 % |
| get_selection (max 500) | 154.3 | 172.1 | 0 | 4,608 selected, 500 returned | 8.1 times faster (-87.7 %) |
| list_keywords | 10687.5 | 10862.8 | 0 | limit 100 | -0.9 %: no gain |

Plugin 1.6.0, Lightroom Classic 15.6 [handle: `docs\reports\phase11\PERF\after\perf_after_2026-10-28T11-34-08-350Z.json`]. The last column is Claude Code's arithmetic on the two files' p50 values.

### After the keyword cache

| Call | p50 ms | p95 ms | failed | note | p50 against After (2026-10-28) |
|---|---|---|---|---|---|
| ping | 0.3 | 0.4 | 0 | bridge round trip | unchanged |
| search_photos (no filter) | 41.3 | 52.0 | 0 | limit 100 of 18,642 | unchanged |
| search_photos (filtered) | 45.5 | 62.9 | 0 | rating == 0, limit 100 | -4.2 % |
| get_metadata | 65.2 | 95.1 | 0 | first photo of the search | +3.8 % |
| get_selection (max 500) | 157.6 | 175.8 | 0 | 4,608 selected, 500 returned | +2.1 % |
| list_keywords | 1.5 | 2.0 | 0 | limit 100; every timed call from the cache | about 7,100 times faster (10,687.5 to 1.5) |

Engine and plugin 1.7.0, Lightroom Classic 15.6 [handle: `docs\reports\phase11\PERF\after-cache\perf_after-cache_2026-10-29T00-25-25-283Z.json`]. The last column is Claude Code's arithmetic on the two files' p50 values. The changes under 5 % in the other calls are small enough to be run-to-run spread [inference].

## Verdict

(Jim's.) **Suggested by Claude Code, a suggestion only:** go for #212's batched photo reads (`search_photos` and `get_selection` 5-8 times faster at p50, `get_metadata` 11 % faster); no gain for `list_keywords`, which the keyword cache below answers; the failed filtered search and its two slow runs stay [unverified] until a rerun shows them again.

## Consequences / open questions

- `list_keywords` is the slowest call by far: about 10.8 s for a page of 100. The handler walks the whole keyword tree (`KeywordTree.walk`) before it takes the page [handle: `plugin\LrC-AVG.lrplugin\Library.lua:164-173`], so its time likely grows with the size of the tree, not the page [inference]. The size of Jim's keyword tree was not recorded. #212 Work 2 already lists `KeywordTree.lua` among the reads to batch [handle: issue #212 body, "Work" item 2].
- `get_selection` takes about 1.26 s for 500 photos (about 2.5 ms a photo) [handle: the results file above]. #212 puts the cost in per-photo SDK getter calls and their per-call overhead, and Work 2 converts `Library.lua` and `Photos.lua` to batch reads [handle: issue #212 body].
- `search_photos` takes about 250 ms whether or not it filters, with a limit of 100 of 18,621 [handle: the results file above].
- The After run (`--label after`) is done, on 2026-10-28 (Observed above).
- **What #212 changed, and what it left.** Work 2: page reads batched (`plugin\LrC-AVG.lrplugin\Photos.lua` `describePage`, used by `Library.lua` search_photos and `Catalog.lua` get_selection), `get_metadata` batched (`Metadata.lua` `partsBatched`), one `LrTasks.pcall` per keyword list (`KeywordTree.lua` `listed`), ASCII names folded in Lua (`KeywordTree.fold`). Left, each with its reason: `keyword:getAttributes()` (the walk reads only `getName`, which it would replace one for one [inference]); `findPhotoByPath` (no path is found by scanning `getAllPhotos`; the one `getAllPhotos` call is the unfiltered search, which needs every photo for its count, and `Transfer.lua` already uses `findPhotoByPath`) [handle: `grep getAllPhotos` over `plugin\LrC-AVG.lrplugin\`]; `getPhotoByLocalId` (no plugin path calls it; only spikes S6 and S7 do) [handle: same grep for `getPhotoByLocalId`]. Work 3: the bridge already framed lines in one pass and sent compact JSON since PR #14 [handle: `engine\src\bridge\lines.ts:1-4`, `engine\src\bridge\client.ts:175`, `engine\src\mcp\server.ts:77`]; tests now pin it.
- **`list_keywords` stayed a whole-tree walk, and the after run shows no gain** (10.8 s to 10.7 s at p50). Every call walked all keywords (sorted per level) to count them and take its page; #212 removed one SDK call per keyword, not the walk. Jim's decision before the after run: wait for it, then decide; with no gain, build the cache [stated: Jim, 2026-10-28, "Go with recommendation"].
- **The keyword cache (branch `fix/phase11-check-followups`).** The plugin keeps the walked paths on `_G` with the time of the walk (`plugin\LrC-AVG.lrplugin\KeywordTree.lua`, `KeywordTree.paths`), reuses them for 120 s, and drops them on every keyword write it makes: `set_keywords` (`Library.lua`) and `rename_keyword` (`KeywordEdit.lua`); no other plugin file writes keywords [handle: `engine\tests\lua-keyword-cache.test.ts`]. `import_photos` (`Transfer.lua`) drops them too, since a file's own keywords may join the Keyword List on import [inference]. A walk that a write overlaps is not kept. `lr_list_keywords` takes `refresh: true` to walk again and answers `cached` (whether the kept walk was used); its text says keywords changed by hand in Lightroom show after at most 2 minutes, or at once with refresh. The first call still takes the ~10.7 s walk; the calls after it within 2 minutes should take about what `search_photos` takes [inference: not measured]. A `perf:check` rerun on the new plugin would show it: of its 22 `list_keywords` calls only the first would walk.
- **The after-cache run (2026-10-29) shows the cache working:** `list_keywords` at 1.5 ms p50 against 10.7 s, the other calls about as on 2026-10-28 (Observed, "After the keyword cache"). The run did not time the first, uncached walk, which fell in the warm-ups, so the cost of a cold call on 1.7.0 is not measured here; it should be about the 10.7 s of the After run [inference].
- **Preview and export path (#212 Work 4), read for avoidable time; analysis only, nothing measured here** [inference throughout, from the code]:
  - The export itself (`LrExportSession`, `doExportOnCurrentTask` in `plugin\LrC-AVG.lrplugin\Preview.lua:61-80`) is Lightroom's and dominates: ~2.6 s at 800, 1200 and 1600 px alike, so a smaller preview does not export faster [handle: `docs\reports\phase2\PHASE2.md` "Numbers", export time by long edge]. Nothing on our side shortens it.
  - Before the export the plug-in finds the photo (`Develop.target`, `plugin\LrC-AVG.lrplugin\Develop.lua:53-75`: by uuid, `findPhotoByUuid` plus `Photos.describe`, now two batch calls; else `getTargetPhoto` plus one uuid read in a read gate) and checks the original (`Photos.missing`: `checkPhotoAvailability`, one read gate for the path, `LrFileUtils.exists`). These are single-photo reads, small next to the export; reading the path in the same batch as the description would save `Photos.missing` its read gate, one per preview.
  - The preview crosses as a file path, not base64, so the bridge framing carries no image bytes (Phase 0 D-01; `Preview.lua:7`).
  - The engine (`engine\src\preview\service.ts:138-164`) reads the JPEG header (`sharp().metadata()`, no full decode), re-encodes only when the export is rotated or larger than asked (Lightroom exports to the asked long edge, so normally not), then decodes it once to raw for the metrics (`engine\src\metrics\compute.ts:282`). When the image goes into a tool result, `engine\src\mcp\image-cap.ts:39-46` reads the header again and decodes and re-encodes only when it is over the 900,000-character cap or 2,000 px. So a normal pass decodes the JPEG once in the engine; the second decode happens only over the cap.
  - Queueing: each bridge line runs in its own task (`plugin\LrC-AVG.lrplugin\Sockets.lua:97`, `LrTasks.startAsyncTask` per message), so an `export_preview` does not wait behind other commands on our side; whether Lightroom runs two exports at once or one after the other is [unverified]. The split is already recorded per preview: `timings.command_ms` minus `export_ms` is the plug-in's pre-export reads plus the transport and any wait, `file_ms` the engine's read and (rare) re-encode, `metrics_ms` the decode and measurement [handle: `engine\src\preview\service.ts:72-81`]. Phase 4 saw about 6 s per write-and-export against ~2.6 s for an export alone, cause [unverified] [handle: vault LR_SDK_NOTES "Recorded in Phase 4", Timing]; reading those four timings from a session log would show where that time went, with no new harness.
