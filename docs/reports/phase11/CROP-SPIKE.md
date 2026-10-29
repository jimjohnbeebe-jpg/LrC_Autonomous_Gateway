---
report: CROP-SPIKE
phase: "11"
status: observed
authored_by: "Claude Code (Opus 5.5): purpose, harness, pre-run findings, steps, 2026-10-29; Observed and Numbers from the results files, 2026-10-29. Jim: the runs, his answers, the removal of run 1's copy. Verdict: from the session brief, for Jim to confirm."
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
- If it says "select a photo that is not straightened": select another raw photo (its Crop tool Angle at 0) in step 1, then step 3. (Added after the run, for Greptile's review of PR #258: a start angle other than 0 would make the aspect check unreliable [inference]; a photo already cropped is now allowed, and the expected aspect is taken from its crop.)
- If it says "put back: NO": select the copy "AVG crop-spike" in the Library grid, Photo > Remove Photos..., Remove.

## Observed (Jim)

Filled by Claude Code from the results files, 2026-10-29; the y/n answers in them are Jim's. Jim ran `npm run crop:spike` twice after the 1.7.2 reruns (`BATCH-1.7.0-CHECKS.md`). Engine and plugin 1.7.2, Lightroom Classic 15.6, both runs [handle: `docs\reports\phase11\CROP-SPIKE\run1\`, both `crop_spike_*.json`, `engine_version`, `plugin_version`, `lrc_version`]. Times are UTC from the file names (Jim's local time is UTC-7).

**Run 1, 11:49:53: FAILED from a harness bug, before any write.** On `20250413-_OZ81430.NEF` (uuid `2E4A9191-A6D0-4293-BC9B-AD3CFC68D6F0`), `lr_create_virtual_copies` answered `copied`; recording that step then threw "Cannot set properties of undefined (setting 'lr_create_virtual_copies')", because the harness never set `results` [handle: `run1\crop_spike_2026-10-29T11-49-53-414Z.json`, `steps`, no `results` key]. The run then said "no virtual copy was made" and `copy_left` null, though the copy existed [handle: the same file, `errors`, `copy_left`; the plugin log has `copy_photo: 2E4A9191-... copied ()` at 04:49:54.385 local, `%TEMP%\LrC-AVG\bridge.log` line 58240, not copied into the repo]. Nothing was written to the copy (no `set_develop_settings` line follows in the log). Jim removed the copy by hand [stated: Jim, 2026-10-29, through the session brief]. Fixed in `fe94322` (the harness sets `results` before the first step).

**Run 2, 12:06:15: WORKED**, on `20250413-_OZ81430.NEF` (uuid `23B201BF-A39A-44C6-839B-E13D4C0EA70D`, another photo of that file name than run 1's) [handle: `run1\crop_spike_2026-10-29T12-06-15-398Z.json`, `photo`, `headline`]. In order [handle: the same file, `results`, `read_back`, `renders`, `lines`, `answers`]:

1. `lr_create_virtual_copies`: copy "AVG crop-spike" (`0D10B838-EF29-4506-8BEB-A6FB1BFF9300`), `copied`. The start crop: `CropLeft` 0, `CropRight` 1, `CropTop` 0, `CropBottom` 1, `CropAngle` 0, `CropConstrainToUnitSquare` 1, `CropConstrainToWarp` 0 (`crop_before`).
2. Render before: 1024 × 683, aspect 1.499.
3. `lr_set_develop_settings` crop (`CropLeft` 0.1, `CropRight` 0.9, `CropTop` 0.2, `CropBottom` 0.8): `set`, the four keys `unranged`, snapshot "AVG pre-set 873d1d", History name "AVG set develop settings 873d1d", 3,018 ms. Read back as written: YES (0.1, 0.9, 0.2, 0.8; `CropAngle` 0).
4. Render after the crop: 1024 × 512, aspect **2.0**; the spike's expected ratio 1.499 × 0.8 / 0.6 = 1.999 [inference: arithmetic], within 3 %: YES.
5. `lr_set_develop_settings` `CropAngle` 5: `set`, `unranged`, snapshot "AVG pre-set 40ae5c", 2,811 ms. Read back as written: YES. **The four corners read back unchanged** (0.1, 0.9, 0.2, 0.8) with `CropAngle` 5.
6. Render after the straighten: 1024 × 405, aspect **2.528**.
7. Jim's answers: **y, y** (the tighter crop shown; the photo turned about 5 degrees) [handle: the file, `answers`].
8. `lr_remove_photos` on the copy: `removed`, the copy gone; Jim's photo selected again; its settings against the start: back. `copy_left` null.

The three renders stay on Jim's disk, not in this public repo [inference: `.gitignore`, "renders of Jim's photos: on disk only, never in the public repo" (Phase 3 decision 3, written for the golden JPEGs)]; their SHA-256 and sizes, from `sha256sum` and sharp's `metadata()` run by Claude Code on 2026-10-29 in `%TEMP%\LrC-AVG\crop-spike\`:

| Render | Size | SHA-256 |
|---|---|---|
| `crop_spike_2026-10-29T12-06-15-398Z_1-before.jpg` | 1024 × 683 | `0ca19764dd514fbcaaf1635407d887e24b24f6f6175dfeca064d9633cf342303` |
| `crop_spike_2026-10-29T12-06-15-398Z_2-crop.jpg` | 1024 × 512 | `2f88adf2885e685d7d1570b85048e937d9ec0cf800e26727e1a279e2bdfe824d` |
| `crop_spike_2026-10-29T12-06-15-398Z_3-straighten.jpg` | 1024 × 405 | `3de988f6b8c8e10b995517ae2aa9325dabe03e0703e4e1916b056c56da78cddb` |

The vault copy of this report keeps the three files in `Reports\Phase11\CROP-SPIKE\run1\`.

## Numbers

| Field | Value |
|---|---|
| Lightroom version, plugin, engine | 15.6, 1.7.2, 1.7.2 |
| Headline, put back | run 1 FAILED (harness bug; copy left, removed by Jim); run 2 WORKED, copy removed |
| Crop write status / read back as written | `set` / YES |
| Crop keys read back after the crop | `CropLeft` 0.1, `CropRight` 0.9, `CropTop` 0.2, `CropBottom` 0.8, `CropAngle` 0 |
| Render aspect before / after the crop (ratio) | 1.499 / 2.0 (ratio 1.334; 0.8 / 0.6 = 1.333) |
| Straighten write status / read back as written | `set` / YES |
| Crop keys read back after the straighten | `CropLeft` 0.1, `CropRight` 0.9, `CropTop` 0.2, `CropBottom` 0.8, `CropAngle` 5 (corners not refit); render 1024 × 405, aspect 2.528 |
| Jim: tighter crop shown (y/n) | y |
| Jim: turned about 5 degrees (y/n) | y |
| Copy removed / selection back / photo unchanged | yes / yes / back |

[handle: `docs\reports\phase11\CROP-SPIKE\run1\crop_spike_2026-10-29T12-06-15-398Z.json`]

## Verdict

**Go** on this report's go rule: both writes `set`, read back as written, the crop render's aspect changed as the crop says, and Jim answered y to both questions. Crop (`CropLeft`/`Right`/`Top`/`Bottom`) and straighten (`CropAngle`) are writable through `lr_set_develop_settings` as it is, with no plugin change. Whether to build an `lr_crop` tool, and its session contract, is Jim's next decision; issue #115 stays open. [The verdict as given in the session brief of 2026-10-29; Jim confirms it on review of the PR.]

## Consequences / open questions

- An `lr_crop` tool (issue #115 "Proposal") is Jim's next decision; its session contract has to say how a crop changes regions, metrics and mask coordinates (issue #115 "Design note"; `engine\src\params\crop-frame.ts` already maps masks through a crop).
- **Lightroom does not refit the stored corners when only `CropAngle` is written:** they read back 0.1 / 0.9 / 0.2 / 0.8 at angle 5 [handle: run 2 file, `read_back.straighten`], while the render grew narrower, aspect 2.0 to 2.528 [handle: run 2 file, `renders`]. So Lightroom fits the turned crop inside the photo when it renders (`CropConstrainToUnitSquare` 1), not in the stored keys [inference]. An `lr_crop` that reports the crop's frame, or maps masks through it, cannot take the stored corners as the rendered frame after a straighten [inference; `engine\src\devtools\mask-crop-run.ts` `turnCrop` shrinks the corners itself for that reason].
- Still [unverified]: a crop on a rendered (non-raw) photo, on a photo Lightroom turns a quarter or mirrors, a crop with `CropConstrainToUnitSquare` 0, and whether `CropAngle` written this way matches the Develop crop tool's straighten ([community] note in Pre-run findings).
- Run 1's harness bug left a copy behind while saying none was made. `fe94322` sets `results` before the first step, so the copy step no longer throws [handle: `git show fe94322`, `crop-spike-cli.ts:132`]; run 2 recorded its copy and removed it. Whether the "no virtual copy was made" message can still show when a later step throws with a copy made is [unverified].
