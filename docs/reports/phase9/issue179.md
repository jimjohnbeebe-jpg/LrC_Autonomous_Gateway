---
report: Issue #179 — do masks land where the agent asks on a cropped, angled or turned photo?
phase: 9 (wip/179-crop-frame, before rc.2)
status: observed
authored_by: "Template, harness, pre-run findings, the two fixes the runs led to, and the analysis: Claude Code (Opus 5.5), 2026-10-18. Observed and Numbers: collected by Claude Code from the harness files Jim's three runs saved (Jim ran the checks and said 'done'). Verdict: Jim's own words, quoted; the rest is left for him."
date: 2026-10-18
---

# Issue #179 — do masks land where the agent asks on a cropped, angled or turned photo?

## Purpose

**The question.** Linear and radial mask geometry was written in 0-1 of the uncropped photo while the agent only sees the cropped preview, so on a cropped photo geometric masks missed or fell outside the frame [stated: Jim, GitHub issue #179 "Summary"]. Jim chose fix A: every point and box the agent writes or reads is in 0-1 of the cropped preview, and the engine maps it [stated: Jim, 2026-10-18, relayed in Claude Code's task for issue #179]. Does Lightroom put the engine's masks where the agent asked, on a cropped photo, at a crop angle and on a portrait photo Lightroom turns?

**Acceptance criteria**, quoted from the issue:

> - On a cropped raw, a linear mask with zero y 0.64 → full y 1.0 (cropped space) darkens the bottom third of the **visible** frame. The frame Δ luma is of the same magnitude as on the uncropped rendered DNG (≈ −2 for the test above), not ≈ 0.
> - The same holds for a radial box, and for both on a photo with a non-zero crop angle.
> - `lr_list_masks` reports geometry in the same space the agent wrote it in.
> - `lr_get_preview` `region`, `lr_set_regions` and mask geometry document one coordinate space.
> - A mask mostly outside the crop returns a warning.
> - Rerun of the A/B above (sessions `4c9a8a79` vs `d4372429` settings) shows matching deltas.

**Go rule** (PHASES.md has none for an issue fix; proposed [inference]): **go** when `npm run masks:crop` says WORKED on two photos, one cropped landscape and one portrait photo Lightroom turns (orientation BC, CD or DA), and the Claude Desktop rerun of the issue's A/B (written up after this run, see "Consequences") gives a frame Δ luma near −2 on the cropped raw. **Conditional** when only case B (the crop angle) or only the portrait photo fails: the engine then refuses that case until it is fixed. **No-go** when case A fails on the cropped landscape photo.

**How the check asks Jim:** it asks nothing. It measures each render with sharp and prints PASS or FAIL per mask, as `npm run effects:probe` does [handle: `engine\src\devtools\effects-probe-cli.ts`, "It asks nothing"].

## Harness

| What | Files |
|---|---|
| The mapping (preview <-> uncropped photo) | `engine\src\params\crop-frame.ts`; the warning: `engine\src\params\crop-share.ts` |
| Where the engine uses it | `engine\src\session\crop.ts` (`frameOf`, read in every mask call), `engine\src\params\mask-build.ts`, `mask-ops.ts`, `mask-combine.ts`, `mask-summary.ts`, `engine\src\session\masks.ts`, `person-masks.ts` |
| The probe (`npm run masks:crop`) | `engine\src\devtools\mask-crop-probe-cli.ts` (steps, put-back, headline), `mask-crop-run.ts` (the two cases), `mask-crop-probe.ts` (what is written, the blob, the verdicts) |
| Tests | `engine\tests\crop-frame.test.ts`, `crop-share.test.ts`, `session-masks-crop.test.ts`, `mask-crop-probe.test.ts`, `mask-crop-run.test.ts`, `mcp-descriptions.test.ts` "one coordinate frame" |

What the probe does on each selected photo, behind the snapshot "AVG masks:crop before":
- **Case A**, the photo as it is. It renders the photo once without new masks. Then for each of three preview points, (0.3, 0.35), (0.65, 0.5) and (0.45, 0.7), it writes the photo's masks plus one small radial (+2 EV, a box twice as wide as tall) through the engine's own path (`frameFor`, `applyOp`, as `lr_create_mask`). It reads the mask back as `lr_list_masks` shows it, renders, and finds the brightened blob against the first render. **PASS** when the blob's centre is within 0.03 of the point on each axis, the blob lies level (within 8 degrees), and the read-back equals what was written (within 1e-5, per number; 1e-6 until commit `f7e0142`, see "Observed", run 1). Then it writes the issue's foreground gradient (zero (0.5, 0.64) → full (0.5, 1.0), exposure −0.25, saturation −10, texture −8) and measures the frame Δ luma: **FAIL** when its size is under 0.5.
- The photo is put back from the snapshot.
- **Case B**, the same crop turned to CropAngle 10 about its centre and shrunk until the turned rectangle lies inside the photo (`mask-crop-run.ts` `turnCrop`; the angle alone would leave its corners past the photo under the crop model the engine uses [inference]), written through `apply_settings`, then the same steps, mapped with the crop Lightroom read back. The photo is put back again. A photo that is not put back ends the run, so its put-back record stays for the next run.
- Headline **WORKED** only when every case passed, every photo was put back, and the photos include a cropped one and a turned one.

Results go to `%TEMP%\LrC-AVG\masks-crop\mask_crop_<time>.json`, with a copy of the plugin log.

**Steps for Jim.** Lightroom open in Develop, Claude Desktop quit.

1. In Lightroom's Develop Filmstrip, click a landscape photo that you cropped in Lightroom, then Ctrl-click a portrait photo that Lightroom shows turned (orientation BC, CD or DA). Both are now selected. [Observed 2026-10-18: a photo picked as the portrait, `DSC_0031.JPG`, was landscape-shaped (aspect 1.504) and Lightroom reported orientation AB, so the probe ended FAILED for coverage; run 2 and 3 used `IMG_1595.JPG`, reported as BC (see "Observed").]
2. In PowerShell, run:
   ```powershell
   cd D:\Developer\LrC_Autonomous_Gateway
   npm run masks:crop
   ```
3. Do not click in Lightroom while it runs (about 2-4 minutes). The window prints a PASS or FAIL line per mask.
4. At the end the window shows `Mask crop probe: WORKED` or `FAILED (...)` and `put back: YES` or `NO`.
5. Tell Claude Code "done".

### If something goes wrong

- If the window says "select two photos", select them in the Develop Filmstrip as in step 1, then run step 2 again.
- If the window ends with "none of the selected photos is a portrait photo Lightroom turns", the second photo's orientation is AB: choose a photo that Lightroom reports as BC, CD or DA and run step 2 again.
- If the window says `put back: NO`, run `npm run masks:crop` again: it puts the photo back first. If it says NO again, in Develop select the photo it names, open the Snapshots panel (left) and click "AVG masks:crop before".
- If a line says `CROP_FRAME_UNSUPPORTED`, the photo is mirrored (flipped in Lightroom): choose another photo and run step 2 again.

## Pre-run findings (Claude Code)

- **The preview, `lr_get_preview` `region` and `lr_set_regions` already are in the cropped frame.** The export follows a Lightroom crop [handle: `engine\src\mcp\tools-context.ts:210`, citing `docs\reports\phase4\S7.md` Numbers item 3]; regions are measured on the session's last export [handle: `engine\src\session\regions.ts:27`, `measureImage(t.last.jpeg, regions)`]. Only mask geometry was in the uncropped frame [handle: `engine\src\mcp\defs-masks.ts:28` before this change, "In 0-1 of the uncropped photo"].
- **Nothing had observed the mask frame on a cropped photo.** It was listed as still [unverified] [handle: `docs\reports\phase6\masks-capture.md:222`, "a cropped, rotated or Upright photo's geometry frame"]. The uncropped, upright frame was observed [handle: `docs\reports\phase6\masks-capture\check.json` `8_geometry_plan`].
- **What the crop keys mean is from third parties, not Adobe.** CropLeft/Top/Right/Bottom are fractions of the uncropped stored photo, before orientation; with a CropAngle they are two corners of the turned rectangle; mask geometry is in the same stored frame; AB, BC, CD and DA are turns of 0, 90, 180 and 270 degrees [community] [handle: https://community.adobe.com/questions-675/sdk-computing-the-corners-of-a-crop-rectangle-962108, https://community.adobe.com/feature-requests-676/p-correct-copying-of-crops-and-local-adjustments-664795, https://github.com/storytold/lightcraft/pull/495]. The one local observation is an AB photo at angle 0, whose crop size matches [handle: `docs\reports\phase4\S7\s7_run_2026-09-27T12-53-05.json` `crop.size_after_crop`]. `crop-frame.ts` implements this mapping; the mirrored codes (BA, AD, DC, CB) are refused with CROP_FRAME_UNSUPPORTED, since no source gives their mapping.
- **The arithmetic holds against itself and the recorded crop.** `npx vitest run tests/crop-frame.test.ts tests/crop-share.test.ts` in `engine\`: 2 files, 11 tests passed (2026-10-18). This covers the identity, DSC_0031's recorded crop [handle: `engine\tests\fixtures\s10-rendered-dsc0031.json`], a round trip within 1e-9 at angles 0, 10 and −7.25 in all four orientations, the crop's corners, a radial written and read back as the same box, the refusals, and the 90 % warning.
- **The mask tools use it, against the simulator.** `npx vitest run tests/session-masks-crop.test.ts`: 9 tests passed (2026-10-18). With DSC_0031's crop, the issue's gradient is written at ZeroY = CropTop + 0.64 × (CropBottom − CropTop) and listed back as `{ zero: { x: 0.5, y: 0.64 }, full: { x: 0.5, y: 1 } }`. A radial at angle 10 is written with Angle 10 and read back as the box given. A gradient 99 % outside a top-half crop returns `warnings`. A mirrored photo refuses geometry with nothing written. A radial the user turned (Angle 30) keeps its corners and Angle on a feather-only edit, uncropped and cropped, and one of its sides alone cannot be moved. A combined mask's added linear part, a person's point and the people's boxes, and a gradient on a BC photo go through the crop as well. The simulator does not render masks, so where Lightroom draws them is left to Jim's run.
- **The probe's steps run against the simulator.** `npx vitest run tests/mask-crop-run.test.ts tests/mask-crop-probe.test.ts`: 8 tests passed (2026-10-18). Each radial and the gradient read back as written in both cases. As expected, no blob was found, because the simulator renders global settings only. This checks the harness, not Lightroom.
- **Gates.** `npm run build`, `npm test` (143 files, 1596 passed, 9 skipped), `npm run typecheck` and `npm run arch:check` ("no dependency violations found") all passed on 2026-10-18.

## Observed (Jim)

Collected by Claude Code from the harness files Jim's runs saved; Jim ran the checks and said "done". Nothing here was typed by hand into the harness: `npm run masks:crop` asks nothing. Four result files exist in `%TEMP%\LrC-AVG\masks-crop\`, all of 2026-10-18 (UTC in the names), each with a copy of the plugin log beside it (`mask_crop_bridge_log_<time>.txt`). Three runs wrote photos; the fourth stopped at its selection check. Engine 1.0.0, Node v24.11.1 in each. Offsets are blob centre minus asked point, in 0-1 of the preview (x, y); tilt is the blob's major axis from level, in degrees; the limits were 0.03 on each axis and 8 degrees.

**Photos** [handle: the `photos` entries of the three result files]:

| Photo | Orientation | Crop at case A | Used in |
|---|---|---|---|
| `20260110-_Z8A0138-DxO_DeepPRIME XD3.dng` (the cropped landscape) | AB | CropLeft/Top 0.013908, CropRight/Bottom 0.986092 (1.4 % off each side), angle 0 | runs 1, 2, 3 |
| `DSC_0031.JPG` (Jim picked it as his portrait [stated: Jim, 2026-10-18]) | AB, so Lightroom reports no turn; landscape-shaped (aspect 1.504) | none (0, 0, 1, 1) | run 1 |
| `IMG_1595.JPG` (a virtual copy rotated right, as Claude Code's task for this report states; the result file records the name and orientation only) | BC | none (0, 0, 1, 1) | runs 2, 3 |

**Run 1**, `mask_crop_2026-10-18T20-27-46-157Z.json` (headline FAILED, both photos put back: YES; the branch head then, `f90aeba`, before `f7e0142` and `a9e4d7b` [inference: `npm run masks:crop` builds the working tree first, `package.json:35`; the commit times; any uncommitted change at the time is not excluded]):

- DNG, case A: all three radials PASS (worst offset 0.0061, tilt at most 2.5), foreground gradient PASS (Δ luma −0.815).
- DNG, case B (10 degrees): all three radials were on their points (worst offset 0.0058, tilt at most 1.7); the third read back differently from what was written, which failed it against the then 1e-6 tolerance. The foreground gradient passed (−0.984). Claude Code's reading: a 6-decimal round trip through `crop-frame.ts` drifts by up to 6.2e-7, and the summaries round to 6 decimals [inference; commit `f7e0142`, computed with `engine\dist\params\crop-frame.js`]. That commit raised the tolerance to 1e-5 and makes a mismatch save the geometry that read back. The same radial passes in runs 2 and 3 (`readback_ok: true`).
- `DSC_0031.JPG`, cases A and B: all radials and the gradient PASS (worst offset 0.0058 in A and 0.0037 in B; tilts −1.0 to 2.1; Δ luma −1.614 in A, −1.591 in B).
- Coverage: no selected photo was one Lightroom turns, so the headline was FAILED with the line "none of the selected photos is a portrait photo Lightroom turns (orientation BC, CD or DA): select one shot upright".

**The fourth file**, `mask_crop_2026-10-18T20-48-06-733Z.json`: the selection check refused ("select two photos ... (3 selected)"); nothing was written.

**Run 2**, `mask_crop_2026-10-18T20-49-52-931Z.json` (headline FAILED, both put back: YES; the branch head then, `f7e0142` [inference, as above]):

- DNG: cases A and B PASS, to the same decimals as in run 1.
- `IMG_1595.JPG` (BC), case A: PASS (worst offset 0.0033, tilts −2.0 to 2.7, Δ luma −0.699).
- `IMG_1595.JPG` (BC), case B (10 degrees; the crop read back was CropLeft 0.196544, Top 0.050806, Right 0.803456, Bottom 0.949194; the engine's aspect 0.75): FAIL. Radial 1 was off by (−0.039, −0.040), over the 0.03 limit; radial 2 by (+0.017, +0.016) and radial 3 by (+0.016, +0.017), under it; all three tilts small (−1.3, 3.2, 0.3). The gradient passed (Δ luma −0.798).
- Claude Code's diagnosis: the engine took the aspect (width / height) from `getRawMetadata` swapped for a quarter turn. With the aspect unswapped, `crop-frame.ts` predicts where all three blobs were drawn within 0.001 [handle: `engine\tests\crop-frame.test.ts` "matches Lightroom on a photo turned BC at a 10-degree crop: the size's aspect, not swapped"; this run's file, case B]. Fix: commit `a9e4d7b` (`engine\src\params\crop-frame.ts`). It also changes the crop the probe writes in case B, since the probe shrinks the turned rectangle with the frame's aspect.

**Run 3**, `mask_crop_2026-10-18T21-17-39-411Z.json` (headline FAILED, both put back: YES; the branch head then, `a9e4d7b` [inference, as above]), the final code:

| Photo, case | Radial 1 (0.3, 0.35): offset, tilt, pixels | Radial 2 (0.65, 0.5) | Radial 3 (0.45, 0.7) | Foreground Δ luma |
|---|---|---|---|---|
| DNG, AB, A (its own 1.4 % crop) | (−0.0018, +0.0055), 0.0, 1899 | (−0.0008, −0.0045), −0.1, 1497 | (+0.0061, +0.0003), 2.5, 789 | −0.815 |
| DNG, AB, B (10 deg) | (−0.0018, +0.0058), −0.1, 1912 | (−0.0007, −0.0044), 0.1, 1516 | (+0.0023, +0.0025), 1.7, 508 | −0.984 |
| `IMG_1595.JPG`, BC, A | (−0.0002, −0.0003), −0.8, 2168 | (−0.0014, +0.0033), 2.7, 1401 | (+0.0003, +0.0001), −2.0, 1339 | −0.699 |
| `IMG_1595.JPG`, BC, B (10 deg; aspect 1.3333) | (−0.0075, +0.0020), **−9.1 FAIL**, 850 | (+0.0007, −0.0022), −2.4, 1474 | (−0.0081, +0.0007), **+15.8 FAIL**, 756 | −0.999 |

All 16 read-backs (12 radials and 4 gradients) equalled what was written within 1e-5. The DNG's cases A and B gave the same positions in all three runs. The one failing case is BC + 10 degrees: its three radials are on their points (largest offset 0.0081), radial 2 is level, and radials 1 and 3 failed only the level check.

**Not observed in any run:** the issue's A/B rerun through Claude Desktop (sessions `4c9a8a79` vs `d4372429` settings on `20260906_OZ80004-LrC-AVG.dng`) was not run. The substitute evidence is the probe's foreground gradient, the issue's mask and sliders, measured on the cropped and turned photos: Δ luma −0.70 to −1.61 in every case, never near 0 (the issue's cropped-raw result before the fix was −0.002). On the same photo the uncropped case and the cropped, angled case give about the same size: `DSC_0031.JPG` −1.614 (A) and −1.591 (B), `IMG_1595.JPG` −0.699 (A) and −0.999 (B), DNG −0.815 (A) and −0.984 (B). The issue's own figure for the uncropped rendered DNG (≈ −2) is for another photo and was not re-measured.

## Numbers

From the final code (run 3) unless a row says another run.

| Field | Value |
|---|---|
| Blob distance from the asked point, worst of all cases (0-1 of the preview) | 0.0081 (`IMG_1595.JPG`, BC + 10 deg, radial 3, x). Before `a9e4d7b`, run 2: 0.0398 (same case, radial 1, y) |
| Blob tilt, worst (degrees) | 15.8 (`IMG_1595.JPG`, BC + 10 deg, radial 3) and −9.1 (radial 1), both over the 8-degree limit. The other 10 readings of run 3: −2.4 to 2.7. Run 1, `DSC_0031.JPG`: −1.0 to 2.1 |
| Foreground Δ luma, case A / case B, landscape | DNG (AB, cropped): −0.815 / −0.984. `DSC_0031.JPG` (AB, run 1; landscape-shaped, picked by Jim as his portrait): −1.614 / −1.591 |
| Foreground Δ luma, case A / case B, portrait | `IMG_1595.JPG` (BC): −0.699 / −0.999 (run 2, before the fix: −0.699 / −0.798) |
| Read-back equal to written (all) | Run 3: 16 of 16 within 1e-5. Run 1, at the 1e-6 tolerance: 15 of 16 (the DNG case B radial 3 differed) |
| A/B rerun Δ luma, cropped raw (issue: −0.002 before the fix, −2.061 on the uncropped DNG) | Not run. Substitute: the gradient's −0.70 to −1.61 above |

## Verdict

Jim, 2026-10-18, on the three runs: "Accept and push (Recommended)" [stated: Jim, 2026-10-18]. As Claude Code's task for this report records it, Jim accepted that the radials' positions are verified in all four cases (AB, AB + 10 degrees, BC, BC + 10 degrees), and that the two tilt readings of BC + 10 degrees are recorded as inconclusive (see "Consequences / open questions").

The go / conditional / no-go word: not stated by Jim; left for him. For reference, a suggestion and not a verdict: the harness headline of run 3 is FAILED, on the two tilt readings alone; the proposed go rule above names no case for "positions right, two tilts not", and the A/B rerun it asks for was not run.

## Consequences / open questions

- **What the runs showed (Claude Code).**
  - In all four cases of run 3 (AB, AB + 10 degrees, BC, BC + 10 degrees) every radial is on its point (offsets 0.0061 or less, 0.0081 on BC + 10 degrees), and `lr_list_masks`-style read-back equals what was written (16 of 16 within 1e-5). For the photos tried, that answers the issue's first three criteria as far as positions and read-back go; the blob tilts of BC + 10 degrees are the exception below.
  - The run on the turned photo found a real bug, the swapped aspect for a quarter turn (run 2: offset 0.04, `a9e4d7b`). `getRawMetadata` width / height is used as it comes. This replaces the earlier [inference] that the angle case swaps them for BC and DA. DA is taken to behave like BC [inference: symmetry]; no DA photo was run.
  - **The two tilt readings of run 3** (`IMG_1595.JPG`, BC + 10 degrees: radial 1 at −9.1 degrees and radial 3 at +15.8, radial 2 at −2.4) are recorded as inconclusive [stated: Jim, 2026-10-18, "Accept and push (Recommended)"]. Claude Code's reasoning, [inference] throughout: any affine mapping from the crop to the preview gives the same tilt to equal-sized radials whatever their position, so one case should show one tilt at all three points; the observed −9.1, −2.4 and +15.8 differ among themselves, so they are not a mapping error. Claude Code's modelling of the four combinations of the engine's aspect and Lightroom's (swapped or not) with `engine\dist\params\crop-frame.js` gave 0.0 degrees for the shipped one and a uniform 6 to 7 degrees for the wrong ones, the same at all three points [inference; relayed from the Claude Code session that analysed run 3, its output not saved to a file]. The two failing blobs are the two that read tilted; they are smaller than most (850 and 756 pixels against 1339 to 2168 for the other BC readings), but the DNG's third radial was as small (789 and 508 pixels) and read level (2.5 and 1.7 degrees), so size alone does not account for it. A possible reading is that a blob measured against a render at +2 exposure follows the picture's own bright content, which this report does not check.
  - The foreground gradient was never near 0 on a cropped or turned photo (−0.70 to −1.61): the issue's symptom (≈ 0 on a cropped raw) is gone for these photos.
- **The issue's last criterion**, a Claude Desktop rerun of the A/B on `20260906_OZ80004-LrC-AVG.dng` (sessions `4c9a8a79` and `d4372429`), has not been run. The probe's foreground gradient (the same mask and sliders on Jim's cropped and turned photos, Δ luma about −0.7 to −1.6) is the substitute evidence, not a replacement [stated: Jim accepted the check, 2026-10-18]; the rerun stays [unverified].
- **To do after the merge, not done in this commit:** the frame statement in the tool descriptions stands for what was observed; the `[unverified]` tags in `crop-frame.ts` (its header says all of it is unverified until this probe), `mask-build.ts` and `defs-masks.ts` are to be replaced by this report's handle, narrowed to what stays unverified below; LR_SDK_NOTES gets the crop frame facts, and the 2026-10-18 finding that the aspect is not swapped.
- **Still [unverified] after these runs:**
  - the mirrored orientations (refused, not mapped);
  - DA and CD (a photo turned 270 and 180 degrees): neither was run; DA's behaviour is taken from BC by symmetry [inference], CD's mapping is [inference];
  - camera-upright portraits that Lightroom shows without a turn (orientation AB with portrait-shaped pixels): none was tested; `DSC_0031.JPG` was landscape-shaped;
  - the sign and size of a radial's Angle: at +10 degrees on the two AB photos the tilts were −1.0 to 2.5 degrees, which fits the engine's sign [inference: a wrong sign would show about 20 degrees]; on BC + 10 degrees two of three readings were inconclusive; negative angles were not run;
  - masks on photos with lens corrections, Transform or Upright, which may move pixels after the mask is placed [community] [handle: https://github.com/skymanbp/autoshade/blob/5c1902eff2d1813f720fd94670da246426646bdd/docs/ARCHITECTURE.md L3387];
  - a person's point and the people boxes on a cropped photo: mapped the same way, but not in this probe;
  - the issue's A/B rerun through Claude Desktop (above).
- Writing CropAngle through `applyDevelopSettings` may give another crop than the Develop crop tool does [community] [handle: https://community.adobe.com/questions-675/api-difference-between-cropangle-and-straightenangle-958893]. Case B maps with what Lightroom read back, so it tests the mapping, whatever crop results. The read-back crops are in the result files (`crop` of each case).
