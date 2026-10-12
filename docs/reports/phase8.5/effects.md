---
report: effects
phase: "8.5"
status: observed
authored_by: "Claude Code (purpose, harness, pre-run findings, steps, observed transcribed from the saved results, numbers); Jim (the run, verdict)"
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

Jim ran `npm run effects:probe` on 2026-10-12, 13:17:04-13:17:30Z, Lightroom 15.6, plugin 0.21.0, and said "effects done" [stated]. Claude Code transcribed the run below from the saved files:
- results: `docs\reports\phase8.5\effects\effects_probe_2026-10-12T13-17-04-307Z.json`;
- the plugin's log for the run window: `effects\bridge_log_excerpt.txt`, 109 lines, all INFO.

Both photos were found:
- the raw one: `20260907-_OZ80093.NEF`, uuid `C9967541…`, process version 15.4;
- the rendered one: `DSC_0031.JPG`, uuid `81FFC502…`, process version 11.0.

Both were selected before their writes. The headline was **Effects probe: WORKED**, with no errors. Both photos were **put back: YES**, 0 keys differing (177 keys compared on the NEF, 172 on the JPEG).

What the probe's outcome labels mean here: every value 1 % beyond a limit read back as the photo's value from **before the probe**. It did not read back the limit, or the previous write's value. The probe labels these reads `other`, `ignored` and `clamped`, depending only on whether that start value happens to equal the previous write or the limit (spike S10 explains the same reading [handle: `docs\reports\phase8\S10.md`, "How to read the 1 % beyond columns"]).

On both photos the start values are those of an untouched Effects panel [inference: they equal the samples in the pinned dump], so this run cannot tell "back to the start value" from "reset to the default" [handle: the run's census dumps, `effects\s10_20260907-_OZ80093.NEF__C9967541.json` and `effects\s10_DSC_0031.JPG__81FFC502.json`]. The start values equal the pinned samples:
- `PostCropVignetteAmount` 0, `PostCropVignetteMidpoint` 50, `PostCropVignetteRoundness` 0, `PostCropVignetteFeather` 50, `PostCropVignetteHighlightContrast` 0, `PostCropVignetteStyle` 1;
- `GrainAmount` 0, `GrainSize` 25, `GrainFrequency` 50

[handle: `engine\src\params\sdk-keys.lrc15.json` `sample`].

## Numbers

All from the results file, `photos[*].range.per_parameter`, `.style.steps` and `.luma`.

| Key | Raw (NEF): limits taken / 1 % beyond | Rendered (JPEG): limits taken / 1 % beyond |
|---|---|---|
| `PostCropVignetteAmount` | -100 and 100 taken / -102 and 102 read back 0 (start) | same |
| `PostCropVignetteMidpoint` | 0 and 100 taken / -1 and 101 read back 50 (start) | same |
| `PostCropVignetteRoundness` | -100 and 100 taken / -102 and 102 read back 0 (start) | same |
| `PostCropVignetteFeather` | 0 and 100 taken / -1 and 101 read back 50 (start) | same |
| `PostCropVignetteHighlightContrast` | 0 and 100 taken / -1 and 101 read back 0 (start) | same |
| `GrainAmount` | 0 and 100 taken / -1 and 101 read back 0 (start) | same |
| `GrainSize` | 0 and 100 taken / -1 and 101 read back 25 (start) | same |
| `GrainFrequency` | 0 and 100 taken / -1 and 101 read back 50 (start) | same |
| `PostCropVignetteStyle` | 1, 2 and 3 taken; 0 and 4 read back 1 (start) | same |
| Corner/centre luma at Amount 0 → -50 | 1.949 → 0.921 (corners 118.9 → 56.2, centre 61.0 → 61.0): darker | 0.757 → 0.259 (corners 83.1 → 28.5, centre 109.8 → 109.8): darker |
| Put back | YES, 0 differing of 177 | YES, 0 differing of 172 |

## Verdict

*Jim.* Suggested by the probe: **WORKED**. The candidate limits hold on both pipelines, and a negative Amount darkens the corners.

## Consequences / open questions

- **For #125:** the eight keys can go into the canonical map with these limits, the same on both pipelines. The limits are:
  - Amount and Roundness: -100 to 100;
  - Midpoint, Feather, Highlights and the three grain keys: 0 to 100;
  - Style: 1, 2 or 3.

  Whether grain goes in with the vignette is Jim's call on #125 (2026-10-12 plan, "Not blocking": option B).
- **An out-of-range Effects value is not taken and not clamped.** It reads back as the photo's start value, as most Basic sliders did in S10 [handle: `docs\reports\phase8\S10.md`]. The map refuses out-of-range values before any write (PRD FR-4.2), so the engine never sends one.
  - Both photos started at the defaults, so whether that is the start value or the default is [unverified].
  - All 8 keys were beyond their limits in the same write, so whether Lightroom does this per key or for the whole write is also [unverified].
- **The names of Style 1-3 in Lightroom's menu** (the probe only read the numbers back) are [unverified]. Lightroom's Effects panel offers Highlight Priority, Color Priority and Paint Overlay [inference: from the panel, not observed by this probe]. Pin them only from a recorded click, as profiles were pinned.
- LR_SDK_NOTES gets a "Recorded in Phase 8.5" entry with the limits, the reset to start values, and the corner darkening.
