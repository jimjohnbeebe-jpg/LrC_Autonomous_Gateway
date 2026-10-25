---
report: Phase 10 row 0, the looks experiment (do richer intents make better edits?)
phase: 10 (row 0, no engine change; engine and plugin 1.1.0)
status: observed
authored_by: "Looks, harness steps and session analysis: Claude Code (Opus 5.5), 2026-10-25. Observed (the six chats, the verdicts and the reasons): Jim, 2026-10-25. Verdict and next step: Jim."
date: 2026-10-25
---

# Phase 10 row 0: the looks experiment

## Purpose

**The question** (`PHASE10_PLAN.md` row 0, vault): does richer guidance (a look written as a v2 intent: long brief, profile, HSL and grading priors, three strengths) make Claude's edits better than an edit with no intent?

**Rule** (`PHASE10_PLAN.md`, "Unknowns and risks"): "Row 0 shows that richer guidance does not help → Rows 4-9 are re-planned before row 4 starts; rows 1-3 still pay off (#187, B&W mixer, pass budget)". The result "may change rows 4-9" (row 0).

**Plan decisions** [stated: Jim, 2026-10-25, "Go with recommendations"]: Jim picks the 3 photos; the result goes into this report.

## Harness

- The two looks, written by Claude Code into Jim's user intents folder (`Documents\LrC-AVG\intents`) and copied here unchanged: [`EXPERIMENT/moody_atmospheric.json`](EXPERIMENT/moody_atmospheric.json) (spec Archetype 2, Adobe Landscape) and [`EXPERIMENT/chromogenic_naturalism.json`](EXPERIMENT/chromogenic_naturalism.json) (spec Archetype 3, Adobe Color).
- Design: priors add to the photo's value (`engine\src\session\pass0.ts:123`) and a variant's numbers add to the base priors (`pass0.ts:105-112`). So the base priors carry the hues, and variants A/B/C (subtle, full, bold) carry the amounts. No tone curve (#187) and no B&W mixer (not pinned). The limits, the mask plan and the tonal targets are prose in the brief. The spec's L* targets were translated to 0-255 luma percentiles for a neutral grey [inference: the engine measures no L* before row 4].
- Jim's steps (chat of 2026-10-25): per photo, a new chat "Edit this photo with the <look> look, in Variants mode with three variants", the pick, then a new chat "Edit this photo without an intent" on the same original (Variants mode never edits the master, `engine\src\session\variants.ts:4`).

## Pre-run findings (Claude Code)

- Both looks load with 0 warnings through the engine's own loader [handle: scratchpad `validate.mjs` against `engine\dist` (`IntentLibrary.list()`), 2026-10-25: `warnings: []`, `moody_atmospheric source: user brief chars: 1356 variants: ABC`, `chromogenic_naturalism source: user brief chars: 1149 variants: ABC`].
- Grading blending starts at 50 on an unedited photo [handle: `engine\tests\fixtures\presets\reference-settings.lrc15.json` `"ColorGradeBlending": 50`], so the moody variants land at 60/70/80.

## Observed (Jim)

- **Verdict, every photo: the no-intent edit looked better than the look** [stated: Jim, 2026-10-25, "In all cases the "no intent" edit looked better than the new intent"].
- **Reasons** [stated: Jim, 2026-10-25, ticked: "Too dark or heavy", "Look edits flat or milky", "Colours looked processed"]. Not ticked: "No-intent had more depth".
- **Photo 3**: the look ran on `20220814-DSC00714.ARW`, the no-intent edit on `20220814-DSC00711.ARW`; they are near-duplicates and the pair counts [stated: Jim, 2026-10-25, "Near-duplicates, count it"].
- Jim's inputs during the chats, as the pass rationales record them: in `c2da04`, "Jim: looks awful, too flat" (no-intent, pass 3); in `d2f027`, the silhouettes "left alone per Jim" (look, pass 2).

## Numbers

From the session logs (repo `logs\20261025-<id>.json`, gitignored, local) [handle: each file's `intent`, `picked`, `hud_events`, `passes[*].metrics_after.luma_percentiles`, `final_settings`]. Model `claude-opus-5-5`, engine 1.1.0, Lightroom 15.6, max passes 4, every session ended by the AI with outcome `accept`.

| Photo | Session | Intent | Pick | Final p1/p50/p99 | Final settings (selected) |
|---|---|---|---|---|---|
| `20230527-_DSC3063-HDR.dng` | `3c5b48` | moody | C (HUD) | 13/83/183 | exposure +1.6, shadows +78, blacks +71, whites +5, saturation -12, clarity 0, dehaze 0 |
| same | `8ed0c0` | none | — | 4/45/175 | exposure +0.45, shadows +60, blacks +15, whites +35, clarity +6, dehaze +10, texture +10 |
| `20230527-_DSC3111-HDR.dng` | `827384` | chromogenic | C (HUD) | 10/111/238 | Adobe Color; exposure +0.55, contrast +10, highlights -45, shadows +25, texture +13 |
| same | `e4a9a9` | none | — | 12/111/236 | Adobe Landscape; exposure +0.5, contrast +12, highlights -35, shadows +20, dehaze +5, texture +10 |
| `20220814-DSC00714.ARW` | `d2f027` | moody | C (chat) | 5/93/210 | Adobe Landscape; exposure -1.05, highlights -40, whites -30, blacks +25, two masks (light bleed, foreground) |
| `20220814-DSC00711.ARW` | `c2da04` | none | — | 4/169/248 | Camera Neutral; exposure -0.35, contrast +28, clarity +13, dehaze +20, an S tone curve `[0,0,64,54,128,128,192,204,255,255]` |

- Strength picked: **bold (C) 3 of 3**; subtle and full were never chosen.
- Pass 0 of the moody look on the dark DNG put p50 at 13-20 (A/B/C), and the following passes lifted it to the brief's target (p50 80-100) with shadows +78 and blacks +71 [handle: `3c5b48` passes 0-3 `metrics_after`, rationales "lift exposure, open shadows, raise blacks off the floor"]. Unaided, Claude stopped at p50 45 on the same photo (`8ed0c0`).
- On the chromogenic photo the two finals differ little; the look ends with several sliders on its limits (shadows +25, highlights -45, contrast +10, texture +13) [handle: `827384` `final_settings`].
- The no-intent edits used Dehaze (5-20), Clarity (up to +13) and, once, a tone curve, which both looks ruled out or the experiment left out [handle: `8ed0c0`, `e4a9a9`, `c2da04` `final_settings`]. The curve in `c2da04` reads back as written [handle: `c2da04` `final_settings.tone_curve.master`]; whether #187's partial-write case was hit is not checked here.

## Verdict

**The looks, in this form, did not help: the no-intent edit was better on 3 of 3 photos** [stated: Jim, 2026-10-25]. By the plan's rule, rows 4-9 are re-planned before row 4 starts. **Next** [stated: Jim, 2026-10-25, "Report, then rows 1-3 (Recommended)"]: this report, then rows 1-3 (S14, params from S14, pass limits), then the re-plan of rows 4-9.

## Consequences / open questions

For the re-plan of rows 4-9 [inference: Claude Code's reading of the logs against Jim's reasons, not tested]:

1. **Fixed global tonal targets fought the scene.** A look's p50 band pulled a dark scene up into the flat, milky result Jim saw ("flat or milky"), and the low-key priors made pass 0 "too dark or heavy". Targets per scene, or relative to the photo, or none, are options; absolute L* targets in rows 4-6 need this evidence weighed first.
2. **Stacked priors read as processed.** The bold strength stacked HSL, grading and saturation cuts at the top of the spec's ranges ("colours looked processed"). Jim still chose bold every time, which suggests the subtle/full steps were not distinct enough or not useful [inference].
3. **Limits took away the tools Claude reached for unaided** (Dehaze, Clarity, the tone curve). Row 6's limits (refuse with a reason) would do the same; whether limits help at all is open.
4. **Variants mode spends the pass budget across three copies**: the picked copy got 3-4 steps, the same as the no-intent edit, so the budget did not favour either side [handle: `passes` per target in each log].
5. Rows 1-3 are unchanged by this result (#187, the B&W mixer, the pass budget).
6. Still `[unverified]`: whether looks with relative targets, fewer priors or no limits would win; the experiment had 3 photos and one rater.

The two looks stay in Jim's intents folder until he removes them; they are not bundled.
