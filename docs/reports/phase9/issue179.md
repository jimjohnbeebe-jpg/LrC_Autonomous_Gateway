---
report: Issue #179 — do masks land where the agent asks on a cropped, angled or turned photo?
phase: 9 (wip/179-crop-frame, before rc.2)
status: template
authored_by: "Template, harness and pre-run findings: Claude Code (Opus 5.5), 2026-10-18. Observed, Numbers and Verdict: Jim (blank until his run)."
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
- **Case A**, the photo as it is. It renders the photo once without new masks. Then for each of three preview points, (0.3, 0.35), (0.65, 0.5) and (0.45, 0.7), it writes the photo's masks plus one small radial (+2 EV, a box twice as wide as tall) through the engine's own path (`frameFor`, `applyOp`, as `lr_create_mask`). It reads the mask back as `lr_list_masks` shows it, renders, and finds the brightened blob against the first render. **PASS** when the blob's centre is within 0.03 of the point on each axis, the blob lies level (within 8 degrees), and the read-back equals what was written (within 1e-6). Then it writes the issue's foreground gradient (zero (0.5, 0.64) → full (0.5, 1.0), exposure −0.25, saturation −10, texture −8) and measures the frame Δ luma: **FAIL** when its size is under 0.5.
- The photo is put back from the snapshot.
- **Case B**, the same crop turned to CropAngle 10 about its centre and shrunk until the turned rectangle lies inside the photo (`mask-crop-run.ts` `turnCrop`; the angle alone would leave its corners past the photo under the crop model the engine uses [inference]), written through `apply_settings`, then the same steps, mapped with the crop Lightroom read back. The photo is put back again. A photo that is not put back ends the run, so its put-back record stays for the next run.
- Headline **WORKED** only when every case passed, every photo was put back, and the photos include a cropped one and a turned one.

Results go to `%TEMP%\LrC-AVG\masks-crop\mask_crop_<time>.json`, with a copy of the plugin log.

**Steps for Jim.** Lightroom open in Develop, Claude Desktop quit.

1. In Lightroom's Develop Filmstrip, click a landscape photo that you cropped in Lightroom, then Ctrl-click a portrait photo (one you shot holding the camera upright). Both are now selected.
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

_Filled by Jim. Claude Code collects the results file and pastes the lines here._

- Photos selected (file name, orientation, cropped):
- Case A, landscape: radials PASS/FAIL, foreground Δ luma:
- Case B, landscape: radials PASS/FAIL, foreground Δ luma:
- Case A, portrait: radials PASS/FAIL, foreground Δ luma:
- Case B, portrait: radials PASS/FAIL, foreground Δ luma:
- Headline, put back:
- Claude Desktop A/B rerun, session id and frame Δ luma:

## Numbers

| Field | Value |
|---|---|
| Blob distance from the asked point, worst of all cases (0-1 of the preview) | |
| Blob tilt, worst (degrees) | |
| Foreground Δ luma, case A / case B, landscape | |
| Foreground Δ luma, case A / case B, portrait | |
| Read-back equal to written (all) | |
| A/B rerun Δ luma, cropped raw (issue: −0.002 before the fix, −2.061 on the uncropped DNG) | |

## Verdict

_Jim decides: go / conditional / no-go._

## Consequences / open questions

- **The issue's last criterion**, a Claude Desktop rerun of the A/B on `20260906_OZ80004-LrC-AVG.dng` (sessions `4c9a8a79` and `d4372429`), follows this run. Claude Code writes its steps once this run's results are in. The probe's foreground gradient already applies the same mask and sliders on Jim's cropped photo.
- **Go**: the frame statement in the tool descriptions stands, and the `[unverified]` tags in `crop-frame.ts`, `mask-build.ts` and `defs-masks.ts` are replaced by this report's handle. LR_SDK_NOTES gets the crop frame facts.
- **Still [unverified] after this run, whatever it shows:**
  - the mirrored orientations (refused, not mapped);
  - CD (a photo turned 180 degrees), unless one of the selected photos is CD;
  - the sign of a radial's Angle beyond the 10-degree case: the probe's level check would catch a wrong sign as a tilt of about 20 degrees [inference];
  - whether `getRawMetadata` width/height is the photo as shown (the angle case swaps them for BC and DA) [inference];
  - masks on photos with lens corrections, Transform or Upright, which may move pixels after the mask is placed [community] [handle: https://github.com/skymanbp/autoshade/blob/5c1902eff2d1813f720fd94670da246426646bdd/docs/ARCHITECTURE.md L3387];
  - a person's point and the people boxes on a cropped photo: mapped the same way, but not in this probe.
- Writing CropAngle through `applyDevelopSettings` may give another crop than the Develop crop tool does [community] [handle: https://community.adobe.com/questions-675/api-difference-between-cropangle-and-straightenangle-958893]. Case B maps with what Lightroom read back, so it tests the mapping, whatever crop results.
