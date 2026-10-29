---
report: CLIP-RES
phase: "11"
status: template
authored_by: "Claude Code (Opus 5.5): purpose, harness, pre-run findings, steps, 2026-10-29. Observed, Numbers and Verdict: blank, for Jim's run."
date: 2026-10-29
---

# Export time and clipping at 1600, 2560 and 4096 px (issue #168)

## Purpose

Issue #168 ("Enhancement: clip evaluated at export resolution"): "1600 px session previews understate clipping at print size." The engine's own tool help says the same: session previews are 1600 px by default, and "downscaling averages pixels, so they understate clipping and fine detail at print size" [handle: `engine\src\mcp\defs-help.ts:24-25`].

The feature PR for issue #168 (branch `phase-11/clip-res-168`) adds an opt-in session option `measure_long_edge`, off by default: each render is exported and measured at that edge while Claude still sees the `long_edge` image. This check gives the two numbers that decide whether it should be on by default (plan decision "Default for measure_long_edge", recommended A now, then C):

1. How much longer a 2560 px and a 4096 px export take than a 1600 px one, on Jim's machine and photos.
2. How much the 1600 px render understates `clip_high_tone_pct` and `clip_low_pct` on real photos with bright highlights.

**Decision rule** (none in PHASES.md for an issue check; proposed in the plan [inference]): switch the default to 4096 in a one-line follow-up PR only if 4096 px costs at most about **1.5x** the 1600 px render time **and** 1600 px understates clipping noticeably on Jim's photos. Otherwise `measure_long_edge` stays opt-in. Past 4096 (full sensor size) needs a plugin change and is revisited only if the clip figures still move between 2560 and 4096.

## Harness

`npm run clip:res` (`engine\src\devtools\clip-res-check-cli.ts`; the pure parts, medians, ratios, worst-case step and verdict, in `engine\src\devtools\clip-res-check.ts`, tested by `engine\tests\clip-res-check.test.ts`). Commands and prerequisites: `.claude\skills\lrc-avg-checks\SKILL.md`.

What it does:
1. Takes the engine's instance lock (Claude Desktop must be quit), connects to the plugin, reads the selection: 1 to 4 photos.
2. For each selected photo, by its uuid (`export_preview` with `photo_uuid`, so the selection is left alone), and for each long edge 1600, 2560 and 4096 px: 1 untimed warm-up render, then 3 timed renders. Each render is the engine's own `PreviewService.render`, the export a session pass uses, at quality 75 (`PREVIEW_QUALITY`), measured at the size exported.
3. Per photo and edge: the median (nearest rank) of `export_ms`, `command_ms`, `file_ms`, `metrics_ms` and `total_ms`, and of `clip_high_pct`, `clip_high_tone_pct` and `clip_low_pct`; the ratio of each edge's median total and export time to the 1600 px one; the clip figures minus the 1600 px ones; and a worst-case step estimate, 5 times the median total (one render, `MAX_CORRECTIONS` = 3 guardrail re-renders, `engine\src\session\rules.ts:148`, and the render after the pass is undone, `engine\src\session\guardrail.ts:274`).
4. Prints one line per edge, `Clip resolution check: WORKED` (every render answered) or `FAILED`, and `put back: YES (nothing written)`. It stops at the first render that fails.

It writes nothing to the catalog and asks nothing. Results: `%TEMP%\LrC-AVG\clip-res\clip_res_<time>.json` (every sample, the summary and the lines). The plugin needs no change and no Reload: `export_preview` already takes `long_edge` up to 4096 [handle: `plugin\LrC-AVG.lrplugin\Preview.lua:31` `Preview.MAX_LONG_EDGE = 4096`, checked at `:47`].

## Pre-run findings (Claude Code)

- **The only export times on record are at 1600 px or less.** Phase 2 measured about 2.6 s at 800, 1200 and 1600 px alike (medians 2,605 / 2,578 / 2,576 ms) [handle: `docs\reports\phase2\PHASE2.md:192`, `:225`]. Nothing has measured 2560 or 4096 [unverified: how export time scales above 1600].
- **Lightroom may not enlarge a photo smaller than the asked edge, or it may** [unverified]: the export sets `LR_size_doConstrain` and `LR_size_resizeType = "longEdge"` with no do-not-enlarge setting [handle: `plugin\LrC-AVG.lrplugin\Preview.lua:70-74`]. The harness records the long edge it actually measured, and the line says "Lightroom exported N px" when it differs from the edge asked.
- **The engine's share grows with size.** Run by Claude Code against the test simulator (`engine\tests\helpers\lightroom-sim.ts`, a grey-noise JPEG, so no Lightroom), the harness ran end to end and said WORKED; its medians were 0.14 / 0.47 / 0.94 s at 1600 / 2560 / 4096 px with a simulated export of about 0.01 s, so nearly all of that is the engine's decode and measuring [handle: Claude Code, 2026-10-29, a throwaway vitest file that started `engine\tests\probe\harness.ts` `startHarness()` and ran `node engine\dist\devtools\clip-res-check-cli.js` against it; the file was deleted after]. The real figures on Jim's PC will differ [inference].
- Checks run on the branch before the push: `npm run build`, `npm run typecheck`, `npm run arch:check` (no violations), `npx vitest run tests/clip-res-check.test.ts tests/module-size.test.ts` (passed), and the full suite. The check itself was not run against Lightroom by Claude Code.

## Steps for Jim

1. In Lightroom Classic, Library module (G), select **two** photos with bright highlights in the grid: one Z8 NEF and the DxO DNG (`DxO_DeepPRIME XD3.dng`). Ctrl+click selects the second one.
2. Quit Claude Desktop (File > Exit, or the tray icon > Quit).
3. In PowerShell:
   ```powershell
   Set-Location D:\Developer\LrC_Autonomous_Gateway
   npm run clip:res
   ```
4. Do not click in Lightroom while it runs (about 1 to 3 minutes).
5. Wait for "Clip resolution check: WORKED" (or FAILED) and "put back: YES (nothing written)", then tell Claude Code "done".

### If something goes wrong

- If it says "select 1 to 4 photos": do step 1 again, then step 3.
- If it says "Another LrC-AVG engine ... is using the Lightroom bridge": quit Claude Desktop (step 2) and any other AI app using LrC-AVG, wait one minute, then step 3 again.
- If it says it cannot connect to the plugin: in Lightroom, File > Plug-in Manager, check that LrC-AVG shows Enabled, then step 3 again.
- If it says "Stopped: the 4096 px export of ... failed": tell Claude Code "done"; the results file has the error.

## Observed (Jim)

_Blank: filled from the results file after Jim's run._

- Run time, Lightroom version, engine and plugin version:
- Photo 1 (file name):
- Photo 2 (file name):
- Headline:

## Numbers

_Blank: filled from the Observed section._

| Photo | Edge | Measured px | Median total (s) | x 1600 | Median export (s) | x 1600 | Worst-case step (s) | clip_high_tone_pct | vs 1600 | clip_low_pct | vs 1600 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| | 1600 | | | 1 | | 1 | | | 0 | | 0 |
| | 2560 | | | | | | | | | | |
| | 4096 | | | | | | | | | | |
| | 1600 | | | 1 | | 1 | | | 0 | | 0 |
| | 2560 | | | | | | | | | | |
| | 4096 | | | | | | | | | | |

## Verdict

_Blank: Jim decides the `measure_long_edge` default from the Numbers and the decision rule in Purpose._

## Consequences / open questions

- If the default switches to 4096: a one-line follow-up PR on the feature PR's default (plan decision C), and clip figures in session logs after it are not comparable with older logs; the session log records `measure_long_edge` (feature PR) [inference].
- Whether the 4096 px numbers still differ from the 2560 ones decides whether measuring past 4096 (a plugin change to `Preview.MAX_LONG_EDGE`) is worth revisiting.
- What stays [unverified] after the run: export times on other machines, and whether Lightroom enlarges a photo smaller than 4096 px (the run shows it only for the photos chosen).
