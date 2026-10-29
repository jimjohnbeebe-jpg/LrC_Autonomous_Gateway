---
report: MASKS-VERIFY
phase: "11"
status: observed
authored_by: "Claude Code (purpose, harness, pre-run findings, steps for Jim; 2026-10-27, night run on branch phase-11/masks-210; Observed and Numbers from the results files, the suggested verdict, harness findings, 2026-10-28; runs 4 and 5, 2026-10-29); Jim (the runs and their y/n answers, the decisions, the verdict)"
date: 2026-10-29
---

# MASKS-VERIFY: do colour ranges, one person's masks and masks on mirrored photos do what the engine means?

## Purpose

GitHub issue #210 (epic #207): Automaat's live testing on LrC 15.6 contradicts three mask behaviours LrC-AVG ships.

1. **Colour range.** The first three numbers of a colour range's `PointModels` entry are Lightroom's own per-photo ranking of the sample (l, a, b), not sRGB; selection follows them, not the pin; "a red sample selected the cyan patch" [upstream claim: Automaat PR #339, `git show 2acd90c`]. The engine writes the preview's sRGB at the point there (`engine\src\session\masks.ts`, `asLab`).
2. **One person's masks (`person_*`).** "Lightroom ignores `InstanceIDs` in a written mask and always masks the first person" [upstream claim: Automaat `CLAUDE.md`, `AiMaskParts.lua` `refuseSinglePerson`]. The engine writes `InstanceIDs` for the person whose box holds the point (`engine\src\session\person-masks.ts`).
3. **Mirrored photos.** The engine refuses mask geometry on a mirrored photo (`CROP_FRAME_UNSUPPORTED`); Automaat maps all eight orientation codes, mirrored ones included [upstream claim: `plugin/LightroomMCP.lrplugin/ImageFrame.lua:7-16` at `1040453`].

The questions: **(1) does a colour range from the engine's point sample select the colour at the point, and does a copy of Lightroom's own sample select what Lightroom's click selects? (2) does a one-person mask written for the second person mask the second person? (3) do radials and a gradient land where asked on a photo in each of the four mirrored orientations?**

Acceptance (issue #210): "Report `docs/reports/phase10/` (or next) with Jim's observations for 1-3, template by Claude Code. `color_range` either verified on two photos or refused; fix lands with a test against Lightroom-authored triples. `person_*` verified on a two-person photo or restricted. Mirrored photos supported or still refused with the observed reason."

How the answer reads (an inference, not a PHASES.md rule; the verdict is Jim's):

- **Part 1:** both `point_red` and `point_green` YES on both photos: the point sample works and stays; any NO: the point sample is refused or replaced (decision for Jim, below). `copy_lightroom_sample` YES: the copy path is verified.
- **Part 2:** every asked kind YES: one-person masks stay; a NO on `person_entire`: restrict `person_*` on photos of two or more people (decision for Jim, below).
- **Part 3:** every `orientation_<code>` YES: mirrored photos can be lifted from `CROP_FRAME_UNSUPPORTED` (a follow-up change); any NO: they stay refused with the observed reason.

## Harness

`npm run masks:verify` (`-- --part colour|person|mirror` runs one part again). Files: `engine\src\devtools\masks-verify-cli.ts` (the run: selection prompts, snapshots, put-back, results), `masks-verify.ts` (shared and pure: the reddest and greenest place of a render, the verdict), `masks-verify-colour.ts`, `masks-verify-person.ts`, `masks-verify-mirror.ts` (the parts); `mask-crop-run.ts` (masks:crop's cases, reused); test `engine\tests\masks-verify.test.ts`. Results under `%TEMP%\LrC-AVG\masks-verify\` (`mask_verify_<time>.json`, a redacted copy of the plugin log). No plugin change: plugin 0.16.0 or later.

What a run does:

1. **Colour (two photos selected).** For each photo, behind a snapshot: renders it, finds the clearly reddest and greenest place (sharp, 48-cell grid, one channel 0.25 above the other two), writes a colour range there as `lr_create_mask` did without a sample until 2026-10-28 (the preview's sRGB at the point; the tool now refuses one), +2 EV, and asks whether that colour brightened and only that colour. On the first photo it then asks Jim to click the red place with Lightroom's own Color Range (Tools > Create New Mask > Color Range [upstream claim: Automaat PR #339, create_range_mask's description]), reads the l, a, b Lightroom stored (and the render's sRGB at its pin, for comparison), writes a copy of it (`copy_sample_from`) with +2 EV, and asks whether the red parts brightened.
2. **Person (one photo of two or more people).** Writes the engine's probe (Entire Person, instance 0), lets Lightroom compute it, reads every person's box; then writes each of the eleven `person_*` kinds for the second person (instance 1) one at a time, each computed by Lightroom, and asks whether that person's part brightened and the first person's did not. A kind Lightroom finds nothing of (ErrorReason) is skipped; an AI mask with no result in 3 minutes stops the part.
3. **Mirror (one photo not flipped).** Jim flips it (Photo > Flip Horizontal [unverified]) and turns it three times (Photo > Rotate Right, Ctrl+] [unverified]); in each of the four mirrored orientations, `npm run masks:crop`'s case A (the photo's own crop) and case B (its crop turned 10 degrees), with the mirrored refusal lifted for this check only (`withMirrorMapping`): three radials and the issue #179 gradient, rendered and measured with sharp, no question. Jim then turns and flips the photo back and the check reads the orientation back, asking one more menu action at a time until it reads as at the start.

Every photo is put back from its snapshot "AVG masks:verify before" after each part (case, for the mirror part), Jim's own Color Range included; a run that stopped first puts it back on the next start.

## Pre-run findings (Claude Code)

- **`lr_create_mask` refused `color_range`, `depth_range` and `brush` since #191.** The kind enum of the MCP schema listed none of them, so a client's call failed validation before the engine saw it; the engine paths, `npm run masks:kinds` and the session tests used them directly [handle: `engine\tests\mcp-mask-defs.test.ts`; the tools-list snapshot at `8d97e8a` has no `color_range` in `kind`'s enum]. Fixed on this branch (commit "fix(mcp): lr_create_mask accepts color_range, depth_range and brush").
- **Jim's own colour ranges fit the l, a, b reading:** "Reds" stores `0.165342 0.748875 0.661089` (a, green to red, high) and "Yellows" `0.563384 0.525622 0.938049` (b, blue to yellow, high) [handle: `docs\reports\phase8\probes\kinds.json`, `-Rendered.dng` MaskGroupBasedCorrections 1 and 2] [inference]. The earlier "y" for the point sample was on a very dark pixel (`0.085490 0.112941 0.136471`) and cannot tell the two readings apart [handle: `docs\reports\phase9\upstream-ports.md`, Observed item 1] [inference].
- **Lightroom stores ColorAmount 0** on Jim's "Reds" [handle: the same file]; params now accept 0 so that a copy of it keeps 0 (the tool schema still asks a caller for more than 0).
- **Crop frame cross-check:** our four turns (AB, BC, CD, DA) agree with Automaat's table on every grid point, CD included, which was our [inference] [handle: `engine\tests\params-crop-frame-mirror.test.ts`, "map an uncropped photo as Automaat's table does"]. The mirrored four are taken from that table [upstream claim] and still refused in the tools.
- **Automaat #345** (a `Local` field written 0 that Lightroom omits on read-back, seen on its inverted mask copies with `LocalGlow` 0): our read-back check had the same strictness and the engine writes the user's own masks back as read, so such a copy would fail every mask pass [inference]; fixed [handle: `engine\tests\params-mask-table.test.ts`, "takes a Local field written 0"].
- **Automaat #343** (a slider set through `LrDevelopController.setValue` saved about 2 s later over a mask write): the engine sets local sliders in the mask table and never through `setValue` [handle: no `setValue` in `plugin\LrC-AVG.lrplugin\`], so its own path does not hit it [inference]. A slider Jim drags in Lightroom just before a mask pass is not tested here [unverified].
- Engine tests for the new paths: `engine\tests\params-mask-color.test.ts` (Jim's three and Automaat's 14 Lightroom-authored triples read back as l, a, b and copied verbatim; the refusals), `session-mask-kinds.test.ts` (copy inside a session), `masks-verify.test.ts` [handle: `npm test` on branch `phase-11/masks-210`, see the PR].

## Steps for Jim

Have three things ready in one Lightroom collection or folder: two colourful photos (each with a clearly red and a clearly green area: flowers, fruit, a colour chart), one photo of two or more people side by side, and any photo you have not flipped. Virtual copies are safest (Photo > Create Virtual Copy).

1. Quit Claude Desktop (File > Exit, and its tray icon > Quit).
2. Start Lightroom Classic and switch to Develop. In File > Plug-in Manager, check that LrC-AVG is enabled.
3. In PowerShell, in `D:\Developer\LrC_Autonomous_Gateway`, run:

   ```powershell
   npm run masks:verify
   ```

4. Part 1 asks you to select the two colourful photos: in the Filmstrip click the first, Ctrl+click the second, then type `y` and Enter.
5. For each question, look at the photo in Lightroom (the check shows it), then type `y` or `n` and Enter.
6. When asked, in Lightroom choose Tools > Create New Mask > Color Range [upstream claim: Automaat PR #339], click the red place the question names, then type `y`.
7. Part 2 asks you to select the photo of people: click it, type `y`. Each mask takes a few seconds for Lightroom to compute; answer each question.
8. Part 3 asks you to select the photo not flipped: click it, type `y`. Then do each step it names in Lightroom and type `y` after it: Photo > Flip Horizontal; then Photo > Rotate Right (Ctrl+]) three times (both menu paths and the shortcut [unverified]), one at a time; at the end Photo > Rotate Right once more and Photo > Flip Horizontal.
9. You see `Mask verify: WORKED` or `FAILED`, then `put back: YES` or `NO`. Tell Claude Code "done".

### If something goes wrong

- If it says "photo(s) selected, not 2" (or 1): select as asked, then run the command again with the part, for example `npm run masks:verify -- --part person`.
- If part 1 says "no clearly red area" or "no clearly green area": choose another colourful photo and run `npm run masks:verify -- --part colour`.
- If part 2 says "Lightroom found 1 person(s)": choose a photo where the people do not overlap and run `npm run masks:verify -- --part person`.
- If the Develop Photo menu has no Flip Horizontal: switch to Library (G), use Photo > Flip Horizontal there, switch back to Develop (D), then type `y`.
- If it says "reload the LrC-AVG plugin": File > Plug-in Manager, LrC-AVG, Reload Plug-in, then run the command again.
- If `put back: NO`: in Develop, select the photo the line names, open the Snapshots panel (left) and click "AVG masks:verify before". If the line is `orientation_put_back`, flip and turn the photo back by hand (Photo > Flip Horizontal, Photo > Rotate Left or Right).

### Rerun for part 2 (person), after the follow-ups branch is merged

Part 2 was not tested (Observed, run 1 and run 2). Have one photo of two or more people side by side that you have not flipped; a virtual copy is safest.

1. Quit Claude Desktop (File > Exit, and its tray icon > Quit).
2. Start Lightroom Classic and switch to Develop. In File > Plug-in Manager, select LrC-AVG and click Reload Plug-in.
3. In PowerShell, in `D:\Developer\LrC_Autonomous_Gateway`, run:

   ```powershell
   npm run masks:verify -- --part person
   ```

4. If it first says a photo "is still owed its orientation": do the one menu action each question names in Lightroom, then type `y` and Enter, until it goes on.
5. When asked, click the photo of people in the Filmstrip, then type `y` and Enter.
6. For each question, look at the photo in Lightroom, then type `y` or `n` and Enter. Each mask takes a few seconds for Lightroom to compute.
7. You see `Mask verify: WORKED` or `FAILED`, then `put back: YES` or `NO`. Tell Claude Code "done".

## Observed (Jim)

Filled by Claude Code from the three results files and Jim's y/n answers in them, 2026-10-28; Jim's answers are his observations [stated: Jim, 2026-10-28, "Checks done."]. The files: run 1 `docs\reports\phase11\MASKS-VERIFY\mask_verify_2026-10-28T11-41-19-905Z.json` (parts colour, person, mirror; 04:41-04:50 local), run 2 `...\mask_verify_2026-10-28T11-53-02-478Z.json` (the same parts; 04:53-04:57), and the plugin log lines of both [handle: `docs\reports\phase11\MASKS-VERIFY\mask_verify_bridge_log_excerpt_2026-10-28.txt`, from the redacted log copy the third run saved]. The parity run is in MASK-PARITY.md. Engine 1.6.0 in all three; the files keep no Lightroom or plugin version (the harness records both from now on); `perf:check` seven minutes before run 1 read Lightroom Classic 15.6 and plugin 1.6.0 [handle: `docs\reports\phase11\PERF\after\perf_after_2026-10-28T11-34-08-350Z.json`].

**Part 1, colour range.**
- `_DSC0028.NEF`, the engine's point sample at the reddest place (55 % across, 67 % down), sRGB written l 0.692392, a 0.111059, b 0.279529: **Jim y**, in run 1 and again in run 2.
- `_OZ80660.JPG`, the point sample at its reddest place (93 % across, 83 % down), sRGB written 0.796392, 0.136784, 0.099294: **Jim n** (run 1).
- No clearly green area was found in either photo, so no green point was asked.
- `_DSC0028.NEF`, Jim's own Color Range click, then a copy of its sample (`copy_lightroom_sample`): **Jim y**. Lightroom stored l 0.793882, a 0.842123, b 0.664825, pin (0.626, 0.639), amount 0.494949; the render's sRGB at that pin was 0.459922, 0.000627, 0.112784.
- In run 2 the colour part was refused on its first photo, `_DSC0091.NEF`, because that photo was mirrored ("BA"); nothing was written to it.

**Part 2, person.** Not tested. Run 1: on `_DSC0103.NEF` Lightroom found 0 people (the probe's boxes were empty). Run 2: the photo selected was `_DSC0091.NEF`, refused as mirrored ("BA").

**Part 3, mirrored photo** (`_DSC0091.NEF`; per orientation, case A at the photo's own crop, case B with its crop turned 10 degrees; three radials and a gradient each, measured with sharp, no question).
- Run 1 (the photo cropped, 0.081-0.928 across, 0.119-0.966 down): BA case A, the first radial landed on its point and level, then the export failed ("export_failed: the export wrote no JPEG into ...\previews\<uuid>"); every other case of BA and AD failed on its first export. After the third Rotate Right the photo still read AD ("seen before"), so the part stopped. Jim's flip-back read AB, as at the start: put back YES.
- Run 2 (the photo uncropped): all four mirrored orientations were seen, BA, AD, DC, CB, in that order of Rotate Right. Every radial that showed was within about 0.01 of its point (x and y, 0-1), every gradient darkened the frame (delta luma -1.1 to -1.8), and every read-back was as written. What failed is the radials' tilt, and two radials that did not show:

| Orientation | Case A (own crop) | Case B (crop turned 10 degrees) |
|---|---|---|
| BA | FAIL: radial 2 tilted -8.8 degrees | PASS |
| AD | FAIL: radials 2 and 3 tilted -9.5 and 11.7 | FAIL: radial 3 tilted 15.2 |
| DC | FAIL: radials 2 and 3 no brightened blob | PASS |
| CB | FAIL: radials 1 and 2 tilted 9.5 and 24.3 | FAIL: radials 1 and 2 tilted 40 and 14.8 |

- Run 2's flip-back ("Rotate Right once more, then Flip Horizontal") read **BA, not AB**: put back NO.

### Run 4 (part 2, person), 2026-10-29

Jim ran `npm run masks:verify -- --part person --i-know` as check 3 of the 1.7.0 batch (`BATCH-1.7.0-CHECKS.md`) on his usual catalog [stated: Jim, 2026-10-29, "Still fails. I selected a different version, this one rendered as .dng and copied, and verified it was the only selection"]. Engine and plugin 1.7.0, Lightroom Classic 15.6, three runs [handle: `docs\reports\phase11\MASKS-VERIFY\run4\`, the three `mask_verify_*.json` files, `engine_version`, `plugin_version`, `lrc_version`]. Times are UTC from the file names; the bridge-log excerpt is in Jim's local time (UTC-7).

- 00:31:50 and 00:32:30: both stopped at the selection with "2 photo(s) selected, not 1"; nothing was written (`photos` empty) [handle: `run4\mask_verify_2026-10-29T00-31-50-237Z.json` and `run4\mask_verify_2026-10-29T00-32-30-557Z.json`, `steps[0].answer`, `photos`]. Most likely the original and its new virtual copy were both selected after Photo > Create Virtual Copy [inference].
- 00:41:56, on `PICT0019.DNG` (uuid `B8891F0F-C2B8-4EF2-AC4E-B83DF6AFF461`, orientation AB): the engine wrote its probe (Entire Person, instance 0), Lightroom computed it, and found **0 person(s)**, `boxes` []. The harness gives the answer "Lightroom found n person(s)" only when the probe reads as computed (a digest, no ErrorReason) [handle: `engine\src\devtools\masks-verify-person.ts:62-63` and `mask-combine-probe.ts:105-117`, at `1768ad6`] [handle: `run4\mask_verify_2026-10-29T00-41-56-208Z.json`, `photos[0]`, `steps[0]`]. The photo shows two people [stated: Jim, 2026-10-29, "I have selected a .dng photo with two people"]. The part stopped there; no `person_*` kind was asked. Headline FAILED.
- The bridge log of that run (17:41:56-17:42:06 local): `create_snapshot`, `apply_settings` (the probe) at 17:42:00.833, `update_ai_settings` at 17:42:01.223, then 10 `get_settings` polls about 0.5 s apart from 17:42:01.392 to 17:42:06.227 (about 5 s), one more `get_settings`, `select_photo` and `apply_snapshot` (the snapshot put back) at 17:42:06.310 [handle: `run4\bridge_log_excerpt_2026-10-28T17-41.txt`]. The results file keeps no put-back line for this run; the `apply_snapshot` in the log is the put-back [inference].
- With run 1 (`_DSC0103.NEF`, 0 people), that is **2 of 2 probes with no `InstanceBounds`**. The masks Jim made by hand in Phase 6 on a photo of people had `InstanceBounds` [handle: `docs\reports\phase6\masks-capture\capture4-row6_people_by_hand.json`, lines 53 and 132].

### Run 5 (part 2, person, version 1.7.2), 2026-10-29

Jim ran `npm run masks:verify -- --part person --i-know` as step 3 of "Reruns after 1.7.2" (`BATCH-1.7.0-CHECKS.md`). The rerun on 1.7.1 between run 4 and this one is in that file ("Results of the 1.7.1 reruns"); its results file was not copied into the repo. Since 1.7.2 the part passes on a computed Entire Person mask plus Jim's y; it no longer counts people [handle: `BATCH-1.7.0-CHECKS.md`, "Fixed in version 1.7.2"]. Engine and plugin 1.7.2, Lightroom Classic 15.6, one run, 11:30:23 UTC [handle: `docs\reports\phase11\MASKS-VERIFY\run5\mask_verify_2026-10-29T11-30-23-704Z.json`, `engine_version`, `plugin_version`, `lrc_version`, `started`].

- Photo `PICT0019.DNG`, uuid `D9333041-14D1-4817-A4BC-62E466A0358F`, orientation AB [handle: the file, `photos`]. Run 4's `PICT0019.DNG` was `B8891F0F-...`, so this is another photo of that file name, likely the virtual copy the rerun steps name [inference].
- `person_entire`: the probe "AVG verify person" (Entire Person, `MaskSubType` 0, `MaskSubCategoryID` 20036, instance 0, `LocalExposure2012` 0.5) was written; Lightroom computed it in 29,588 ms (`outcome` "computed") and read it back with `MaskSubType` 3, `MaskSubCategoryID` 13, a `MaskDigest`, `ErrorReason` absent, and no `InstanceBounds` [handle: the file, `steps[0].data.ai`, `written`, `read_back`]. The same rewrite of 0 / 20036 to 3 / 13 as on 1.7.1 [handle: `BATCH-1.7.0-CHECKS.md`, 1.7.1 rerun row 3].
- Question "Is a person in the photo brighter (and the background not)?": **Jim y**; the step YES. Headline **WORKED** [handle: the file, `steps[0].answer`, `lines`, `headline`].
- Put back: the file has no put-back line; the plugin log has the snapshot taken at 04:30:46.957 local and applied again at 04:31:25.712 (`apply_snapshot`) [handle: `run5\bridge_log_excerpt_2026-10-29T04-30.txt`]. That the apply put the photo back whole is [inference]: the file records no comparison.

## Numbers

| Field | Value |
|---|---|
| Lightroom version / plugin version | not in the files; 15.6 / 1.6.0 in `perf:check` seven minutes earlier |
| Part 1, photo 1 (`_DSC0028.NEF`): red point; green point | YES (runs 1 and 2); none found |
| Part 1, photo 2 (`_OZ80660.JPG`): red point; green point | **NO** (Jim n); none found |
| Part 1: the engine's sRGB at each point / Lightroom's l, a, b at Jim's red click / the render's sRGB at that pin | 0.692, 0.111, 0.280 (`_DSC0028`) and 0.796, 0.137, 0.099 (`_OZ80660`) / 0.794, 0.842, 0.665 / 0.460, 0.001, 0.113 |
| Part 1: copy of Lightroom's sample | YES |
| Part 2: people found; instance read back; `person_entire`; other kinds | not tested: 0 people found (run 1); a mirrored photo (run 2); run 4: 2 runs stopped at "2 photo(s) selected, not 1", then 0 people found on `PICT0019.DNG` (two people, Jim); **run 5 (1.7.2): `person_entire` computed (29.6 s), read back as `MaskSubType` 3 / `MaskSubCategoryID` 13 with no `InstanceBounds`, Jim y: YES**; one person's mask by instance not tested |
| Part 3: orientations seen; cases per orientation; orientation put back | run 2: BA, AD, DC, CB; 2 of 8 cases PASS (BA B, DC B); put back NO (BA, was AB). Run 1: 4 cases, all export failures; put back YES |
| Put back: YES/NO | run 1 YES; run 2 NO (orientation); run 5: snapshot applied again (log), not compared |

## Verdict

(blank: Jim's.) **Suggested by Claude Code, a suggestion only:** part 1 no-go for the engine's point sample (one NO of three answers) and go for a copy of Lightroom's sample; part 2 (run 5, 1.7.2) go for the Entire Person mask, one person's mask by instance not tested; part 3 no-go: mirrored photos stay refused.

## Consequences / open questions

**Jim's decisions** [stated: Jim, 2026-10-28, "Go with recommendation"], built on branch `fix/phase11-check-followups`:

- **Colour range: the point sample is refused.** `lr_create_mask` and the session refuse a `color_range` without `copy_sample_from` or `geometry.sample` (INVALID_ARGUMENTS, before any wait, no pass used), with a message naming both ways [handle: `engine\src\params\mask-ops.ts` `COLOR_SAMPLE_NEEDED`; `engine\tests\params-mask-kinds.test.ts`, `engine\tests\session-mask-kinds.test.ts`]. Lightroom's sample for red (l 0.79, a 0.84, b 0.66) is on another scale than the engine's sRGB-derived point sample on the same photo (l 0.69, a 0.11, b 0.28) [inference: the two triples above; Automaat's reading of the triple as Lightroom's own per-photo l, a, b is an upstream claim, PR #339]. The `_DSC0028` y with an sRGB triple shows such a triple can select the colour asked for on some photos, not that it does in general [inference].
- **Person masks: no change.** Jim reruns part 2 on a photo of two or more people (steps above).
- **Mirrored photos: the refusal stays** (`CROP_FRAME_UNSUPPORTED`), no mapping change. Radials landed on their points in all four orientations but tilted in six of eight cases, and two did not show (DC case A) [handle: run 2 file, `orientation_*` cases]. Why they tilt is [unverified]; that case B of BA and DC passed while case A failed is not explained either.

**Harness findings and fixes** (same branch):

- **How `_DSC0091.NEF` came to be BA in run 2.** The harness flips nothing itself; Jim's menu actions do. Run 1 ended reading AB, as at its start. Run 2 met the photo already BA at 04:53:24 (colour) and 04:54:07 (person), read AB at 04:55:23 (part 3's start), with nothing written between but two snapshot put-backs of snapshots taken at BA [handle: the log excerpt, those times]. So the orientation changed outside the harness between 04:54:07 and 04:55:23: Jim flipped it after the refusals, or a different photo of the same file name was selected [inference]. A different photo is likely: run 1's `_DSC0091.NEF` was cropped (0.080851 left), run 2's was not (0 left) [handle: both files, case A `crop`], and the catalog holds the master and at least one virtual copy of `_DSC0091.NEF`, both cropped 0.080851 on 2026-10-27 [handle: `docs\reports\phase11\SDKVER\run2\dumps\2026-10-27T04-21-17-106Z\`, `s10__DSC0091.NEF__D838903C.json` and `s10__DSC0091.NEF__Copy 4__DF14E9FC.json`]. The files kept file names only, not uuids, so which photo it was cannot be told [handle: the files' `photo` fields].
- **Why run 2's put-back read BA.** The flip-back was read once, 13 s after the read before it (04:57:27.024 and 04:57:40.617 [handle: the log excerpt]); BA is what the photo reads after the Rotate Right and before the Flip Horizontal [inference: the order BA, AD, DC, CB, then BA]. So either the flip was not done yet when Jim answered, or the read came before Lightroom had it [inference]; the harness neither read again nor asked again. Run 1's third turn read AD again 14 s after the ask, the same kind of miss [handle: run 1 `turn_3`; the log excerpt 04:50:00.497 and 04:50:14.213].
- **Fixed:** the harness now reads every selected photo's uuid and orientation before any part writes, saves them (`photos` in the results file), and stops colour, person and parity on a flipped photo before its snapshot. Part 3 saves the photo's start orientation to `%TEMP%\LrC-AVG\masks-verify\orientation.json` before Jim flips it, reads the flip-back up to five times a second apart, and while it reads otherwise asks one menu action at a time (Flip Horizontal or Rotate Right once) until it reads the start; a run that stops leaves the file, and the next run puts the photo back first. A put-back no longer counts as part 3's yes (run 1 counted it). The results now record the Lightroom and plugin versions [handle: `engine\tests\masks-verify.test.ts`].
- **Run 1's export failures were not caused by the harness** [inference]: each export goes to a fresh folder the plugin makes (`plugin\LrC-AVG.lrplugin\Preview.lua:58-59`), and run 2 made the same calls about 40 times (`export_preview`) without a failure [handle: the log excerpt, 04:55:37-04:57:25]. Run 1's exports were slow before they failed (12.2 s and 7.0 s, against under 1 s in run 2) [handle: the log excerpt, 04:48:38.025-04:48:57.282]. Why Lightroom wrote no JPEG is [unverified].
- **Run 4 (2026-10-29): part 2 is still not tested.** The engine's Entire Person probe found 0 people on a photo Jim says has two (Observed, run 4), as on `_DSC0103.NEF` in run 1. Lightroom's own person masks had `InstanceBounds` in Phase 6 [handle: `docs\reports\phase6\masks-capture\capture4-row6_people_by_hand.json`]. Lightroom computed both probes (Observed, run 4) and gave no boxes, so the probe as the engine writes it likely differs from what Lightroom writes when it finds people [inference; unverified]. The results file keeps only the boxes, not the probe written or read back, so where it differs cannot be read from this run. The fix PR for this batch (version 1.7.1) saves the probe as written and as read back, to be checked by Jim's rerun.
- **Run 5 (2026-10-29, 1.7.2): part 2 passes as now defined** (a computed Entire Person mask and Jim's y). What Lightroom gives back is still not what the engine wrote (kind 0 / 20036 read back as 3 / 13, no `InstanceBounds`), as on 1.7.1 [handle: `run5\mask_verify_2026-10-29T11-30-23-704Z.json`, `read_back`], so masking one person of several by instance stays [unverified].
- **The "2 photo(s) selected" stops:** the batch steps now say to Select None and click the copy after Create Virtual Copy (`BATCH-1.7.0-CHECKS.md` step 12).
- Still [unverified]: one person's masks on a photo of two or more people; why radials tilt on a mirrored photo; a copy of Lightroom's sample on a second photo, or between two photos (Automaat found it selects what ranks like the sample there [upstream claim: PR #341]); a slider dragged in Lightroom just before a mask pass (#343).
