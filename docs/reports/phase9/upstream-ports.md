---
report: Issue #190 (Automaat ports), #186 (one-channel clipping) and #176 (freeze rebind) in Lightroom
phase: 9 (phase-9/upstream-ports, engine and plugin 1.1.0)
status: observed
authored_by: "Template, harness and pre-run findings: Claude Code (Opus 5.5), 2026-10-24. Observed: Jim, run 1 of the three checks, 2026-10-24 (collected by Claude Code from the result files); denoise:check run 2 pass 2 is the official Denoise result [stated: Jim, 2026-10-24]. Numbers: filled from Observed. Verdict: Jim."
date: 2026-10-24
---

# Issue #190 (Automaat ports), #186 and #176 in Lightroom

## Purpose

**The question.** This branch ports four Automaat features added after our fork point `a160e7a` (issue #190) and fixes two hands-on issues [stated: Jim, 2026-10-24, triage picks "Preview by uuid, AI Denoise, Color + depth range masks, Brush masks from strokes, #186 clip guard, #176 freeze rebind", one combined PR]. Do they work in Lightroom?

1. **Preview by uuid** (Automaat #259): does `lr_get_preview` `uuid` render a photo without selecting it?
2. **AI Denoise** (Automaat #288): does `lr_apply_denoise` turn Denoise on, change its amount, leave a photo already at that amount alone, put back the module and the selection, and can the snapshot it takes undo it?
3. **Colour range, depth range and brush masks** (Automaat #324, #326, #334): does Lightroom take the engine's three new mask forms, read them back unchanged, and draw them where asked?
4. **#186**: the highlight guard counts a pixel as blown only when two or more channels are at 253 or above [stated: Jim, 2026-10-24, "2+ channels ≥ 253"]. Clipping in one channel alone is an advisory, and no slider moves [stated: Jim, 2026-10-24, "Advisory only"].
5. **#176**: is the freeze once per session gone now that the startup rebind no longer runs on every start, and does a Reload Plug-in still leave Lightroom listening?

**Go rule** (PHASES.md has none for an issue fix; proposed [inference]):
- **Go**: all three checks say WORKED, or the only gap is the depth range skipped on a photo without depth data, and Jim saw no freeze in stall:check's enabled phase.
- **Conditional**: one new mask kind fails. That kind is then refused again until it is fixed; the rest ships.
- **No-go**: Denoise leaves a photo changed after its snapshot is applied, the selection or module is not put back, or the freeze is as frequent as before.

**How the checks ask Jim:** y/n questions in the PowerShell window running each check, as for `npm run masks:combine` (rule 04, "Steps for Jim").

## Harness

| What | Files |
|---|---|
| Preview by uuid | `engine\src\mcp\tools-context.ts` `renderPhoto`, `defs-context.ts`; tests `engine\tests\preview-by-uuid.test.ts` |
| AI Denoise | plugin `plugin\LrC-AVG.lrplugin\Denoise.lua`; engine `engine\src\mcp\tools-denoise.ts`, `defs-files.ts`; tests `engine\tests\catalog-denoise.test.ts`; check `engine\src\devtools\denoise-check.ts`, `denoise-check-cli.ts` |
| New mask kinds | `engine\src\params\mask-range.ts`, `mask-brush.ts`, `mask-table.ts`, `mask-build.ts`; `engine\src\session\masks.ts` (colour sample, depth put-back); `engine\src\metrics\pixel.ts`; tests `params-mask-kinds.test.ts`, `session-mask-kinds.test.ts`; check `engine\src\devtools\mask-combine-probe.ts` `KIND_CANDIDATES`, `mask-combine-probe-cli.ts --kinds` |
| #186 | `engine\src\metrics\compute.ts` `clip_high_tone_pct`; `engine\src\session\guardrail.ts` `advisory`; `plan.ts` `applyProjectedGuardrail`; tests `metrics.test.ts`, `session-step.test.ts` |
| #176 | `plugin\LrC-AVG.lrplugin\Sockets.lua` `rebindOr`, `Bridge.lua` (overlap rebind), `Endpoint.lua` `recentStart`, `Stall.lua`; check `engine\src\devtools\stall-check-cli.ts` (Step 5b) |

## Pre-run findings (Claude Code)

- `npm run build`, `npm test` (1712 passed, 3 skipped), `npm run typecheck` and `npm run arch:check` (no violations) passed on the branch, 2026-10-24 [handle: the PR's commits; CI `arch-check`].
- The engine's colour range and brush components have the same keys as Jim's hand-made "Color Range 1" and "Brush 1" [handle: `engine\tests\params-mask-kinds.test.ts`, against `docs\reports\phase8.5\mask-carry\mask_carry_2026-10-11T22-37-39-161Z.json`].
- On the six golden fixtures, any-channel clipping (`clip_high_pct`) is 0 to 19.3 %, while two-channel clipping (`clip_high_tone_pct`) is 0 to 0.71 % [handle: `tests\golden\golden.json`, written by `engine\dist\devtools\goldens.js` `goldenEntry`, 2026-10-24]. Four of the six fixtures are over the 0.5 % limit on any-channel clipping, and one is on the new metric [inference: read from those numbers].
- Not checked by Claude Code, left for the runs:
  - the LrC 15 Denoise calls (`getEnhancePanelState`, `setEnhance`, `changeDenoiseAmount`) and the "Enhance" filter name [upstream claim: Automaat PR #288];
  - `getActiveSources` and `setActiveSources` [upstream claim: same];
  - the depth range's form [upstream claim: Automaat PR #334];
  - whether Lightroom adds `r`, `f` or `h` tokens to the engine's brush dabs [upstream claim: Automaat PR #326];
  - whether Lightroom on Windows fires the receive socket's `onClosed` or "failed to open" while idle [unverified].

## Observed (Jim)

Steps for Jim, in this order. Reload the plugin first: File > Plug-in Manager, LrC-AVG (dev), Reload Plug-in. Quit Claude Desktop.

1. **Masks.** In Lightroom's Develop module, select one virtual copy of a photo alone. In PowerShell at `D:\Developer\LrC_Autonomous_Gateway`, run `npm run masks:kinds` and answer y/n for each mask as you look at the photo.
2. **Denoise.** In the Library grid, select two virtual copies of raw photos. Run `npm run denoise:check`, wait without clicking in Lightroom, and answer the two questions.
3. **Freeze.** Run `npm run stall:check` and follow its steps. When it asks, click Reload Plug-in.

Say "done" after each one. Claude Code collects the files under `%TEMP%\LrC-AVG\masks-kinds\`, `%TEMP%\LrC-AVG\denoise-check\` and `%TEMP%\LrC-AVG\stall\`.

### Run 1, 2026-10-24 (Jim)

Jim's notes [stated: Jim, 2026-10-24]:
- "at the beginning of test 2 LrC crashed to the desktop without warning and had to be restarted. This happened during the create copy process."
- "I believe the tests results on test 2 were negative."
- On test 3: "the test directed me to 'leave LrC-AVG Disabled' but it was enabled, test would not complete, I Ctrl-C, restarted LrC, disabled the plug-in manually and started the test, whereafter it completed successfully."

**1. masks:kinds: WORKED, put back YES** [handle: `%TEMP%\LrC-AVG\masks-kinds\mask_kinds_2026-10-24T16-08-01-960Z.json`, `form_lines`, `put_back`]. The photo was `20220904-_DSC1617-20220904-DxO_DeepPRIME XD3-HDR.dng`.
- Colour range: Jim answered y. The read-back and a fresh read match what was written (`problems` empty). The sample read from the preview was `0.085490 0.112941 0.136471` at the centre, ColorAmount 0.5.
- Brush: Jim answered y. Both strokes' Dabs (65 and 36 entries, the second with a leading `f 0.5000`) read back identical, on both reads [handle: same file, `forms[1]`; compared by a `node -e` script in this session, "dabs same: true true"]. Lightroom added no `r` or `h` tokens.
- Depth range: skipped, because this photo has no depth map (no `LuminanceDepthSampleInfo` in the read-back). Lightroom stored the written `DepthRange "0.000000 0.000000 0.300000 0.500000"`, Type -1, unchanged [handle: same file, `forms[2].read_back`]. Whether it draws on a photo with depth data stays [unverified]. The summary line printed "YES depth_range" for this skip; it now prints "SKIP" (`mask-combine-probe.ts` `verdict`).
- A side finding: the brush Jim painted by hand on this photo is stored as a compressed `MaskBrushTable` / `BrushTable_<id>` field, not as `Masks` of `Mask/Paint` with Dabs [handle: same file, `table_before[0].CorrectionMasks[1]`]. The Phase 8.5 capture's hand-made brush had Dabs.

**The crash.** Lightroom closed between the two checks. No bridge command was running: the last one, masks:kinds' put-back, ended at 09:08:28. The plugin's next start is at 09:09:47 [handle: `%TEMP%\LrC-AVG\bridge.log` lines 48123-48131]. Windows recorded no Application Error for Lightroom that morning [handle: `Get-WinEvent` Application log, ids 1000-1002 from 08:30, run by Claude Code 2026-10-24, no Lightroom entry]. The log alone cannot show whether the plugin's idle loop played a part [inference]. One thing preceded it: the first rebind of the new kind (`rebind receive (closed, generation 1)`, when the check's engine disconnected) ran at 09:08:28, about a minute before.

**2. denoise:check: FAILED, put back NO** [handle: `%TEMP%\LrC-AVG\denoise-check\denoise_check_2026-10-24T16-10-22-533Z.json`, `lines`, `put_back`]. The photos were `PICT0019.DNG` and `_DSC0028.NEF`.
- All three Denoise steps answered as expected on both photos:

  | Step | Answers | Time per photo |
  |---|---|---|
  | First Denoise, amount 30 | applied, applied | 8.0 s and 7.0 s |
  | Amount 30 again | unchanged, unchanged | 1.4 s and 2.5 s |
  | Amount 50 | amount_changed (from 30) on both | 2.5 s and 4.7 s |
- Denoise put the module back after every photo: each `apply_denoise` logs "switched from library to develop" [handle: `bridge.log` lines 48144, 48148, 48155, 48159, 48163, 48168]. The harness found the same two photos selected.
- `lr_get_preview` by uuid rendered `_DSC0028.NEF` at 800 × 531 while it was not the active photo.
- **The put-back failed:** `unknown_snapshot` on both photos. **The cause is the check, not `lr_apply_denoise`.** The check gave every step's snapshot one name, and `Develop.createSnapshot` calls `createDevelopSnapshot(name, true)`, which replaces a snapshot of the same name. The amount-50 step's snapshot therefore deleted the first one [inference, from `plugin\LrC-AVG.lrplugin\Develop.lua` `createSnapshot` and the snapshot ids in `steps`]. `lr_apply_denoise` itself takes a new name on every call (`AVG pre-denoise <6 hex>`, `engine\src\mcp\tools-denoise.ts`). Fixed: the check now names each step's snapshot separately.
- Jim's two answers were n:
  - "Denoise off on both": expected after the failed put-back.
  - "Back in the module": the question came after the put-back, and the put-back's `apply_snapshot` switches to Develop and stays there (`Develop.lua` `applySnapshot`; `bridge.log` line 48175). Fixed: the check now asks it before the put-back.
- The two photos were left with Denoise at 50.

**3. stall:check: WORKED, on the second try** [handle: `%TEMP%\LrC-AVG\stall\stall_check_2026-10-24T16-47-28-778Z.json`, run 5].
- Jim saw no stutter, with the plugin disabled or enabled.
- With the plugin enabled for 120 s:

  | Measure | Run 5 (this branch) | Run 4, 2026-10-18 (main) |
  |---|---|---|
  | Rebinds | 0 | 1 |
  | Stalls | 2 (max 2.4 s, total 3.6 s) | 3 (total 5.8 s) |
  | Slow tends | 0 | 1 (11.9 s) |

  Run 4: [handle: `stall_check_2026-10-18T11-55-04-541Z.json` `phases.plugin_on`].
- LISTENER AFTER RELOAD: YES, in 2 s, with no rebind.
- The Reload retired the old generation ("replaced by a newer start (token file)"). Its receive socket's close then logged one `rebind receive` that nothing acted on: its loop had exited 1.2 s before.
- The first try did not complete because step 1 assumed the plugin was disabled already. Step 1 now tells Jim to disable it in the Plug-in Manager before quitting Lightroom.
- The log confirms that Lightroom on Windows fires the receive socket's `onClosed` when the engine disconnects, whether or not Lightroom is idle: `bridge.log` lines 48126 and 48180 [handle].

### Run 2 (denoise:check only), 2026-10-24 (Jim)

Jim: "Let's go with the second pass as official results" [stated: Jim, 2026-10-24]. Jim ran the check twice, with the fixed check from `e65fe88`.

**Pass 2, the official result: WORKED, put back YES** [handle: `%TEMP%\LrC-AVG\denoise-check\denoise_check_2026-10-24T17-13-45-712Z.json`, `lines`, `put_back`]. The photos were `_DSC1070.ARW` and `_DSC1071.ARW`.

| Step | Answers | Time per photo |
|---|---|---|
| First Denoise, amount 30 | applied, applied | 8.7 s and 10.2 s |
| Amount 30 again | unchanged, unchanged | 2.7 s and 3.4 s |
| Amount 50 | amount_changed on both | 2.5 s and 6.2 s |

- The selection was as it was, and Jim answered y to "Is Lightroom in the module it was in before this check".
- Each photo's first snapshot put its FilterList back as it was before: empty before, `Enhance` after Denoise, empty again after the put-back. Jim answered y to "is Denoise off ... on both".
- `lr_get_preview` by uuid rendered `_DSC1071.ARW` (800 × 533) while it was not the active photo.

**Pass 1: FAILED** [handle: `denoise_check_2026-10-24T17-09-00-151Z.json`]. Jim's note: "the selected files were .arw raw files, and I tested that denoise was available when running manually, but failed on the test" [stated: Jim, 2026-10-24]. The result file names the two photos `DSC00199-Edit.tif` and `DSC00202-HDR.dng`: a TIFF and an HDR merge, which may have been made from ARW files [inference: from the names].
- **`DSC00199-Edit.tif`:** skipped all three times with "Lightroom says Denoise is not available for this photo". Lightroom's Enhance panel state for it had `denoiseEnabled` false [handle: `bridge.log` lines 48241, 48253, 48261]. Nothing was written, as designed. Whether Lightroom offers Denoise on a TIFF at all is [unverified].
- **`DSC00202-HDR.dng`:** applied, then unchanged, then amount_changed, as expected.
- **A bug in this branch's #176 change, now fixed.** The order of events [handle: `bridge.log` lines 48270-48277]:
  1. The preview render of the HDR DNG, just after its Denoise, held Lightroom for 17 s (`stall 17043 ms`).
  2. The engine dropped the connection after 7.4 s without a heartbeat.
  3. The plugin's receive `onClosed` queued a rebind.
  4. The engine reconnected 0.3 s later.
  5. The monitor then ran the queued rebind, which closed the new connection at 10:11:02.791.
  6. The put-back failed with `not_connected: bridge is connecting`, and the HDR DNG was left with Denoise at 50.

  `main` re-arms the socket on that close instead of rebinding, so a reconnect survives there [handle: `git show main:plugin/LrC-AVG.lrplugin/Sockets.lua`, receive `onClosed`]. Fix: receive `onConnected` now cancels a queued rebind (`plugin\LrC-AVG.lrplugin\Sockets.lua`; static test in `engine\tests\lua-plugin.test.ts`). Lightroom has not run the fix: it needs a heartbeat drop to show [unverified].
- A preview right after Denoise can hold Lightroom for long enough to drop the bridge (17 s here). The engine reconnects on its own, but a Claude session sees the call fail [inference: from step 2 above and `engine\src\bridge\client.ts:7`, 3 heartbeats of 2 s].

## Numbers

| Field | Value |
|---|---|
| masks:kinds colour range / brush / depth range | YES / YES / skipped (no depth map) |
| Brush dabs as Lightroom read them back (tokens added or dropped) | identical; none added or dropped |
| denoise:check steps (applied, unchanged, amount_changed) | as expected on 2 of 2 photos (run 2 pass 2) |
| Selection and module put back | YES (harness and Jim, run 2 pass 2) |
| FilterList after Denoise (the live key dump, rule 03) | a filter `Name "Enhance"`, `Title "$$$/CRaw/Filter/Title/Denoise=Denoise"`, with `CompressedSettings`, `Table_<id>`, `Images` (run 1 `filters_after`). Both photos had the same `CompressedSettings` value. |
| Snapshot undid Denoise | YES: FilterList back to empty on 2 of 2 photos (run 2 pass 2) |
| Preview by uuid of a photo not active | YES (800 × 531) |
| stall:check: freezes with the plugin enabled; rebinds logged | none seen by Jim; 2 stalls of at most 2.4 s; 0 rebinds |
| LISTENER AFTER RELOAD | YES, 2 s |

## Verdict

*(Jim's)*

## Consequences / open questions

- **PRD 6.7.** The highlight guard and the `clip_high` limit now act on `clip_high_tone_pct` (two or more channels); `clip_high_pct` (any channel) is still reported. This changes the PRD 6.7 definition, and the vault PRD is to be updated after the verdict.
- **LR_SDK_NOTES.** Record, from the runs:
  - the Enhance filter key names in FilterList (the denoise:check dumps);
  - the depth range's stored form, if a photo with depth data was used;
  - whether `onClosed` fires while idle (the stall:check log).
- **AVG-005 (snapshots for rollback).** Does a snapshot undo AI Denoise (denoise:check "filters_back")?
- **Left on #190** for a later PR: mask tone curve and point color (Automaat #328), one AI mask on many photos (#329), IPTC creator, copyright and location fields (#258, #265), `rename_keyword` (#264), `export_photo_metadata` (#249).
- **Hand-painted brushes.** Lightroom stored Jim's brush on the masks:kinds photo as a compressed `MaskBrushTable`, not as Dabs (run 1). The engine counts any `Mask/Aggregate` as a brush. Whether whole-mask edits (sliders, name, on/off, invert) carry such a brush through unchanged is [unverified]. No check has edited one.
- **The crash in run 1.** Lightroom crashed while Jim made virtual copies, with no bridge command running. Watch for a repeat; the log has nothing more on it.
- **The bridge after a dropped heartbeat.** The fix for the queued rebind (run 2 pass 1) is checked by a static test only [unverified in Lightroom].
- **#165.** This branch adds one tool (36 to 37). A smaller default tool profile stays open.
