---
report: CROP-SPIKE
phase: "11"
status: template
authored_by: "Claude Code (Opus 5.5): purpose, harness, pre-run findings, steps, 2026-10-29. Jim: the run, his answers, Verdict (blank)."
date: 2026-10-29
---

# Crop and straighten through lr_set_develop_settings (issue #115 feasibility spike)

## Purpose

Issue #115 ("Enhancement: crop, straighten and geometry tools"), "Feasibility (spike first)": "Whether the SDK's develop-settings path can read/write crop and geometry must be verified per LR_SDK_NOTES. If it cannot, close with the evidence recorded and the limitation documented with a handle."

The question: does Lightroom Classic take a crop (`CropLeft`/`CropRight`/`CropTop`/`CropBottom`) and a straighten (`CropAngle`) written through the engine's existing `lr_set_develop_settings` (decision D1 of epic #207, the SDK-key passthrough, `engine\src\params\sdk-passthrough.ts`), with no plugin change, and does the photo then look cropped and turned? This spike builds no `lr_crop` tool.

**Go rule** (PHASES.md has none for an issue spike; proposed [inference]): **go** (an `lr_crop` tool can be built on this path) when the spike says WORKED: both writes answer `set`, read back as written, the crop render's aspect changes as the crop says, and Jim answers y to both questions. **Conditional** when the crop works and the straighten does not (an `lr_crop` without straighten, or straighten needs another path). **No-go** when the crop write is not taken or does not show.

## Harness

`npm run crop:spike` (`engine\src\devtools\crop-spike-cli.ts`; the shared `step` in `develop-check.ts`, `ask` in `mask-carry-probe.ts`). It calls the engine's tool functions (the `Tools` class, as Claude Desktop does), so `lr_set_develop_settings`'s own checks run (pinned keys only, read back, put back from its snapshot when a key is not taken). Results and three renders go to `%TEMP%\LrC-AVG\crop-spike\crop_spike_<time>.json` and `crop_spike_<time>_{1-before,2-crop,3-straighten}.jpg`. Commands and prerequisites: `.claude\skills\lrc-avg-checks\SKILL.md`.

What it does, in order (the selected photo is only read; every write goes to the spike's own copy):
1. Reads the one selected photo's Develop settings and its crop keys (every key starting `Crop`).
2. `lr_create_virtual_copies`: copy "AVG crop-spike". Only the uuid this call answers is ever removed.
3. Renders the copy (`export_preview`, long edge 1024).
4. `lr_set_develop_settings` on the copy: `CropLeft` 0.1, `CropRight` 0.9, `CropTop` 0.2, `CropBottom` 0.8 (80 % of the width by 60 % of the height, so the aspect changes; the same crop as S7). Expects `set`; the crop keys are read back.
5. Renders the copy; its aspect over step 3's should be 0.8 / 0.6 (or the inverse on a photo Lightroom turns a quarter) within 3 % [inference: `engine\src\params\crop-frame.ts` header, the keys are fractions of the stored photo].
6. `lr_set_develop_settings` on the copy: `CropAngle` 5 alone. Expects `set`; the crop keys are read back (whether Lightroom refits the corners for the angle is what the read-back shows).
7. Renders the copy; selects the copy in Lightroom (`select_photo`), and asks Jim two y/n questions in the PowerShell window.
8. `lr_remove_photos` on the copy, looked up again; Jim's photo selected again; its settings compared with step 1.

The plugin needs no change: `set_develop_settings` is in plugin 1.7.0 (`plugin\LrC-AVG.lrplugin\DevelopTools.lua` `setSettings`). This spike, like `develop-catalog:check`, writes only to its own virtual copy, so it has no throwaway-catalog guard.

## Pre-run findings (Claude Code)

- The pinned raw dump has `CropLeft`, `CropRight`, `CropTop`, `CropBottom`, `CropAngle`, `CropConstrainToWarp` and `CropConstrainToUnitSquare`, all type number or boolean, so `lr_set_develop_settings` passes them as unranged keys [handle: `engine\src\params\sdk-keys.lrc15.json`, `grep -o '"Crop[A-Za-z]*"'`, 2026-10-29; `engine\src\params\sdk-passthrough.ts` `sdkPassthrough`]. No canonical name holds a crop key [handle: `engine\src\params\canonical.ts`, no `Crop` key besides `PostCropVignette*`]. There is no `HasCrop` key in either dump; `CropConstrainAspectRatio` is in the rendered dump only [handle: `engine\src\params\sdk-keys.lrc15.rendered.json`; LR_SDK_NOTES "Recorded in Phase 8 — 2026-10-09, the rendered pipeline": "`CropConstrainAspectRatio` (a cropped copy)"].
- **A crop written by SDK key was already taken once, through the plugin's `apply_settings` path, not this tool:** S7 wrote `CropLeft 0.1, CropRight 0.9, CropTop 0.2, CropBottom 0.8, CropAngle 0` on a virtual copy, read back as written, `croppedDimensions` 6605 × 3302, `isCropped` true, on two NEFs [handle: `docs\reports\phase4\S7.md` lines 53, 171-173].
- **A non-zero `CropAngle` was already written and read back,** CropAngle 10 with corners shrunk to stay on the photo, through `apply_settings` [handle: `docs\reports\phase9\issue179.md` "Case B", lines 40, 99, 125; `engine\src\devtools\mask-crop-run.ts` `turnCrop`]. Writing only the angle, as this spike does, leaves the corners possibly off the photo; whether Lightroom then refits them is [unverified] (`mask-crop-run.ts` `turnCrop` comment).
- `CropAngle` written through `applyDevelopSettings` may give another crop than the Develop crop tool's straighten does [community] [handle: https://community.adobe.com/questions-675/api-difference-between-cropangle-and-straightenangle-958893].
- Checks run on the branch before the push: `npm run build`, `npm run typecheck`, `npm run arch:check` (no violations). The spike itself was not run by Claude Code (it needs Lightroom).

## Steps for Jim

1. In Lightroom Classic, Library module (G), select ONE raw photo in the grid (Version 6, the current process version).
2. Quit Claude Desktop (File > Exit, or the tray icon > Quit).
3. In PowerShell:
   ```powershell
   Set-Location D:\Developer\LrC_Autonomous_Gateway
   npm run crop:spike
   ```
4. Do not click in Lightroom while it runs. When the questions come, look at Lightroom's Develop module, which shows the copy "AVG crop-spike", and type y or n then Enter for each.
5. Wait for "Crop and straighten spike: WORKED" (or FAILED) and "put back: YES", then tell Claude Code "done".

### If something goes wrong

- If it says "reload the LrC-AVG plugin": File > Plug-in Manager, LrC-AVG, Reload Plug-in, then run step 3 again.
- If it says "select ONE raw photo": do step 1 again, then step 3.
- If it says "put back: NO": select the copy "AVG crop-spike" in the Library grid, Photo > Remove Photos..., Remove.

## Observed (Jim)

*(blank: filled from the results file and Jim's answers after the run)*

## Numbers

| Field | Value |
|---|---|
| Crop write status / read back as written | |
| Crop keys read back after the crop | |
| Render aspect before / after the crop (ratio) | |
| Straighten write status / read back as written | |
| Crop keys read back after the straighten | |
| Jim: tighter crop shown (y/n) | |
| Jim: turned about 5 degrees (y/n) | |
| Copy removed / selection back / photo unchanged | |

## Verdict

*(blank: Jim)*

## Consequences / open questions

- On go: an `lr_crop` tool (issue #115 "Proposal") is a later decision for Jim; its session contract has to say how a crop changes regions, metrics and mask coordinates (issue #115 "Design note"; `engine\src\params\crop-frame.ts` already maps masks through a crop).
- Whether Lightroom refits the corners when only `CropAngle` is written stays [unverified] until the read-back of step 6.
