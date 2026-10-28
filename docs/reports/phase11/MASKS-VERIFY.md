---
report: MASKS-VERIFY
phase: "11"
status: template
authored_by: "Claude Code (purpose, harness, pre-run findings, steps for Jim; 2026-10-27, night run on branch phase-11/masks-210); Jim (Observed, verdict)"
date: 2026-10-27
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

1. **Colour (two photos selected).** For each photo, behind a snapshot: renders it, finds the clearly reddest and greenest place (sharp, 48-cell grid, one channel 0.25 above the other two), writes a colour range there exactly as `lr_create_mask` does without a sample (the preview's sRGB at the point), +2 EV, and asks whether that colour brightened and only that colour. On the first photo it then asks Jim to click the red place with Lightroom's own Color Range, reads the l, a, b Lightroom stored (and the render's sRGB at its pin, for comparison), writes a copy of it (`copy_sample_from`) with +2 EV, and asks whether the red parts brightened.
2. **Person (one photo of two or more people).** Writes the engine's probe (Entire Person, instance 0), lets Lightroom compute it, reads every person's box; then writes each of the eleven `person_*` kinds for the second person (instance 1) one at a time, each computed by Lightroom, and asks whether that person's part brightened and the first person's did not. A kind Lightroom finds nothing of (ErrorReason) is skipped; an AI mask with no result in 3 minutes stops the part.
3. **Mirror (one photo not flipped).** Jim flips it (Photo > Flip Horizontal) and turns it three times (Photo > Rotate Right); in each of the four mirrored orientations, `npm run masks:crop`'s case A (the photo's own crop) and case B (its crop turned 10 degrees), with the mirrored refusal lifted for this check only (`withMirrorMapping`): three radials and the issue #179 gradient, rendered and measured with sharp, no question. Jim then turns and flips the photo back and the check reads the orientation back.

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
6. When asked, in Lightroom choose Tools > Create New Mask > Color Range, click the red place the question names, then type `y`.
7. Part 2 asks you to select the photo of people: click it, type `y`. Each mask takes a few seconds for Lightroom to compute; answer each question.
8. Part 3 asks you to select the photo not flipped: click it, type `y`. Then do each step it names in Lightroom and type `y` after it: Photo > Flip Horizontal; then Photo > Rotate Right (Ctrl+]) three times, one at a time; at the end Photo > Rotate Right once more and Photo > Flip Horizontal.
9. You see `Mask verify: WORKED` or `FAILED`, then `put back: YES` or `NO`. Tell Claude Code "done".

### If something goes wrong

- If it says "photo(s) selected, not 2" (or 1): select as asked, then run the command again with the part, for example `npm run masks:verify -- --part person`.
- If part 1 says "no clearly red area" or "no clearly green area": choose another colourful photo and run `npm run masks:verify -- --part colour`.
- If part 2 says "Lightroom found 1 person(s)": choose a photo where the people do not overlap and run `npm run masks:verify -- --part person`.
- If the Develop Photo menu has no Flip Horizontal: switch to Library (G), use Photo > Flip Horizontal there, switch back to Develop (D), then type `y`.
- If it says "reload the LrC-AVG plugin": File > Plug-in Manager, LrC-AVG, Reload Plug-in, then run the command again.
- If `put back: NO`: in Develop, select the photo the line names, open the Snapshots panel (left) and click "AVG masks:verify before". If the line is `orientation_put_back`, flip and turn the photo back by hand (Photo > Flip Horizontal, Photo > Rotate Left or Right).

## Observed (Jim)

(blank: filled from the run's results file and Jim's answers)

## Numbers

| Field | Value |
|---|---|
| Lightroom version / plugin version | |
| Part 1, photo 1: red point YES/NO; green point YES/NO | |
| Part 1, photo 2: red point YES/NO; green point YES/NO | |
| Part 1: the engine's sRGB at each point / Lightroom's l, a, b at Jim's red click / the render's sRGB at that pin | |
| Part 1: copy of Lightroom's sample YES/NO | |
| Part 2: people found; instance read back; `person_entire` YES/NO; other kinds YES / NO / skipped | |
| Part 3: orientations seen; case A and B per orientation PASS/FAIL; orientation put back | |
| Put back: YES/NO | |

## Verdict

(blank: Jim's)

## Consequences / open questions

- Decisions parked for Jim (from the night run): see the PR description, "Decisions for Jim".
  - Part 1 NO: refuse the point-sampled colour range (`color_range` without `copy_sample_from` or `geometry.sample`), or keep it with the [unverified] note.
  - Part 2 NO: refuse `person_*` on a photo where Lightroom finds two or more people (the probe already reads the boxes), saying why in the tool text.
  - Part 3 all YES: lift `CROP_FRAME_UNSUPPORTED` for mirrored photos (crop-frame.ts: drop the mirrored refusal; tests and tool text follow).
- Still [unverified] after this check: how a crop angle reads on a mirrored photo beyond the 10-degree case; a copy between two different photos (Automaat found it selects what ranks like the sample there [upstream claim: PR #341]); a slider dragged in Lightroom just before a mask pass (#343).
