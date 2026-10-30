---
report: CROP-CHECK
phase: "11"
status: template
authored_by: "Claude Code (Opus 5.5): purpose, harness, pre-run findings, steps, 2026-10-29. Observed, Numbers and Verdict: blank, for Jim's run."
date: 2026-10-29
---

# lr_crop in a live session (issue #115)

## Purpose

Issue #115 ("Enhancement: crop, straighten and geometry tools"). The feasibility spike said go: the five crop keys write and read back through Lightroom's develop-settings path with no plugin change [handle: `docs\reports\phase11\CROP-SPIKE.md` "Verdict", run 2]. This check asks whether `lr_crop`, the session's crop and straighten pass (the lr_crop pull request, branch `phase-11/lr-crop`), works in Lightroom: it writes the crop it is asked for, the photo shows it, `reset` clears it, and `lr_end_session` with `revert` puts the crop back from the session snapshot. Whether the snapshot puts a crop back is [unverified] before this run.

**Go rule** (PHASES.md has none for this issue; proposed [inference]): **go** (issue #115 can close, auto-level split into its own issue, as the plan Jim approved on 2026-10-29 says [stated: Jim, 2026-10-29, "Go on all."]) when the check says WORKED and "put back: YES": every step as expected and Jim's y. **Conditional** when the crop passes work and the revert leaves the crop (then a revert needs to write the start crop itself). **No-go** when `lr_crop` is not taken or does not show.

## Harness

`npm run crop:check` (`engine\src\devtools\crop-check-cli.ts`; the shared `step` in `develop-check.ts`, `ask` in `mask-carry-probe.ts`, the pattern of `crop-spike-cli.ts`). It calls `lr_crop` through its MCP definition (the engine's `TOOL_DEFS`: the tool's zod schema, then its handler), as Claude Desktop calls it, and the session tools through the `Tools` class. Results and two renders go to `%TEMP%\LrC-AVG\crop-check\crop_check_<time>.json` and `crop_check_<time>_{4-5-angle-3,16-9}.jpg`. Commands and prerequisites: `.claude\skills\lrc-avg-checks\SKILL.md`.

What it does, in order (the selected photo is only read; every write goes to the check's own copy):
1. Stops before anything is written when the engine has no `lr_crop` tool, or when not exactly one photo is selected.
2. Reads the selected photo's Develop settings and its five crop keys (`CropLeft`, `CropTop`, `CropRight`, `CropBottom`, `CropAngle`).
3. `lr_create_virtual_copies`: copy "AVG crop-check". Only the uuid this call answers is ever removed. The copy's crop keys are read (its start crop), and the copy is selected.
4. `lr_begin_session` on the copy, no intent (pass 0 writes no profile), `max_passes` 4.
5. `lr_crop` {aspect "4:5", angle 3}: expects `ok` and a History name `AVG <id> pass 1/4 crop`. The five keys read back: the four corners inside 0-1, left < right, top < bottom, and `CropAngle` 3 or -3 (which sign Lightroom stores for a clockwise turn is not yet observed [inference]). A render: aspect 0.8 within 2 %.
6. One y/n in the PowerShell window while Develop shows the copy: a portrait 4:5 crop, turned about 3 degrees.
7. `lr_crop` {reset: true}: expects `ok`; the keys read back 0 / 0 / 1 / 1 / 0.
8. `lr_crop` {aspect "16:9"}: expects `ok`; the keys inside 0-1 at angle 0; a render: aspect 1.778 within 2 %.
9. `lr_end_session` revert: expects `ok`, `revert.differing` empty, and the copy's five crop keys back as step 3 read them.
10. `lr_remove_photos` on the copy, looked up again; Jim's photo selected again; its settings, crop keys included, compared with step 2.

The headline is WORKED when every step is as expected and Jim answers y; "put back: YES" when the copy is gone. A run that stops halfway ends the session with revert and removes only its own copy.

## Pre-run findings (Claude Code)

- Checks run on the branch before the push: `npm run build`, `npm run typecheck` (exit 0), `npm run arch:check` ("no dependency violations found (390 modules, 2171 dependencies cruised)"), 2026-10-29.
- The harness was started once by Claude Code on 2026-10-29 by mistake, on `main` without `lr_crop`, with Lightroom open: it connected (plugin 1.7.2, Lightroom 15.6), stopped at step 1 with "this engine has no lr_crop tool ... Nothing was written.", `steps` empty, `copy_left` null [handle: `%TEMP%\LrC-AVG\crop-check\crop_check_2026-10-29T12-42-28-240Z.json`, read and then deleted by Claude Code so it does not count as a run]. That is the refusal path only; no crop was tried.
- The turned-rectangle model of `engine\src\params\crop-frame.ts` predicts the spike's straightened render: stored corners 0.1 / 0.9 / 0.2 / 0.8 at angle 5 on a 1024 × 683 photo give an aspect of 2.5288, against the observed 1024 / 405 = 2.5284 [handle: `node -e "const k=1024/683,a=5*Math.PI/180,dx=0.8*k,dy=0.6;const w=dx*Math.cos(a)+dy*Math.sin(a),h=-dx*Math.sin(a)+dy*Math.cos(a);console.log((w/h).toFixed(4),(1024/405).toFixed(4))"` printed `2.5288 2.5284`, 2026-10-29; the 1024 × 405 render from `docs\reports\phase11\CROP-SPIKE\run1\crop_spike_2026-10-29T12-06-15-398Z.json` `renders`]. So the stored corners are the corners of the turned crop, and `lr_crop` can report its frame from them [inference].
- The check uses one landscape raw photo: a crop on a photo Lightroom turns a quarter or mirrors, with `CropConstrainToUnitSquare` 0, or on a rendered (non-raw) photo stays [unverified] after it.

## Steps for Jim

1. In Lightroom Classic: File > Plug-in Manager, select LrC-AVG, Reload Plug-in, Done.
2. Library module (G): select ONE raw photo in the grid (Version 6, the current process version).
3. Quit Claude Desktop (File > Exit, or the tray icon > Quit).
4. In PowerShell:
   ```powershell
   Set-Location D:\Developer\LrC_Autonomous_Gateway
   npm run crop:check
   ```
5. Do not click in Lightroom while it runs. When the question comes, look at Lightroom's Develop module, which shows the copy "AVG crop-check", and type y or n then Enter.
6. Wait for "Crop check: WORKED" (or FAILED) and "put back: YES", then tell Claude Code "done".

### If something goes wrong

- If it says "this engine has no lr_crop tool": in PowerShell run `git switch main; git pull`, then step 4 again.
- If it says "select ONE raw photo": do step 2 again, then step 4.
- If it says "put back: NO": select the copy "AVG crop-check" in the Library grid, Photo > Remove Photos..., Remove.

## Observed (Jim)

_Blank: filled from Jim's run (the results file under `%TEMP%\LrC-AVG\crop-check\`, copied into `docs\reports\phase11\CROP-CHECK\run1\`)._

## Numbers

| Field | Value |
|---|---|
| Lightroom version, plugin, engine | |
| Headline, put back | |
| lr_crop 4:5 angle 3: status, History name | |
| Crop keys read back after 4:5 angle 3 | |
| Render aspect after 4:5 angle 3 (expected 0.8 ± 2 %) | |
| Jim: portrait 4:5, turned about 3 degrees (y/n) | |
| lr_crop reset: keys read back (expected 0 / 0 / 1 / 1 / 0) | |
| lr_crop 16:9: keys read back, render aspect (expected 1.778 ± 2 %) | |
| lr_end_session revert: `revert.differing` | |
| The copy's crop keys after the revert against its start | |
| Copy removed / selection back / photo unchanged | |

## Verdict

_Blank: decided by Jim after the run._

## Consequences / open questions

- On WORKED: issue #115 closes, and auto-level (horizon detection) gets its own issue (the plan's decision D3, approved by Jim on 2026-10-29 [stated: "Go on all."]).
- If the revert leaves the crop (step 9): the session snapshot does not put a crop back, and the lr_crop pull request's revert keeps the snapshot and reports "crop" as differing; a revert that writes the start crop itself would be the follow-up [inference].
- Still [unverified] after this check: quarter-turned and mirrored photos, `CropConstrainToUnitSquare` 0, rendered (non-raw) photos, and whether `CropAngle` written this way matches the Develop crop tool's straighten ([community], `CROP-SPIKE.md` "Pre-run findings").
