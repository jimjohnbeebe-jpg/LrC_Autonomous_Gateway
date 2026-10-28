---
report: MASK-PARITY
phase: "11"
status: template
authored_by: "Claude Code (purpose, harness, pre-run findings, steps for Jim; 2026-10-27, night run on branch phase-11/masks-217); Jim (Observed, verdict)"
date: 2026-10-27
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
3. `point_color`: one swatch on the brush (hue shift 0.5, saturation -0.5, luminance 0.25, range 0.8). Jim opens the mask's Point Color and reads the sliders. One y/n. The panel's -100..100 for the stored -1..1 is [inference].
4. `inverted_copy`: an inverted copy of the brush beside it. One y/n.
5. `delete_empty_masks`: the plugin command on the photo; asks nothing; recorded: status and the mask count before and after (the test masks must stay). Whether Lightroom deletes a mask that really is empty stays [unverified]: no step makes one. A status `deleted` leaves a snapshot "AVG masks:parity empty" on the photo.
6. `curve_capture`: Jim drags the middle of the brush mask's Curve up; the step saves every correction field that changed (no y/n).

Then the photo is put back from its snapshot.

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
6. For the Point Color question: in the Masking panel click the mask "AVG parity brush", open its Point Color section, click the one swatch, read the Hue, Saturation, Luminance and Range sliders, then answer.
7. For the curve step: with "AVG parity brush" still selected, open its Curve section, drag the middle of the curve up a little, then type `y`.
8. You see `Mask verify: WORKED` or `FAILED`, then `put back: YES` or `NO`. Tell Claude Code "done".

### If something goes wrong

- If it says "photo(s) selected, not 1": select one photo and run `npm run masks:parity` again.
- If it says "reload the LrC-AVG plugin": File > Plug-in Manager, LrC-AVG, Reload Plug-in, then run the command again.
- If the `delete_empty_masks` line names an unknown command: the plugin loaded is not this branch's; Reload Plug-in and run again.
- If the mask's Curve section is not there: type `n` at the curve step; the rest of the run still counts.
- If `put back: NO`: in Develop, select the photo, open the Snapshots panel (left) and click "AVG masks:verify before".

## Observed (Jim)

(blank: filled from the run's results file and Jim's answers)

## Numbers

| Field | Value |
|---|---|
| Lightroom version / plugin version | |
| `brush_feather_density` YES/NO; read-back problems | |
| `brush_erase_added` YES/NO | |
| `point_color` YES/NO; slider readings if NO | |
| `inverted_copy` YES/NO | |
| `delete_empty_masks`: status; masks before / after | |
| `curve_capture`: fields changed and their values | |
| Put back: YES/NO | |

## Verdict

(blank: Jim's)

## Consequences / open questions

- Row 3 (local curves) and row 7 (one AI mask on many photos) are not built; the guard design (upstream's LrC-version gate and schema check on every existing mask entry) is Jim's decision. All three are in the PR description, "Decisions for Jim".
- `point_color` NO: refuse `point_colors` writes until the order is fixed from the slider readings; reading Lightroom's own swatches back stays.
- Still [unverified] after this check: what Lightroom counts as an empty mask; an inverted copy of an AI mask (no step makes one: the brush stands for every kind not computed by Lightroom [inference]); feather values between 0 and 100.
