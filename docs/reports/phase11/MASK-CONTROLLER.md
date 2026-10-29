---
report: MASK-CONTROLLER
phase: "11"
status: observed
authored_by: "Claude Code (purpose, harness, pre-run findings, steps for Jim; 2026-10-28, branch phase-11/mask-curves-point-color; Observed and Numbers from the results files, 2026-10-29); Jim (the run and its y/n answers, verdict)"
date: 2026-10-29
---

# MASK-CONTROLLER: do mask curves and Point Color written through LrDevelopController show in Lightroom?

## Purpose

GitHub issue #217 row 3 (a mask's local tone curves) and row 4 (Point Color). Jim's `npm run masks:parity` run of 2026-10-28 showed that neither goes through the mask table:

- `point_color`: the swatch written to the table read back exactly as written, but Jim answered **n** to "ONE swatch, sliders about Hue +50, Saturation -50, Luminance +25, Range 80" [handle: `%TEMP%\LrC-AVG\masks-verify\mask_verify_2026-10-28T11-59-26-227Z.json`, step `point_color`].
- `curve_capture`: after Jim dragged the brush mask's curve by hand, the only mask-table field that changed was `CorrectionActive` [handle: same file, step `curve_capture`, `data.changed`]. So the curve is not in the table entry the engine reads [inference].

Upstream writes both through `LrDevelopController` on the mask selected in Develop [upstream claim: Automaat/lightroom-mcp `581ad7c` (#328); `MaskCurves.lua`, `HandlerMaskCurves.lua`, `HandlerMaskPointColors.lua`, `MaskSelection.lua` at `1040453`]. This branch does the same: plugin `MaskControl.lua` and `MaskSwatches.lua` (command `mask_controller`), engine `params\mask-controller.ts` (names and values) and `session\mask-controller.ts` (the pass). The parameter and swatch field names come from Adobe's reference, so under rule 03 as amended on 2026-10-28 they are candidates until this check round-trips them [stated: Jim, 2026-10-28, "it doesn't make sense to restrict this project's functionality because of a semantic rule. Choose what makes THIS project work better."].

The questions: **(1) does a main-curve lift written to a mask brighten its midtones, and does the mask's Curve section show it; (2) the same for the red channel; (3) does a Point Color swatch written through the controller show in the panel with the numbers the engine meant; (4) does `getValue` read back what was written?**

No PHASES.md go rule covers this check. How the answer reads (an inference; the verdict is Jim's): a YES on a step lets that tool's `[unverified]` notes go and makes its names trusted (rule 03); a NO keeps the tool but its text must say so, or it is refused until fixed.

## Harness

`npm run masks:parity -- --part controller` (only this part; a plain `npm run masks:parity` runs the parity part and then this one). Files: `engine\src\devtools\masks-verify-controller.ts` (the steps), `masks-verify-cli.ts` (selection prompt, snapshot, put-back, results), `masks-verify.ts` (shared); test `engine\tests\mask-controller.test.ts`. Results under `%TEMP%\LrC-AVG\masks-verify\` (`mask_verify_<time>.json`, a redacted copy of the plugin log). Needs the plugin with `mask_controller`, version 1.7.0 (`CONTROLLER_PLUGIN` in `engine\src\session\mask-controller.ts`); the check refuses an older one before it writes.

On ONE photo selected in Develop, behind the snapshot "AVG masks:verify before":

1. `radial`: a radial test mask "AVG controller radial" over the middle half of the photo, written to the mask table as the session does (no sliders moved). Asks nothing.
2. `main_curve`: `mask_controller` sets the radial's main curve to (0, 0), (128, 180), (255, 255). One y/n: midtones brighter inside the circle, and the Curve section shows the lift.
3. `red_curve`: the same lift on the red channel. One y/n: inside the circle redder, and the red curve shows the lift.
4. `point_color`: one swatch added through `addPointColorSwatch` (source hue 0.2, saturation 0.6, luminance 0.5; hue shift 0.5, saturation -0.5, luminance 0.25, range 0.8). One y/n, the same question as the parity run's: one swatch, sliders about Hue +50, Saturation -50, Luminance +25, Range 80. The panel's -100..100 for the stored -1..1 is [inference].
5. `read_back`: every curve and the swatches read through `getValue` with no write; asks nothing. Each step also saves what `getValue` gave before and after its write, and whether the photo's settings changed after it (`settled`).

Then the photo is put back from its snapshot (the test mask goes with it).

## Pre-run findings (Claude Code)

- **The calls are in Adobe's reference:** `getAllMasks`, `selectMask`, `getSelectedMask`, `goToMasking` from SDK 11.0; `getValue`, `setValue` from 6.0; `addPointColorSwatch`, `updateSelectedPointColorSwatch`, `deletePointColorSwatch`, `selectPointColorSwatch`, `getSelectedPointColorSwatchIndex` from 13.2, each with `isForMasking`, and addPointColorSwatch's fields `SrcHue` (0-6), `SrcSat`, `SrcLum`, `HueShift`, `SatScale`, `LumScale`, `RangeAmount`, `HueRange`/`SatRange`/`LumRange` of `LowerNone`, `LowerFull`, `UpperFull`, `UpperNone` [handle: `D:\Developer\LightRoom Classic Dev Kit\API Reference\modules\LrDevelopController.html`, SDK 15.2]. `local_Maincurve`, `local_Redcurve`, `local_Greencurve`, `local_Bluecurve` and `local_PointColors` are in its "Localized Adjustments" lists (Version 5 and 6) [same handle].
- **Not in the reference:** what value `setValue` takes for a curve (it documents "(number) the new value"). A flat table of input/output pairs, 2-32 pairs, 0-255, is [upstream claim: `MaskCurves.lua`]. `selectMask` takes the id as its one argument as upstream calls it [upstream claim: `MaskSelection.lua`]; the reference lists `selectMask(id, param)` with `param` described as the id.
- **The plugin names no parameter or field:** the engine sends them, and the plugin takes only `local_*` names [handle: `engine\tests\mask-controller.test.ts` "plugin: mask_controller is a thin adapter"]. The Point Color calls are gated by `Needs.check` (13.2) [handle: `engine\tests\sdk-version-gate.test.ts`].
- **Engine tests** against a stand-in for `mask_controller`: the curve and swatch requests, the pass result's `controller` read-back, `lr_list_masks live_mask_id`, NO_CHANGE, PLUGIN_TOO_OLD, NOT_IN_DEVELOP, and this part's read-back checks [handle: `npx vitest run tests/mask-controller.test.ts` in `engine\`, 2026-10-28, all passed]. A guardrail undo through the controller (a second `mask_controller` writing the values from before) has no test: the simulator's render does not see controller values [inference].
- **The parity part no longer writes a Point Color swatch to the table** (that route is gone); its other steps are unchanged.

## Steps for Jim

Have one photo ready that you have not flipped; a virtual copy is safest. This needs the plugin of version 1.7.0 (this branch after its version bump).

1. Quit Claude Desktop (File > Exit, and its tray icon > Quit).
2. Start Lightroom Classic and switch to Develop. In File > Plug-in Manager, select LrC-AVG and click Reload Plug-in.
3. In PowerShell, in `D:\Developer\LrC_Autonomous_Gateway`, run:

   ```powershell
   npm run masks:parity -- --part controller
   ```

4. When asked, click the photo in the Develop Filmstrip, then type `y` and Enter.
5. For each curve question: in the Masking panel click the mask "AVG controller radial", open its Curve section (for the red question, pick the Red channel in it), look at the photo and the curve, then type `y` or `n` and Enter.
6. For the Point Color question: with "AVG controller radial" selected, open its Point Color section, click the one swatch, read the Hue, Saturation, Luminance and Range sliders, then type `y` or `n` and Enter.
7. You see `Mask verify: WORKED` or `FAILED`, then `put back: YES` or `NO`. Tell Claude Code "done".

### If something goes wrong

- If it says "photo(s) selected, not 1": select one photo and run the command again.
- If it says "reload the LrC-AVG plugin 1.7.0": File > Plug-in Manager, LrC-AVG, Reload Plug-in, then run the command again.
- If a step's line says "Develop module": switch Lightroom to Develop (press D), then run the command again.
- If `put back: NO`: in Develop, select the photo, open the Snapshots panel (left) and click "AVG masks:verify before".

## Observed (Jim)

Filled by Claude Code from the results files and Jim's y/n answers in them, 2026-10-29; the answers are Jim's observations. Jim ran `npm run masks:parity -- --i-know` (the parity part, then this one) as check 4 of the 1.7.0 batch (`BATCH-1.7.0-CHECKS.md`) on his usual catalog [stated: Jim, 2026-10-29, "Check 4, 5 and 6 done."]. Engine and plugin 1.7.0, Lightroom Classic 15.6 [handle: `docs\reports\phase11\MASK-PARITY\run2\mask_verify_2026-10-29T00-49-50-394Z.json`, `engine_version`, `plugin_version`, `lrc_version`]. Times are UTC from the file names.

- 00:48:00: this part stopped before writing, with the parity part: `_DSC0091.NEF` read BA, "flipped (BA): nothing written" [handle: `run2\mask_verify_2026-10-29T00-48-00-676Z.json`, `steps[1]`]. MASK-PARITY.md, run 2, has the rest.
- 00:49:50: this part ran on **`_DSC0091-Rendered.dng`** (uuid `265547B3-3C01-47AE-96B4-835D449A8AEC`, orientation AB), not on the parity part's `_DSC0091.NEF` [handle: the 00:49:50 file, `photos[1]`]. Its steps [handle: the same file, `steps[5-9]`]:

1. `radial`: "AVG controller radial" written: YES (no question).
2. `main_curve`: `local_Maincurve` set to (0, 0), (128, 180), (255, 255): **Jim y**. `getValue` before `[0, 0, 255, 255]`, after `[0, 0, 128, 180, 255, 255]`; the other three curves stayed `[0, 0, 255, 255]`; `settled` true; 534 ms.
3. `red_curve`: `local_Redcurve` set to the same lift: **Jim y**. `getValue` after `[0, 0, 128, 180, 255, 255]`, the main curve still lifted, green and blue flat; `settled` true; 523 ms.
4. `point_color`: one swatch through `addPointColorSwatch` (`local_PointColors`): **Jim y** (one swatch, sliders about Hue +50, Saturation -50, Luminance +25, Range 80). `getValue` after: one swatch, `SrcHue` 0.2, `SrcSat` 0.6, `SrcLum` 0.5, `HueShift` 0.5, `SatScale` -0.5, `LumScale` 0.25, `RangeAmount` 0.8, `Variance` 0, `HueRange` 0 / 0.333333 / 0.666667 / 1, `SatRange` 0 / 0.42 / 0.78 / 1, `LumRange` 0.005357 / 0.555357 / 0.915357 / 1 (LowerNone / LowerFull / UpperFull / UpperNone); `settled` true; 592 ms.
5. `read_back`: no write; before and after the same: main and red curves lifted, green and blue flat, the one swatch as in step 4: YES. `settled` false (nothing was written to settle).

The file has no `put_back` step and no put-back line in `lines`; the run's headline FAILED comes from the parity part's three NO steps [handle: the file, `lines`, `headline`]. The test radial goes with the snapshot put-back (Harness): the controller part's snapshot was taken at 17:51:54 and applied at 17:52:58 local time [handle: `docs\reports\phase11\MASK-PARITY\run2\bridge_log_excerpt_2026-10-28T17-48.txt`]; that it put the photo back whole is [inference].

## Numbers

| Field | Value |
|---|---|
| Lightroom version / plugin version | 15.6 / 1.7.0 |
| Photo | `_DSC0091-Rendered.dng` (uuid `265547B3-...`), orientation AB |
| `radial` written | YES |
| `main_curve` YES/NO; `getValue` after | YES (Jim y); `[0, 0, 128, 180, 255, 255]` |
| `red_curve` YES/NO; `getValue` after | YES (Jim y); `[0, 0, 128, 180, 255, 255]` |
| `point_color` YES/NO; slider readings if NO; `getValue` after | YES (Jim y); one swatch, SrcHue 0.2, SrcSat 0.6, SrcLum 0.5, HueShift 0.5, SatScale -0.5, LumScale 0.25, RangeAmount 0.8 |
| `read_back`: curves and swatches as read | main and red lifted, green and blue flat, one swatch as written: YES |
| `settled` after each write (did the photo's settings change) | true, true, true (`read_back`, no write: false) |
| Put back: YES/NO | not in the file |

[handle: `docs\reports\phase11\MASK-PARITY\run2\mask_verify_2026-10-29T00-49-50-394Z.json`, `steps[5-9]`]

## Verdict

(blank: Jim's)

## Consequences / open questions

- YES on all: the names in `engine\src\params\mask-controller.ts` count as round-tripped (rule 03); the `[unverified]` notes in `defs-masks.ts`, `mask-controller.ts` and `docs\PARITY.md` go.
- `settled` false after a write: Lightroom keeps the local curve outside `getDevelopSettings()`, so a session's revert through History or a snapshot may not undo it; that would need its own check [unverified].
- **The 2026-10-29 run answered YES on all five steps**, on one photo (`_DSC0091-Rendered.dng`), with `getValue` reading back what was written and `settled` true after each write (Observed). Under the first line above, that is the round trip rule 03 asks for; whether it is enough on one photo is Jim's call (Verdict).
- `settled` true after every write: the photo's settings changed after each controller write, so the curves and swatch reached the settings the snapshot and History hold [inference: what `settled` measures, `plugin\LrC-AVG.lrplugin\MaskControl.lua:22`]. The parity part of the same run found a hand-dragged mask curve in the mask table as `MainCurve` (`MASK-PARITY.md`, run 2). That a snapshot put-back removes a controller-written curve is not shown: the file records no put-back [unverified].
- The swatch's `HueRange`, `SatRange`, `LumRange` and `Variance` read back as listed in Observed; whether the engine sent them or Lightroom filled them is not in the file.
- Still [unverified] after this check: `update`, `delete` and `clear` of swatches (only `add` is asked), the green and blue curves, the guardrail undo through the controller, and Lightroom's own History step names for these writes.
