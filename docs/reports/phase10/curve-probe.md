---
report: curve-probe
phase: "10"
status: observed
authored_by: "Claude Code (purpose, harness, pre-run findings, steps); Jim (the run, the y/n answer, Observed, verdict)"
date: 2026-10-26
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

Run 3 (after run 2, 2026-10-26 03:06Z, had `ToneCurvePV2012` refused under all three profiles) adds the extended curve (part e) [stated: Jim, 2026-10-26, "Run 3: write the extended curve (Recommended)"]. Run 2's settings dump shows the photo in HDR edit mode (`HDREditMode` 1, `HDRMaxValue` 2.3) with four keys the raw pin lacks, `ExtendedToneCurvePV2012` and its `Red`/`Green`/`Blue`, all `[0,0,255,255]` [handle: `docs\reports\phase10\curve-probe\run2\curve_probe_settings_20220828-_DSC1159-HDR.dng__65937445.json`, `settings`, `meta.extra_keys`]; the S5 dumps have `HDREditMode` 0 [handle: `docs\reports\phase0\S5\*.json:86`], and S10 saw the `ExtendedToneCurvePV2012*` keys only on HDR photos [handle: vault `LR_SDK_NOTES.md` "Recorded in Phase 8"]. The hypothesis run 3 tests: in HDR edit mode Lightroom's point curve is `ExtendedToneCurvePV2012`, and `ToneCurvePV2012` is ignored [inference]. Same command, same photo, still at most one question.

Before any write, the photo's settings (`get_settings`) are saved as `census\curve_probe_settings_20220828-_DSC1159-HDR.dng__<uuid8>.json`, laid out as the S5 dumps are (`{ meta, settings }`), so they can be compared with `docs\reports\phase10\S14\run2\s14_monochrome_*NEF*.json` and the `docs\reports\phase0\S5` dumps. `meta` has no `spike` field: the dump is compared, never pinned, so it does not go through `s5DumpSchema`. The results' `settings_dump` lists the keys this photo carries that the raw pin (`engine\src\params\sdk-keys.lrc15.json`) does not (`not_in_raw_pin`) and the pinned keys it lacks (`pinned_not_in_photo`).

On the photo selected in Develop, which must be #187's photo (else nothing is written), behind a snapshot "AVG curve probe before …":

- **a. Session step.** A real engine session without an intent (`lr_begin_session`), then #187's `lr_step`, then `lr_end_session` with `revert`. It records `taken`, or the error code (`WRITE_NOT_TAKEN`, `FEATURE_UNAVAILABLE`) with its mismatches; for a refused step, every key of the photo compared with the settings just before the step (`back_at_pre_step`), and the curve, its name and vibrance as read after the step. Since this PR a refused step is undone whole ("AVG … pass 1/N revert", `details.undone`).
- **b. Direct writes.** From the snapshot, `ToneCurvePV2012` alone, then with the step's vibrance, by uuid as S14 wrote: read back as written or not, and `ToneCurveName2012` as read.
- **c. Profile sweep.** For each raw profile of Adobe Color, Adobe Standard and Adobe Landscape (the photo's own), from the snapshot as S14 starts each curve variant: the profile pair written through the params map (`cameraProfiles().toSdk`) and read back (taken when Lightroom reads back that pinned pair), then #187's curve `[0,0,64,56,128,128,192,200,255,255]` straight through the bridge, as in part b: taken, read-back and `ToneCurveName2012`, per profile. A curve counts for a profile only when the profile was taken. The results' `profile_sweep.suggestion` (a suggestion; the verdict is Jim's) reads "profile is the cause" when the curve was taken under some profile and not under Adobe Landscape, "photo is the cause" when it was refused under all three, "mixed" otherwise.
- **e. Extended curve** (run 3; runs after the sweep, before d). From the snapshot, #187's curve `[0,0,64,56,128,128,192,200,255,255]` written to `ExtendedToneCurvePV2012` straight through the bridge, as in part b: taken and read-back, then `ToneCurvePV2012` and `ToneCurveName2012` as read after it (`curve.standard_after`: does the extended write move the standard curve or the name?). Then, from the snapshot again, the 3-point lift `[0,0,128,160,255,255]` to `ExtendedToneCurvePV2012`: taken, and left on the photo for part d. On a photo whose settings have no `ExtendedToneCurvePV2012`, part e is skipped and the results say why (it counts as completed). The results' `extended_curve.suggestion` (a suggestion; the verdict is Jim's) reads "HDR mode uses ExtendedToneCurvePV2012" when both extended writes were taken and every standard curve write of parts b and c was refused, "extended curve refused too" when the extended writes were refused as well, "mixed" otherwise.
- **d. Point Curve view.** One question, on the first state where a curve read back taken: under the first profile of the sweep that took the curve, from the snapshot, the 3-point lift `[0,0,128,160,255,255]` (S14's lift took level 128 to 160 on the wedge), asked when that lift read back taken; otherwise, when part e's extended lift was taken, asked with that lift still on the photo, which then goes back to the snapshot. The results' `point_curve.asked_on` names the curve the answer is about: "ToneCurvePV2012 under <profile>" or "ExtendedToneCurvePV2012". When neither holds, the question is not asked and the results say why. Run 1 asked the same question on a refused curve; runs 2 and 3 ask it at most once, only on a taken curve.
- **f. Put back.** The snapshot applied and every key compared: **put back: YES/NO**.

The headline is **WORKED** when nothing failed, every part completed and the photo was put back, whatever the curve did.

Results go under `%TEMP%\LrC-AVG\curve\`: `curve_probe_<time>.json`, `curve_bridge_log_<time>.txt`, the session log in `sessions\` and the settings dump in `census\`. Claude Code collects them into `docs\reports\phase10\curve-probe\`.

## Pre-run findings (Claude Code)

- The probe runs against the simulated plugin: with the curve dropped (the sim's `ignored`), part a returns `WRITE_NOT_TAKEN` with `undone: true` and the photo back at its pre-step settings, parts b and c read the curve back not taken, the question is asked and the photo is put back; with the curve taken, part a is `taken` and the session's revert puts it back; a photo other than #187's writes nothing; a begin that fails in pass 0, or a read that throws before the session ends, leaves no session open, and the next run works (Greptile, PR #200) [handle: `npx vitest run tests/curve-probe.test.ts` in `engine\`, "Tests 5 passed (5)", 2026-10-25].
- Run 2's probe against the simulator (the bullet above is run 1's code; parts a and b and the failure cases are unchanged, the question has moved after the sweep): with the curve dropped under every profile, the sweep suggests "photo is the cause" and the question is not asked; with the curve dropped under Adobe Landscape only, it suggests "profile is the cause" and the question is asked on the lift taken under Adobe Color; with the curve taken everywhere it reads "mixed"; the settings dump holds the photo's settings as before any write; put back YES in each [handle: `npx vitest run tests/curve-probe.test.ts` in `engine\`, "Tests 6 passed (6)", 2026-10-25]. The simulator takes or drops a key as told, so this shows the harness works, not what Lightroom does.
- Run 3's probe against the simulator: a simulated photo given `HDREditMode` 1 and `ExtendedToneCurvePV2012` `[0,0,255,255]` (added in the test only) that drops `ToneCurvePV2012` and takes the extended key has part e's curve and lift taken, `ToneCurvePV2012` still `[0,0,255,255]` after the extended write, the suggestion "HDR mode uses ExtendedToneCurvePV2012", the one question asked with the extended lift on the photo (`asked_on` "ExtendedToneCurvePV2012") and put back YES; the simulator's own photo (the S5 NEF dump, `HDREditMode` 0, no extended key) has part e skipped with the reason and the question not asked when every profile drops the curve; with the curve dropped under Adobe Landscape only, the question is asked on the lift under Adobe Color (`asked_on` "ToneCurvePV2012 under Adobe Color") [handle: `npx vitest run tests/curve-probe.test.ts` in `engine\`, "Tests 8 passed (8)", 2026-10-25]. As above, this shows the harness works, not what Lightroom does with the extended key.
- The whole-step undo on its own, with #187's step against the simulator, also for a refused guard correction after the step for a photo made black and white with a colour profile, for an unpinned profile, and for the white balance mode a temperature step set to "Custom" (Greptile, PR #200) [handle: `npx vitest run tests/session-refused-step.test.ts` in `engine\`, "Tests 10 passed (10)", 2026-10-25].

## Steps for Jim

1. Quit Claude Desktop: right-click the Claude icon in the Windows system tray > **Quit**.
2. In Lightroom, in Library, open the collection that holds `20220828-_DSC1159-HDR.dng`, click that photo (only that one), then press **D** (Develop).
3. In PowerShell in VS Code, in `D:\Developer\LrC_Autonomous_Gateway`, run:

   ```powershell
   npm run curve:probe
   ```

   Lightroom's History panel fills with steps named `AVG …`, among them `AVG curve probe profile Adobe Color`, `… Adobe Standard`, `… Adobe Landscape`, `AVG curve probe extended curve` and `AVG curve probe extended lift`; the photo changes profile, colour and brightness for a moment and comes back.
4. If the window asks **"In Develop > Tone Curve, click the Point Curve button …"**: in Develop, open the **Tone Curve** panel on the right. At the top of the panel is a row of small curve-type icons; click the second one (Point Curve). Look at the curve, type `y` if it is raised in the middle or `n` if it is a straight diagonal line, then press Enter. The question may be about the extended curve (when the window printed `extended lift taken true` just before it): it is the same Point Curve icon and the same look. If the window prints `d. Point Curve question not asked: …` instead, there is nothing to answer.
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

### Run 1

Jim ran `npm run curve:probe` on 2026-10-26, 02:41:19-02:42:29Z, Lightroom 15.6, plugin and engine 1.2.0, with `20220828-_DSC1159-HDR.dng` selected in Develop, and said "curve probe done" [stated]. Claude Code read the saved files, collected in `docs\reports\phase10\curve-probe\run1\`: the results `curve_probe_2026-10-26T02-41-19-233Z.json` (cited below as "results"), the session log `20261025-5a7f30.json`, and `bridge_log_excerpt.txt` (the plugin's log from 19:41:19 local; one WARN, `stall 1148 ms after idle`, no ERROR).

- **Headline: WORKED**, no errors; **put back: YES**, 184 keys compared, none differing [handle: results `headline`, `errors`, `photo.put_back`].
- The photo: raw DNG, PV 15.4, profile Adobe Landscape, uuid `65937445-C308-4B2E-B1CD-F38C7EE40E0D`, the same as #187 [handle: results `photo`; session log `target.camera_profile`].
- **a. The session step was refused**, `WRITE_NOT_TAKEN`: `ToneCurvePV2012` written as #187's five points read back `[0, 0, 255, 255]`. The step was undone as "AVG 5a7f30 pass 1/8 revert", **the photo was back at its pre-step settings** (`back_at_pre_step.ok`, no key differing), and the pass was not used [handle: results `photo.session_step`]. Vibrance was already 7 before the step (Jim's earlier session on this photo), so on this photo the curve was the only value the step changed [handle: session log `start.settings.vibrance`]; the undo of a value Lightroom did take is covered by the simulator tests of PR #200 (`engine\tests\session-refused-step.test.ts`).
- **b. The same curve written directly through the bridge** (S14's write) **was refused too**: read back `[0, 0, 255, 255]`, `ToneCurveName2012` "Linear", alone and with Vibrance 14 (Vibrance 14 was taken) [handle: results `photo.direct.writes`].
- **c. The 3-point lift was refused** as well (read back linear, name "Linear"). Jim answered **n** (the Point Curve view showed a straight line) [handle: results `questions[0]`]. Since the lift was not on the photo, a straight line was the right view, and this run does not answer S14's panel question.
- The session's pass budget came from the settings page as 8 [handle: session log `max_passes` 8, `settings.from.max_passes` "page"]. Whether Jim's page had stored 4 before 1.2.0 (and `Prefs.migrate` moved it) is not recorded [unverified].

## Numbers

| Field | Value |
|---|---|
| a. Session step: taken / refused (code) | refused (`WRITE_NOT_TAKEN`) |
| a. If refused: photo back at its pre-step settings (keys differing) | yes (none) |
| a. `ToneCurvePV2012` and `ToneCurveName2012` read after the step | `[0, 0, 255, 255]`, "Linear" |
| b. Direct curve alone: taken | no |
| b. Direct curve + vibrance: taken | no (Vibrance 14 taken) |
| c. Lift taken; Point Curve view shows it raised (Jim) | no; n |
| d. Put back | YES (184 keys) |

All from run 1's results, `docs\reports\phase10\curve-probe\run1\curve_probe_2026-10-26T02-41-19-233Z.json`.

## Verdict

**Go** [stated: Jim, 2026-10-26, "Go (Recommended)"]: the probe answered its question. The engine's write path is not #187's cause, the photo (or its profile) is, and a refused step is undone whole.

## Consequences / open questions

- **#187's cause is the photo or its profile, not the engine's write.** Parts a and b were both refused on this DNG, while S14 took every curve write on the NEF (Adobe Standard) and on a rendered chart [handle: run 1 results `photo.direct`; `docs\reports\phase10\S14.md` "a. Tone curve"]. Which of the two it is: [unverified]. Candidates [inference]: the photo is an HDR merge DNG; Adobe Landscape's Look carries its own tone curve [handle: `docs\reports\phase0\S5.md` "Looks carry adjustments"].
- **#187 stays open** and is isolated now [stated: Jim, 2026-10-26, "Keep #187 open, isolate now"]: run 2 (below, "Harness") writes the curve under three raw profiles on the same photo, saves its full settings, and asks the Point Curve question only on a state where a curve read back taken.
- **L-2:** "a refused step leaves nothing on the photo" holds on this photo [handle: run 1 `back_at_pre_step`]; "a curve write is taken" holds on the NEF and the rendered chart (S14) and not on this DNG.
- **S14's panel question** (a taken curve that the panel showed straight) is still open; run 2 asks it on a taken curve if any profile takes one.
