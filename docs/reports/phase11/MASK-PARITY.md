---
report: MASK-PARITY
phase: "11"
status: observed
authored_by: "Claude Code (purpose, harness, pre-run findings, steps for Jim; 2026-10-27, night run on branch phase-11/masks-217; Observed and Numbers from the results file, the suggested verdict, findings, 2026-10-28); Jim (the run and its y/n answers, the decisions, the verdict)"
date: 2026-10-28
---

# MASK-PARITY: do the issue #217 mask rows do in Lightroom what the engine writes?

## Purpose

GitHub issue #217 (epic #207) ports upstream's mask tools that LrC-AVG lacked. Built on branch `phase-11/masks-217` (on top of #210's `phase-11/masks-210`), tested against the Lightroom simulator and Lightroom-authored captures only:

| Row | Tool | What the engine writes |
|---|---|---|
| 1 | `lr_delete_empty_masks` | Lightroom's own `catalog:deleteAllEmptyMasks` per photo, snapshot first (plugin `MaskClean.lua`) |
| 2 | `lr_edit_mask` `copy: true` | An inverted copy of a one-part mask, on the mask table (`engine\src\params\mask-copy.ts`) |
| 3 | local tone curves | **Not built (parked):** no capture shows the field Lightroom stores a mask's curve in; this check captures it |
| 4 | `lr_edit_mask` `point_colors` | Point Color swatches as `LocalPointColors` strings in upstream's field order (`mask-point-colors.ts`) |
| 5 | brush `feather`, `density`, `erase`, strokes added | Upstream's feather curve, MaskValue for density and erase (`mask-brush.ts`) |

The questions: **(1) does each written form draw as asked; (2) does the Point Color panel show the swatch numbers the engine meant (the 19-number order); (3) which correction fields does Lightroom write for a local curve?**

Acceptance (issue #217): "Each row implemented with tests against `docs/reports/phase8.5/mask-carry/` captures; Jim runs `masks:kinds`/`masks:combine` extensions; report." No PHASES.md go rule covers this check. How the answer reads (an inference; the verdict is Jim's): a YES on a step lets that row's [unverified] tool notes go; a NO on `point_color` means the stored order is wrong and `point_colors` must be refused until fixed; `curve_capture` with changed fields gives row 3 its field names (rule 03).

## Harness

`npm run masks:parity` (the same as `npm run masks:verify -- --part parity`). Files: `engine\src\devtools\masks-verify-parity.ts` (the steps), `masks-verify-cli.ts` (selection prompt, snapshot, put-back, results), `masks-verify.ts` (shared); test `engine\tests\masks-verify-parity.test.ts`. Results under `%TEMP%\LrC-AVG\masks-verify\` (`mask_verify_<time>.json`, a redacted copy of the plugin log). Needs the plugin of this branch (it has `delete_empty_masks`); step 5 fails on an older one, the rest run.

On ONE photo, behind the snapshot "AVG masks:verify before", each step writing the photo's masks as they were plus the test masks (+2 EV on the brush):

1. `brush_feather_density`: a brush of three strokes across the photo, at 30 %, 50 % and 70 % down: feather 100 (soft), feather 0 (hard), density 0.4. One y/n.
2. `brush_erase_added`: an erase stroke added down the middle of that brush. One y/n.
3. `inverted_copy`: an inverted copy of the brush beside it, at -2 EV (from 2026-10-28; before, +2 EV like the brush). One y/n: the top and middle bands brighter, the rest darker.
4. `delete_empty_masks`: the plugin command on the photo; asks nothing; recorded: status and the mask count before and after (the test masks must stay). Whether Lightroom deletes a mask that really is empty stays [unverified]: no step makes one. A status `deleted` leaves a snapshot "AVG masks:parity empty" on the photo.
5. `curve_capture`: Jim drags the middle of the brush mask's Curve up; the step saves every correction field that changed (no y/n).

Then the photo is put back from its snapshot. The 2026-10-28 run had a third step, `point_color` (one swatch written to the table); it is gone from branch `phase-11/mask-curves-point-color` on, because Point Color and local curves now go through LrDevelopController, checked by the controller part (`docs\reports\phase11\MASK-CONTROLLER.md`), which a plain `npm run masks:parity` runs after this part.

## Pre-run findings (Claude Code)

- **No capture holds a mask's local tone curve.** A search of every JSON under `docs\reports` finds only `LocalCurveRefineSaturation` [handle: `grep -rhoi '"[A-Za-z_]*curve[A-Za-z_]*"' docs/reports --include=*.json`, 2026-10-27]. Upstream's schema names `MainCurve`, `RedCurve`, `GreenCurve`, `BlueCurve` on the correction [upstream claim: `GuardedMaskWrite.lua:36-42` at `1040453`], and its tools write curves through `LrDevelopController.setValue("local_Maincurve", ...)`, never the table [upstream claim: `HandlerMaskCurves.lua`]. Rule 03 takes key names only from a live dump, so row 3 waits for step 6.
- **Lightroom stores Point Color swatches as strings of 19 numbers:** Jim's "Mountains" mask holds two [handle: `docs\reports\phase8\probes\kinds.json`, `-Rendered.dng` `MaskGroupBasedCorrections[0].LocalPointColors`]. Read in upstream's field order they give HueRange 0, 0.33, 0.67, 1, as the global swatch of the same dump stores by name [inference]; the engine writes Lightroom's two back verbatim [handle: `engine\tests\params-mask-point-colors.test.ts`].
- **Jim's hand-painted brush** stores `CenterWeight` 0.362855 with the dab token `h 0.3629`, after `f 0.5840` [handle: `docs\reports\phase8.5\mask-carry\mask_carry_2026-10-11T22-37-39-161Z.json` "Brush"]; the engine writes `f` then `h` the same way [handle: `engine\tests\params-mask-brush-feather.test.ts`].
- **`catalog:deleteAllEmptyMasks`** is from SDK 14.0 and deletes from all target photos when given none [handle: `D:\Developer\LightRoom Classic Dev Kit\API Reference\modules\LrCatalog.html:861-870`]; the plugin always passes the photo and checks the call exists first [handle: `engine\tests\sdk-version-gate.test.ts`].
- Engine tests for each row: `mask-empty.test.ts`, `session-masks-invert-copy.test.ts`, `params-mask-point-colors.test.ts`, `params-mask-brush-feather.test.ts` [handle: `npm test` on branch `phase-11/masks-217`].

## Steps for Jim

Have one photo ready that you have not flipped; a virtual copy is safest.

1. Quit Claude Desktop (File > Exit, and its tray icon > Quit).
2. Start Lightroom Classic and switch to Develop. In File > Plug-in Manager, select LrC-AVG and click Reload Plug-in.
3. In PowerShell, in `D:\Developer\LrC_Autonomous_Gateway`, run:

   ```powershell
   npm run masks:parity
   ```

4. When asked, click the photo in the Filmstrip, then type `y` and Enter.
5. For each question, look at the photo in Lightroom, then type `y` or `n` and Enter.
6. For the curve step: with "AVG parity brush" still selected, open its Curve section, drag the middle of the curve up a little, then type `y`.
7. The controller part follows on the same photo: its steps are in `docs\reports\phase11\MASK-CONTROLLER.md` (Steps for Jim, from its step 4).
8. You see `Mask verify: WORKED` or `FAILED`, then `put back: YES` or `NO`. Tell Claude Code "done".

### If something goes wrong

- If it says "photo(s) selected, not 1": select one photo and run `npm run masks:parity` again.
- If it says "reload the LrC-AVG plugin": File > Plug-in Manager, LrC-AVG, Reload Plug-in, then run the command again.
- If the `delete_empty_masks` line names an unknown command: the plugin loaded is not this branch's; Reload Plug-in and run again.
- If the mask's Curve section is not there: type `n` at the curve step; the rest of the run still counts.
- If `put back: NO`: in Develop, select the photo, open the Snapshots panel (left) and click "AVG masks:verify before".

## Observed (Jim)

Filled by Claude Code from the results file and Jim's y/n answers in it, 2026-10-28; the answers are Jim's observations [stated: Jim, 2026-10-28, "Checks done."]. One run, `npm run masks:parity`, 04:59-05:02 local, on `_DSC0103.NEF`, engine 1.6.0 [handle: `docs\reports\phase11\MASK-PARITY\mask_verify_2026-10-28T11-59-26-227Z.json`; its plugin log lines in `docs\reports\phase11\MASKS-VERIFY\mask_verify_bridge_log_excerpt_2026-10-28.txt`, 04:59:26-05:02:50]. The file keeps no Lightroom or plugin version (recorded from now on); `perf:check` 25 minutes earlier read Lightroom Classic 15.6 and plugin 1.6.0 [handle: `docs\reports\phase11\PERF\after\perf_after_2026-10-28T11-34-08-350Z.json`]. The photo had no masks before the run (2 masks, both the run's, at step 5).

1. `brush_feather_density`: a brush of 3 strokes, 368 dabs, read back as written: **Jim y**.
2. `brush_erase_added`: 4 strokes, 463 dabs, read back as written: **Jim y**.
3. `point_color`: one swatch written and read back as written (src hue 0.2, sat 0.6, lum 0.5; hue shift 0.5, saturation -0.5, luminance 0.25, range 0.8): **Jim n** (the panel did not show one swatch at Hue +50, Saturation -50, Luminance +25, Range 80). The results file keeps no slider readings.
4. `inverted_copy`: **Jim y** ("a new mask that brightens everything EXCEPT the bands, the first mask still there"), but the step was marked NO: both "AVG parity brush" and "AVG parity brush inverted" read back different from what was written. The file does not say which field.
5. `delete_empty_masks`: status `unchanged`, 2 masks before and 2 after, the test masks kept: YES (no question).
6. `curve_capture`: Jim dragged the brush mask's curve; the one correction field that changed was `CorrectionActive` (to `true`). No curve field appeared.

Put back from the snapshot: YES (no `put_back` step; `apply_snapshot` at 05:02:50.590 in the log excerpt).

## Numbers

| Field | Value |
|---|---|
| Lightroom version / plugin version | not in the file; 15.6 / 1.6.0 in `perf:check` that morning |
| `brush_feather_density` YES/NO; read-back problems | YES; none |
| `brush_erase_added` YES/NO | YES |
| `point_color` YES/NO; slider readings if NO | **NO** (Jim n); not recorded |
| `inverted_copy` YES/NO | Jim y; the step NO: both masks read back different (fields not recorded) |
| `delete_empty_masks`: status; masks before / after | unchanged; 2 / 2 |
| `curve_capture`: fields changed and their values | `CorrectionActive`: true; no curve field |
| Put back: YES/NO | YES |

## Verdict

(blank: Jim's.) **Suggested by Claude Code, a suggestion only:** row 5 (brush feather, density, erase, strokes added) go; row 1 (`lr_delete_empty_masks`) go for "runs and keeps the test masks", what it deletes still [unverified]; row 4 (Point Color) no-go as written; row 2 (inverted copy) open: rerun with the fixed step below; row 3 (curves) no field found by the table route.

## Consequences / open questions

- **Point Color (row 4) and local curves (row 3) go to another track.** `point_color` was NO (Jim n), and `curve_capture` found no curve field in the mask table, only `CorrectionActive`. The LrDevelopController route for both is being built on branch `phase-11/mask-curves-point-color`; this branch does not change Point Color or mask-curve code.
- **The inverted copy's NO.** The comparison was not missing anything written earlier: each step writes the table the step before wrote (`masks-verify-parity.ts` `write`, `h.table = plan.entries`), the copy carries the brush's Point Color swatch, and step 3's read-back of that same swatch had no problems [handle: the results file, `point_color` `notes` []]. What the file does show: right after the copy step, the brush's `CorrectionActive` read back as not `true`, and only Jim's touch in the panel at step 6 made it `true` again [handle: the file, `curve_capture` `changed`; nothing was written between, `delete_empty_masks` reported `unchanged`]. So Lightroom read the brush back with `CorrectionActive` not as written, and likely the copy too [inference]. Why is [unverified]: Jim had the Masking panel open on that brush at step 3, and the effect of that on a table write is unknown. The step's question was also weak: at +2 EV each, the brush and its inverted copy brighten the whole photo about alike, so "everything EXCEPT the bands" could only show with the brush off [inference], which fits `CorrectionActive` reading false.
- **Fixed on branch `fix/phase11-check-followups`:** the copy is written at -2 EV and the question asks for the top and middle bands brighter and the rest darker; a mask that reads back different now names the differing fields in the step's notes [handle: `engine\tests\masks-verify.test.ts` "names the fields of a mask that reads back different", `engine\tests\masks-verify-parity.test.ts`]. Whether `lr_edit_mask` `copy: true` reads back as written in a session, with no panel open, is [unverified] until a rerun of `npm run masks:parity`.
- **Mask guard: Jim's decision** [stated: Jim, 2026-10-28, "Go with recommendation"]: keep ours (named History step, read-back, MASKS_CHANGED, revert) and add upstream's Lightroom-version check as a warning only. Upstream writes mask geometry only on Lightroom Classic 15.6 and refuses any other [upstream claim: Automaat/lightroom-mcp 1040453, `plugin\LightroomMCP.lrplugin\GuardedMaskWrite.lua:8`, `:385-392`]; every kept mask pass now carries the warning "Masks were checked in Lightroom Classic 15.6 only, and this is <version>: look at the mask in Lightroom" on any other version [handle: `engine\src\bridge\lightroom.ts` `maskVersionWarnings`; `engine\tests\lrc-baseline.test.ts`, `engine\tests\session-masks-crop.test.ts`]. Upstream's process-version check (15.4 only) was not ported: ours refuses legacy process versions already (ARCHITECTURE section 5) [inference: a newer process version is not refused here].
- Still [unverified] after this check: what Lightroom counts as an empty mask; an inverted copy of an AI mask; feather values between 0 and 100.
