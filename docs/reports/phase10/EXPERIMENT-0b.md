---
report: Phase 10 row 4 (re-planned), experiment 0b (does a look taken from an edit Jim likes beat no intent?)
phase: 10 (row 4 after the 2026-10-26 re-plan; no engine change; engine and plugin 1.2.1)
status: observed
authored_by: "Harness steps, look save prompt and session analysis: Claude Code (Opus 5.5), 2026-10-26. Observed (the source edit, the seven chats, the verdicts and the reasons): Jim, 2026-10-26. Verdict and the decision to continue Phase 10: Jim."
date: 2026-10-26
---

# Phase 10 row 4: experiment 0b, a look from an edit Jim likes

## Purpose

**The question** (vault `PHASE10_PLAN.md`, "Re-plan of rows 4-10", row 4): row 0's looks were written from the spec and lost on 3 of 3 photos ([EXPERIMENT.md](EXPERIMENT.md)). Does a look taken from an edit Jim finished and likes, with the character settings only and the tones left to Claude per photo, beat an edit with no intent?

**Rule** (same row, approved by Jim on 2026-10-26 [stated: "Go with recommendations"]): "the look wins on at least 2 of 3 photos → build rows 5-8; otherwise the build stops after row 3, #194 is closed with the findings, and the looks stay user intents." This rule was withdrawn after the run [stated: Jim, 2026-10-26, "Go with A"]; see "Verdict".

## Harness

- No repo code. Steps given to Jim in the chat of 2026-10-26: reload the plugin (1.2.1), restart Claude Desktop, save one of his finished edits as the look `my_look_0b` in a Claude Desktop chat (character settings as priors: profile, HSL, colour grading, calibration, tone curve, vignette and grain; no tonal or presence priors, no white balance, no masks, no variants, a brief of at most three sentences without numbers). Then for each of 3 photos: a virtual copy, the master edited with the look in a single session, the copy edited without an intent.
- The look as saved, copied unchanged from Jim's intents folder: [`EXPERIMENT-0b/my_look_0b.json`](EXPERIMENT-0b/my_look_0b.json). It has orange saturation +9, yellow saturation -6, highlight grading hue 12 / sat 22, grading blending +9 (59 on a photo at the default 50), an S-curve `[0,0,97,91,216,219,255,250]` and a vignette of -28; profile Adobe Color / Color.

## Pre-run findings (Claude Code)

None: the look was built and saved in Jim's chat with the engine's existing tools (`lr_get_active_photo_context`, `lr_save_intent`).

## Observed (Jim)

- **The first save failed** with `INVALID_INTENT`, "category: Invalid input: expected string, received undefined"; Claude added `"category": "look"` and the second save went through [stated: Jim, 2026-10-26, the chat pasted into the Claude Code session]. `category` is required by the schema (`engine/src/intents/schema.ts:54`), but `lr_save_intent`'s description does not name it among the checks (`engine/src/mcp/defs-intents.ts:50-60`).
- **Verdicts** [stated: Jim, 2026-10-26]:

| Photo | Better edit |
|---|---|
| `20241129-_DSC0052.NEF` | No intent |
| `20241129-_DSC0053.NEF` | No intent |
| `20241207-_OZ80328.NEF` | Look |

- **Reasons** [stated: Jim, 2026-10-26, ticked: "Look too dark/heavy", "No-intent crisper"]. Not ticked: "Look had my style", "No-intent more natural".

## Numbers

From the session logs (repo `logs\20261026-<id>.json`, gitignored, local) [handle: each file's `intent`, `target`, `start.settings`, `passes[*].metrics_before/after.luma_percentiles`, `final_settings`]. Model `claude-opus-5-5`, engine 1.2.1, `max_passes` 8, mode converge, every session ended by the AI with outcome `accept`, 2026-10-26 11:40-11:48Z.

| Photo | Session | Intent | Passes | Luma p1/p50/p99 start → final | Final texture / clarity / contrast / vignette |
|---|---|---|---|---|---|
| `_DSC0052.NEF` | `e111dc` | my_look_0b | 1 (pass 0 only) | 6/95/248 → 3/72/233 | 0 / 0 / 6 / -28 |
| `_DSC0052.NEF` Copy 1 | `3a6d01` | none | 4 | 6/95/248 → 4/90/243 | 12 / 5 / 16 / -12 |
| `_DSC0053.NEF` | `2b4d7b` | my_look_0b | 4 | 19/168/255 → 13/126/247 | 0 / 0 / 0 / -28 |
| `_DSC0053.NEF` Copy 1 | `884761` | none | 4 | 19/168/255 → 12/136/251 | 10 / 0 / 12 / 0 |
| `_OZ80328.NEF` | `f27e13` | my_look_0b | 3 | 8/124/231 → 2/103/230 | 0 / 0 / 7 / -28 |
| `_OZ80328.NEF` Copy 1 | `b86d96` | none | 3 | 8/124/231 → 4/116/233 | 12 / 6 / 17 / -10 |

- **Look won on 1 of 3.**
- On all three masters the character settings started at their defaults (HSL 0, grading 0 with blending 50, a straight curve, vignette 0), and pass 0 wrote the look's values exactly [handle: `start.settings` and `passes[0].changes` of `e111dc`, `2b4d7b`, `f27e13`].
- Each look edit ended darker than its no-intent pair: the median was 18, 10 and 13 lower [handle: the p50 column above].
- None of the look sessions used texture or clarity. Every no-intent session added texture (+10 to +12) and two of the three added clarity (+5, +6) [handle: `final_settings`].
- `e111dc` stopped after pass 0 and accepted the look as it was. The other two look sessions spent passes on clipping: red-channel clipping in `2b4d7b` and, in `f27e13`, shadow clipping that pass 0 raised from 0.09 % to 1.83 % [handle: `passes[1..3].rationale`].
- Two of the three photos were not unedited. `_DSC0052` and `_OZ80328` started with tonal edits (exposure +0.28 / +1.46, highlights -68 / -56, shadows +49 / +48). Each virtual copy started from the same settings, so each pair is still a fair comparison [handle: `start.settings` of each pair].

## Verdict

**The look lost on 2 of 3 photos, so the rule's threshold (2 of 3) is not met** [stated: Jim's verdicts; the rule as approved 2026-10-26]. **Phase 10 continues** [stated: Jim, 2026-10-26, "Go with A"]: the re-plan's stop rule is withdrawn, #194 stays open, and rows 4 onward are re-planned from this report and row 0's, for Jim's approval. Meanwhile `my_look_0b` (with row 0's two looks) stays a user intent in Jim's folder.

## Consequences / open questions

1. **Rows 5-8 of the lean re-plan are not approved to build as written** (v3 `set`, "save this edit as a look", looks as MCP prompts, bundled looks). The next plan for rows 4 onward weighs them against these findings and row 0's. *Update, 2026-10-26:* re-planned (vault `PHASE10_PLAN.md` "Second re-plan"): row 5 builds v3 `set` and "save this edit as a look" with the whole global edit, white balance included [stated: Jim, "continue further, more rapidly"; "Include white balance"].
2. **`set` would not have changed this result.** On these photos the character settings started at their defaults, so the added priors landed exactly as written. Absolute values would have written the same numbers (see Numbers).
3. **Why the look lost (corrected 2026-10-26).** The look left out exposure, contrast and the other tonal and presence settings of Jim's edit, by Claude Code's design of row 4 ("no tonal or presence priors"), and those settings are why the look edits came out too dark and too flat [stated: Jim, 2026-10-26: "Those settings were the reason that I rejected the edited photos - they all came out too dark and too flat vs. the one edited with no-intent"]. The logs agree: the look edits ended with contrast 6 / 0 / 7 and texture and clarity 0, against contrast 16 / 12 / 17, texture +10 to +12 and clarity +5 / +6 without an intent (Numbers, `final_settings`). *The first reading, kept for the record* [inference, not tested]: the look's curve lowers the midtones (97 → 91) and its vignette (-28) darkens the edges. Claude worked on top of both and never added the presence settings (texture, clarity) it reached for unaided. The brief's "gentle" and "soft" wording may have steered it away from them. That matches "too dark/heavy" and "no-intent crisper".
4. **Small defect, not fixed here: `lr_save_intent`'s description does not say that `category` is required.** The first save failed on it. A fix is one line in `engine/src/mcp/defs-intents.ts` (name the required fields), in a `fix/` PR when Jim picks it. *Update, 2026-10-26:* fixed in row 5 (`phase-10/looks`): the `intent` argument's description names the required fields.
5. Still `[unverified]`: whether a look without the curve and vignette, a different source edit, or more photos and raters would change the result. This experiment had 3 photos, one rater and one source look.
