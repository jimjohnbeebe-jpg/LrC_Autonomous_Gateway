---
report: effects
phase: "8.5"
status: template
authored_by: "Claude Code (purpose, harness, pre-run findings, steps); Jim (observed, verdict)"
date: 2026-10-12
---

# Effects panel: post-crop vignette and grain limits (issue #125)

## Purpose

Issue #125: `vignette.amount` is not in the canonical parameter map, so Claude's call was refused with `UNKNOWN_PARAMETER` [handle: issue #125, `logs\engine-20261010.jsonl`]. The Effects keys are pinned from live dumps, but only with a sample value each, not their limits [handle: `engine\src\params\sdk-keys.lrc15.json` lines 660-690, 1516-1575; `sdk-keys.lrc15.rendered.json` from line 3995]. The map takes limits only from an observation (rule 03, PRD FR-4.2). Questions:
1. Which values does Lightroom take for each vignette and grain key on a raw and a rendered photo, and what does it do 1 % beyond the candidate limits?
2. Which `PostCropVignetteStyle` values does it take?
3. Does a negative Amount darken the corners in the export?

Go / no-go [inference: no PHASES.md line covers it]: a key goes into the map with the limits this run read back on both pipelines. A key whose limits differ between the pipelines gets its limits per pipeline, as temperature does. Whether grain goes in as well is Jim's call on #125 after the run (2026-10-12 plan, "Not blocking": "#125: option B (vignette and grain), decided after the probe"). The run counts only with **put back: YES** on both photos.

## Harness

`npm run effects:probe` (`engine\src\devtools\effects-probe.ts`, `effects-probe-cli.ts`, test `engine\tests\effects-probe.test.ts`). It uses existing bridge commands only, and no plugin change. It reuses spike S10's code: the census, the range probe (`s10-probe.ts` `rangeProbeOf`), and the select-snapshot-put-back battery (`s10-writes.ts` `behindSnapshot`).
1. The census of the "fixtures" collection, read only.
2. The first original `20260907-_OZ80093.NEF` on the raw pipeline and the first `DSC_0031.JPG` on the rendered one (the collection holds two originals of each name).
3. For each of the two photos:
   1. Select it, so that Develop checks the writes [handle: `docs\reports\phase8\S10.md`].
   2. Take the snapshot "AVG effects before …".
   3. Write the 8 numeric keys at their candidate limits and 1 % beyond (four batched writes).
   4. Write Style 1, 2, 3, 0 and 4.
   5. Write the keys and Style at their start values with Amount 0, then with Amount -50. Each time, export at the session's preview size and measure the mean luma of the four corner boxes (10 % each) against the centre box (20 %), with sharp.
   6. Apply the snapshot and compare every key: **put back YES/NO**.
4. Your selection is put back. The run asks nothing.

Candidate limits [unverified: our reading of Lightroom's Effects sliders; the run checks them]:

| Key | Candidate min | Candidate max |
|---|---|---|
| `PostCropVignetteAmount` | -100 | 100 |
| `PostCropVignetteMidpoint` | 0 | 100 |
| `PostCropVignetteRoundness` | -100 | 100 |
| `PostCropVignetteFeather` | 0 | 100 |
| `PostCropVignetteHighlightContrast` | 0 | 100 |
| `GrainAmount`, `GrainSize`, `GrainFrequency` | 0 | 100 |
| `PostCropVignetteStyle` | 1, 2, 3 (written alone, with 0 and 4) | |

`GrainSeed` is left out: it is a state key, not a slider [handle: LR_SDK_NOTES "Recorded in Phase 8", `GrainSeed`].

Results go under `%TEMP%\LrC-AVG\effects\`: `effects_probe_<time>.json`, `effects_bridge_log_<time>.txt` and `census\`. Claude Code collects them into `docs\reports\phase8.5\effects\`.

## Pre-run findings (Claude Code)

- The probe runs against the simulated plugin: both photos are written, measured and put back [handle: `npx vitest run tests/effects-probe.test.ts` in `engine\`, "Tests 2 passed (2)", 2026-10-12]. The simulator takes any value, so this shows the harness works, not what Lightroom does.

## Steps for Jim

1. Quit Claude Desktop: right-click the Claude icon in the Windows system tray > **Quit**.
2. In Lightroom, press **D** (Develop).
3. In PowerShell in VS Code, in `D:\Developer\LrC_Autonomous_Gateway`, run:

   ```powershell
   npm run effects:probe
   ```

   The Filmstrip selection jumps between the two photos for a minute or two. Each photo gets 11 History steps named `AVG effects …` and is put back from its snapshot. The snapshot stays in its Snapshots panel.
4. The window ends with **Effects probe: WORKED** or **FAILED**, and one **put back: YES/NO** line per photo.
5. Tell Claude Code "effects done".

### If something goes wrong

- If the window says "another LrC-AVG engine is using the Lightroom bridge", do step 1 again, then step 3.
- If it says the collection holds no original named `20260907-_OZ80093.NEF` or `DSC_0031.JPG`, run `npm run s10:check -- --fixtures`, then step 3 again.
- If a line says **put back: NO**, tell Claude Code.

## Observed (Jim)

*To be filled from the run.*

## Numbers

| Key | Raw: limits taken / 1 % beyond | Rendered: limits taken / 1 % beyond |
|---|---|---|
| `PostCropVignetteAmount` | | |
| `PostCropVignetteMidpoint` | | |
| `PostCropVignetteRoundness` | | |
| `PostCropVignetteFeather` | | |
| `PostCropVignetteHighlightContrast` | | |
| `GrainAmount` | | |
| `GrainSize` | | |
| `GrainFrequency` | | |
| `PostCropVignetteStyle` values taken | | |
| Corners darker at Amount -50 (corner/centre luma at 0 and -50) | | |
| Put back | | |

## Verdict

*Jim.*

## Consequences / open questions

*After the run: the canonical names and limits for #125 (vignette, and grain on Jim's decision), and an LR_SDK_NOTES entry.*
