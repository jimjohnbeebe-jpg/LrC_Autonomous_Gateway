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

On the photo selected in Develop, which must be #187's photo (else nothing is written), behind a snapshot "AVG curve probe before …":

- **a. Session step.** A real engine session without an intent (`lr_begin_session`), then #187's `lr_step`, then `lr_end_session` with `revert`. It records `taken`, or the error code (`WRITE_NOT_TAKEN`, `FEATURE_UNAVAILABLE`) with its mismatches; for a refused step, every key of the photo compared with the settings just before the step (`back_at_pre_step`), and the curve, its name and vibrance as read after the step. Since this PR a refused step is undone whole ("AVG … pass 1/N revert", `details.undone`).
- **b. Direct writes.** From the snapshot, `ToneCurvePV2012` alone, then with the step's vibrance, by uuid as S14 wrote: read back as written or not, and `ToneCurveName2012` as read.
- **c. Point Curve view.** From the snapshot, the 3-point lift `[0,0,128,160,255,255]` (S14's lift took level 128 to 160 on the wedge), then one question.
- **d. Put back.** The snapshot applied and every key compared: **put back: YES/NO**.

Results go under `%TEMP%\LrC-AVG\curve\`: `curve_probe_<time>.json`, `curve_bridge_log_<time>.txt` and the session log in `sessions\`. Claude Code collects them into `docs\reports\phase10\curve-probe\`.

## Pre-run findings (Claude Code)

- The probe runs against the simulated plugin: with the curve dropped (the sim's `ignored`), part a returns `WRITE_NOT_TAKEN` with `undone: true` and the photo back at its pre-step settings, parts b and c read the curve back not taken, the question is asked and the photo is put back; with the curve taken, part a is `taken` and the session's revert puts it back; a photo other than #187's writes nothing [handle: `npx vitest run tests/curve-probe.test.ts` in `engine\`, "Tests 3 passed (3)", 2026-10-25]. The simulator takes or drops a key as told, so this shows the harness works, not what Lightroom does.
- The whole-step undo on its own, with #187's step against the simulator [handle: `npx vitest run tests/session-refused-step.test.ts` in `engine\`, "Tests 4 passed (4)", 2026-10-25].

## Steps for Jim

1. Quit Claude Desktop: right-click the Claude icon in the Windows system tray > **Quit**.
2. In Lightroom, in Library, open the collection that holds `20220828-_DSC1159-HDR.dng`, click that photo (only that one), then press **D** (Develop).
3. In PowerShell in VS Code, in `D:\Developer\LrC_Autonomous_Gateway`, run:

   ```powershell
   npm run curve:probe
   ```

   Lightroom's History panel fills with steps named `AVG …`; the photo changes for a moment and comes back.
4. When the window asks **"In Develop > Tone Curve, click the Point Curve button …"**: in Develop, open the **Tone Curve** panel on the right. At the top of the panel is a row of small curve-type icons; click the second one (Point Curve). Look at the curve, type `y` if it is raised in the middle or `n` if it is a straight diagonal line, then press Enter.
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
