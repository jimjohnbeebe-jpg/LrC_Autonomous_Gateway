---
report: Issue #190 (Automaat ports), #186 (one-channel clipping) and #176 (freeze rebind) in Lightroom
phase: 9 (phase-9/upstream-ports, engine and plugin 1.1.0)
status: template
authored_by: "Template, harness and pre-run findings: Claude Code (Opus 5.5), 2026-10-24. Observed: Jim, from the three checks below. Numbers: filled from Observed. Verdict: Jim."
date: 2026-10-24
---

# Issue #190 (Automaat ports), #186 and #176 in Lightroom

## Purpose

**The question.** This branch ports four Automaat features added after our fork point `a160e7a` (issue #190) and fixes two hands-on issues [stated: Jim, 2026-10-24, triage picks "Preview by uuid, AI Denoise, Color + depth range masks, Brush masks from strokes, #186 clip guard, #176 freeze rebind", one combined PR]. Do they work in Lightroom?

1. **Preview by uuid** (Automaat #259): does `lr_get_preview` `uuid` render a photo without selecting it?
2. **AI Denoise** (Automaat #288): does `lr_apply_denoise` turn Denoise on, change its amount, leave a photo already at that amount alone, put back the module and the selection, and can the snapshot it takes undo it?
3. **Colour range, depth range and brush masks** (Automaat #324, #326, #334): does Lightroom take the engine's three new mask forms, read them back unchanged, and draw them where asked?
4. **#186**: the highlight guard counts a pixel as blown only when two or more channels are at 253 or above [stated: Jim, 2026-10-24, "2+ channels ≥ 253"]. Clipping in one channel alone is an advisory, and no slider moves [stated: Jim, 2026-10-24, "Advisory only"].
5. **#176**: is the freeze once per session gone now that the startup rebind no longer runs on every start, and does a Reload Plug-in still leave Lightroom listening?

**Go rule** (PHASES.md has none for an issue fix; proposed [inference]):
- **Go**: all three checks say WORKED, or the only gap is the depth range skipped on a photo without depth data, and Jim saw no freeze in stall:check's enabled phase.
- **Conditional**: one new mask kind fails. That kind is then refused again until it is fixed; the rest ships.
- **No-go**: Denoise leaves a photo changed after its snapshot is applied, the selection or module is not put back, or the freeze is as frequent as before.

**How the checks ask Jim:** y/n questions in the PowerShell window running each check, as for `npm run masks:combine` (rule 04, "Steps for Jim").

## Harness

| What | Files |
|---|---|
| Preview by uuid | `engine\src\mcp\tools-context.ts` `renderPhoto`, `defs-context.ts`; tests `engine\tests\preview-by-uuid.test.ts` |
| AI Denoise | plugin `plugin\LrC-AVG.lrplugin\Denoise.lua`; engine `engine\src\mcp\tools-denoise.ts`, `defs-files.ts`; tests `engine\tests\catalog-denoise.test.ts`; check `engine\src\devtools\denoise-check.ts`, `denoise-check-cli.ts` |
| New mask kinds | `engine\src\params\mask-range.ts`, `mask-brush.ts`, `mask-table.ts`, `mask-build.ts`; `engine\src\session\masks.ts` (colour sample, depth put-back); `engine\src\metrics\pixel.ts`; tests `params-mask-kinds.test.ts`, `session-mask-kinds.test.ts`; check `engine\src\devtools\mask-combine-probe.ts` `KIND_CANDIDATES`, `mask-combine-probe-cli.ts --kinds` |
| #186 | `engine\src\metrics\compute.ts` `clip_high_tone_pct`; `engine\src\session\guardrail.ts` `advisory`; `plan.ts` `applyProjectedGuardrail`; tests `metrics.test.ts`, `session-step.test.ts` |
| #176 | `plugin\LrC-AVG.lrplugin\Sockets.lua` `rebindOr`, `Bridge.lua` (overlap rebind), `Endpoint.lua` `recentStart`, `Stall.lua`; check `engine\src\devtools\stall-check-cli.ts` (Step 5b) |

## Pre-run findings (Claude Code)

- `npm run build`, `npm test` (1712 passed, 3 skipped), `npm run typecheck` and `npm run arch:check` (no violations) passed on the branch, 2026-10-24 [handle: the PR's commits; CI `arch-check`].
- The engine's colour range and brush components have the same keys as Jim's hand-made "Color Range 1" and "Brush 1" [handle: `engine\tests\params-mask-kinds.test.ts`, against `docs\reports\phase8.5\mask-carry\mask_carry_2026-10-11T22-37-39-161Z.json`].
- On the six golden fixtures, any-channel clipping (`clip_high_pct`) is 0 to 19.3 %, while two-channel clipping (`clip_high_tone_pct`) is 0 to 0.71 % [handle: `tests\golden\golden.json`, written by `engine\dist\devtools\goldens.js` `goldenEntry`, 2026-10-24]. Four of the six fixtures are over the 0.5 % limit on any-channel clipping, and one is on the new metric [inference: read from those numbers].
- Not checked by Claude Code, left for the runs:
  - the LrC 15 Denoise calls (`getEnhancePanelState`, `setEnhance`, `changeDenoiseAmount`) and the "Enhance" filter name [upstream claim: Automaat PR #288];
  - `getActiveSources` and `setActiveSources` [upstream claim: same];
  - the depth range's form [upstream claim: Automaat PR #334];
  - whether Lightroom adds `r`, `f` or `h` tokens to the engine's brush dabs [upstream claim: Automaat PR #326];
  - whether Lightroom on Windows fires the receive socket's `onClosed` or "failed to open" while idle [unverified].

## Observed (Jim)

Steps for Jim, in this order. Reload the plugin first: File > Plug-in Manager, LrC-AVG (dev), Reload Plug-in. Quit Claude Desktop.

1. **Masks.** In Lightroom's Develop module, select one virtual copy of a photo alone. In PowerShell at `D:\Developer\LrC_Autonomous_Gateway`, run `npm run masks:kinds` and answer y/n for each mask as you look at the photo.
2. **Denoise.** In the Library grid, select two virtual copies of raw photos. Run `npm run denoise:check`, wait without clicking in Lightroom, and answer the two questions.
3. **Freeze.** Run `npm run stall:check` and follow its steps. When it asks, click Reload Plug-in.

Say "done" after each one. Claude Code collects the files under `%TEMP%\LrC-AVG\masks-kinds\`, `%TEMP%\LrC-AVG\denoise-check\` and `%TEMP%\LrC-AVG\stall\`.

*(left blank for the runs)*

## Numbers

| Field | Value |
|---|---|
| masks:kinds colour range / brush / depth range | |
| Brush dabs as Lightroom read them back (tokens added or dropped) | |
| denoise:check steps (applied, unchanged, amount_changed) | |
| Selection and module put back | |
| FilterList after Denoise (the live key dump, rule 03) | |
| Snapshot undid Denoise | |
| Preview by uuid of a photo not active | |
| stall:check: freezes with the plugin enabled; rebinds logged | |
| LISTENER AFTER RELOAD | |

## Verdict

*(Jim's)*

## Consequences / open questions

- **PRD 6.7.** The highlight guard and the `clip_high` limit now act on `clip_high_tone_pct` (two or more channels); `clip_high_pct` (any channel) is still reported. This changes the PRD 6.7 definition, and the vault PRD is to be updated after the verdict.
- **LR_SDK_NOTES.** Record, from the runs:
  - the Enhance filter key names in FilterList (the denoise:check dumps);
  - the depth range's stored form, if a photo with depth data was used;
  - whether `onClosed` fires while idle (the stall:check log).
- **AVG-005 (snapshots for rollback).** Does a snapshot undo AI Denoise (denoise:check "filters_back")?
- **Left on #190** for a later PR: mask tone curve and point color (Automaat #328), one AI mask on many photos (#329), IPTC creator, copyright and location fields (#258, #265), `rename_keyword` (#264), `export_photo_metadata` (#249).
- **#165.** This branch adds one tool (36 to 37). A smaller default tool profile stays open.
