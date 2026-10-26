---
report: curve-probe
phase: "10"
status: template
authored_by: "Claude Code (purpose, harness, pre-run findings, steps); Jim (the run, the y/n answer, Observed, verdict)"
date: 2026-10-25
---

# Curve probe: issue #187 on its own photo

## Purpose

Phase 10 row 2 (vault `PHASE10_PLAN.md`; this PR's plan approved by Jim 2026-10-25 [stated: "Go A+B+C+D (Recommended)"]). Spike S14 found that every curve write was taken on the raw NEF and on the grey wedge, so **#187's refusal did not reproduce** there; the photo, its profile (Adobe Landscape, whose Look carries its own tone curve) and the write path (an engine session against the S14 harness) all differ from #187's [handle: `docs\reports\phase10\S14.md` "a. Tone curve"]. S14 also found that a written point curve rendered but **did not show in the Tone Curve panel** [stated: Jim, 2026-10-25, "the curve was still straight"]. This probe answers three questions on #187's photo, `20220828-_DSC1159-HDR.dng` (uuid `65937445-C308-4B2E-B1CD-F38C7EE40E0D`) [handle: issue #187 "Summary"]:

1. Does #187's exact `lr_step` (`{"tone_curve.master": [0,0,64,56,128,128,192,200,255,255], "vibrance": 7}`), run through a real engine session, get taken now? If it is refused, is the photo back at its pre-step settings afterwards?
2. Is the same curve taken when written straight through the bridge, as S14 wrote it? That separates the write path from the photo and its profile.
3. Does the Tone Curve panel show a written curve in its Point Curve view? The panel may open on the Parametric view, which would explain S14's straight line [inference].

Go / no-go (PHASE10_PLAN acceptance L-2): "#187 closed: a curve write is taken, and a refused step leaves nothing on the photo." Issue #187 closes only after this run.

Jim answers the question as y/n in the PowerShell window running the probe, as in S10 and S14 (rule 04 "Steps for Jim") [stated: Jim, 2026-10-25, "Go A+B+C+D (Recommended)", the row 2 plan].

## Harness

`npm run curve:probe`: `engine\src\devtools\curve-probe.ts` (the steps) and `curve-probe-cli.ts`; test `engine\tests\curve-probe.test.ts`. Existing bridge commands only, no plugin change. It reuses S10's select-snapshot-put-back (`behindSnapshot`) and S14's write and read-back helpers.

Run 2 (after run 1 on 2026-10-26 had every curve write refused on this photo, through the session and straight through the bridge, read back `[0,0,255,255]` with `ToneCurveName2012` "Linear" [stated: Jim, 2026-10-26, "Keep #187 open, isolate now"]) adds the profile sweep (part c), moves the Point Curve question after it (part d) and saves the photo's settings first. Same command, same photo, no flag.

Before any write, the photo's settings (`get_settings`) are saved as `census\curve_probe_settings_20220828-_DSC1159-HDR.dng__<uuid8>.json`, laid out as the S5 dumps are (`{ meta, settings }`), so they can be compared with `docs\reports\phase10\S14\run2\s14_monochrome_*NEF*.json` and the `docs\reports\phase0\S5` dumps. `meta` has no `spike` field: the dump is compared, never pinned, so it does not go through `s5DumpSchema`. The results' `settings_dump` lists the keys this photo carries that the raw pin (`engine\src\params\sdk-keys.lrc15.json`) does not (`not_in_raw_pin`) and the pinned keys it lacks (`pinned_not_in_photo`).

On the photo selected in Develop, which must be #187's photo (else nothing is written), behind a snapshot "AVG curve probe before …":

- **a. Session step.** A real engine session without an intent (`lr_begin_session`), then #187's `lr_step`, then `lr_end_session` with `revert`. It records `taken`, or the error code (`WRITE_NOT_TAKEN`, `FEATURE_UNAVAILABLE`) with its mismatches; for a refused step, every key of the photo compared with the settings just before the step (`back_at_pre_step`), and the curve, its name and vibrance as read after the step. Since this PR a refused step is undone whole ("AVG … pass 1/N revert", `details.undone`).
- **b. Direct writes.** From the snapshot, `ToneCurvePV2012` alone, then with the step's vibrance, by uuid as S14 wrote: read back as written or not, and `ToneCurveName2012` as read.
- **c. Profile sweep.** For each raw profile of Adobe Color, Adobe Standard and Adobe Landscape (the photo's own), from the snapshot as S14 starts each curve variant: the profile pair written through the params map (`cameraProfiles().toSdk`) and read back (taken when Lightroom reads back that pinned pair), then #187's curve `[0,0,64,56,128,128,192,200,255,255]` straight through the bridge, as in part b: taken, read-back and `ToneCurveName2012`, per profile. A curve counts for a profile only when the profile was taken. The results' `profile_sweep.suggestion` (a suggestion; the verdict is Jim's) reads "profile is the cause" when the curve was taken under some profile and not under Adobe Landscape, "photo is the cause" when it was refused under all three, "mixed" otherwise.
- **d. Point Curve view.** Under the first profile of the sweep that took the curve, from the snapshot, the 3-point lift `[0,0,128,160,255,255]` (S14's lift took level 128 to 160 on the wedge), then one question, asked only when the lift read back taken. When no profile took the curve, the question is not asked and the results say why. Run 1 asked the same question on a refused curve; run 2 does not ask it twice.
- **e. Put back.** The snapshot applied and every key compared: **put back: YES/NO**.

The headline is **WORKED** when nothing failed, every part completed and the photo was put back, whatever the curve did.

Results go under `%TEMP%\LrC-AVG\curve\`: `curve_probe_<time>.json`, `curve_bridge_log_<time>.txt`, the session log in `sessions\` and the settings dump in `census\`. Claude Code collects them into `docs\reports\phase10\curve-probe\`.

## Pre-run findings (Claude Code)

- The probe runs against the simulated plugin: with the curve dropped (the sim's `ignored`), part a returns `WRITE_NOT_TAKEN` with `undone: true` and the photo back at its pre-step settings, parts b and c read the curve back not taken, the question is asked and the photo is put back; with the curve taken, part a is `taken` and the session's revert puts it back; a photo other than #187's writes nothing; a begin that fails in pass 0, or a read that throws before the session ends, leaves no session open, and the next run works (Greptile, PR #200) [handle: `npx vitest run tests/curve-probe.test.ts` in `engine\`, "Tests 5 passed (5)", 2026-10-25].
- Run 2's probe against the simulator (the bullet above is run 1's code; parts a and b and the failure cases are unchanged, the question has moved after the sweep): with the curve dropped under every profile, the sweep suggests "photo is the cause" and the question is not asked; with the curve dropped under Adobe Landscape only, it suggests "profile is the cause" and the question is asked on the lift taken under Adobe Color; with the curve taken everywhere it reads "mixed"; the settings dump holds the photo's settings as before any write; put back YES in each [handle: `npx vitest run tests/curve-probe.test.ts` in `engine\`, "Tests 6 passed (6)", 2026-10-25]. The simulator takes or drops a key as told, so this shows the harness works, not what Lightroom does.
- The whole-step undo on its own, with #187's step against the simulator, also for a refused guard correction after the step for a photo made black and white with a colour profile, for an unpinned profile, and for the white balance mode a temperature step set to "Custom" (Greptile, PR #200) [handle: `npx vitest run tests/session-refused-step.test.ts` in `engine\`, "Tests 10 passed (10)", 2026-10-25].

## Steps for Jim

1. Quit Claude Desktop: right-click the Claude icon in the Windows system tray > **Quit**.
2. In Lightroom, in Library, open the collection that holds `20220828-_DSC1159-HDR.dng`, click that photo (only that one), then press **D** (Develop).
3. In PowerShell in VS Code, in `D:\Developer\LrC_Autonomous_Gateway`, run:

   ```powershell
   npm run curve:probe
   ```

   Lightroom's History panel fills with steps named `AVG …`, among them `AVG curve probe profile Adobe Color`, `… Adobe Standard` and `… Adobe Landscape`; the photo changes profile and colour for a moment and comes back.
4. If the window asks **"In Develop > Tone Curve, click the Point Curve button …"**: in Develop, open the **Tone Curve** panel on the right. At the top of the panel is a row of small curve-type icons; click the second one (Point Curve). Look at the curve, type `y` if it is raised in the middle or `n` if it is a straight diagonal line, then press Enter. If the window prints `d. Point Curve question not asked: …` instead, there is nothing to answer.
5. The window ends with **Curve probe: WORKED** or **FAILED**, then **put back: YES** or **NO**.
6. Tell Claude Code "curve probe done".

The photo keeps two snapshots in its Snapshots panel, "AVG curve probe before …" and the session's "AVG pre-session …". They change nothing on the photo.

## If something goes wrong

- If the window says "another LrC-AVG engine is using the Lightroom bridge", do step 1 again, then step 3.
- If it says "select one photo" or "the selected photo is …, not 20220828-_DSC1159-HDR.dng", do step 2 again, then step 3. Nothing was written.
- If it says the original file is missing, reconnect it (Library > Find All Missing Photos), then do step 3 again.
- If you cannot find the Point Curve button, type `n` and tell Claude Code what the panel showed.
- If the window says **put back: NO**, tell Claude Code. In Develop, the Snapshots panel (left) > "AVG curve probe before …" puts the photo back.

## Observed (Jim)

_To be filled from the run: date and time, Lightroom and plugin version, Jim's answer, and the saved results._

## Numbers

| Field | Value |
|---|---|
| a. Session step: taken / refused (code) | |
| a. If refused: photo back at its pre-step settings (keys differing) | |
| a. `ToneCurvePV2012` and `ToneCurveName2012` read after the step | |
| b. Direct curve alone: taken | |
| b. Direct curve + vibrance: taken | |
| c. Lift taken; Point Curve view shows it raised (Jim) | |
| d. Put back | |

## Verdict

_Jim's._

## Consequences / open questions

- If part a is taken: #187's refusal was not the engine's write, and #187 closes on L-2 with part a's handle (the partial-write undo is in place either way).
- If part a is refused and part b taken: the write path matters: the session writes by `target_uuid` to the selected photo [handle: `engine\src\session\io.ts` `writeSdk`], S14 by `photo_uuid` [handle: `engine\src\devtools\s10-config.ts` `write`], and why that would change what Lightroom takes is [unverified]; row 2 follows it up before #187 closes.
- If parts a and b are both refused: the photo or its profile matters (Adobe Landscape's Look carries its own tone curve) [unverified].
- If part c's answer is `y`: the panel shows a written curve in its Point Curve view, and the "every edit shows on the Develop sliders" rule holds for curves; S14's straight line was the Parametric view [inference until then].
