---
report: IMPORT-STACKS
phase: "11"
status: template
authored_by: "Claude Code (Opus 5.5): purpose, harness, pre-run findings, steps, 2026-10-29. Jim: Observed (empty until he runs it)."
date: 2026-10-29
---

# Date folders, renaming and stacks at import (issue #139)

## Purpose

Issue #139 gap 1 (date folders and renaming) and stacking bracket groups at import. Gap 1 is in PR #263 (`folder_template`, `name_template`, `dry_run`); this check also covers the stacking of PR "phase-11/import-stacks-139" (`stack_gap_seconds`, plugin 1.9.0 `import_photo` `stack_with`). Decisions D1 = A (the engine reads the capture date from the EXIF header), D2 = A (templates with `{yyyy}` `{mm}` `{dd}` `{name}`), D3 = A (the first frame is the top) [stated: Jim, 2026-10-29, "Go on all."].

The questions: in Lightroom, do the copies land in dated folders under their new names, do three frames within the gap form one stack of 3 with the first on top, and does a frame on another date stay unstacked?

**Go rule** (PHASES.md has none for an issue check; proposed [inference]): **go** when the check says WORKED (every step YES and Jim answers y). Then decision D4 = A closes issue #139: unstacking, and stacking photos already in the catalog, have no SDK call [handle: `docs\reports\phase8.5\S11.md` "Consequences"]. **No-go** when the stack is not made or the paths are wrong.

## Harness

`npm run import:check` (`engine\src\devtools\import-check-cli.ts`; the shared `step` in `develop-check.ts`, `ask` in `mask-carry-probe.ts`, the throwaway guard in `throwaway.ts`). It calls the engine's tool functions (the `Tools` class, as Claude Desktop does). Results go to `%TEMP%\LrC-AVG\import-check\import_check_<time>.json`. Commands and prerequisites: `.claude\skills\lrc-avg-checks\SKILL.md`. Jim answers in the PowerShell window, as for `npm run crop:spike` (rule 04 "Steps for Jim").

What it does, in order:
1. Refuses a catalog that `npm run catalog:throwaway` did not mark (unless `-- --i-know`), and a plugin older than 1.9.0.
2. Builds a card folder `%TEMP%\LrC-AVG\import-check\card-<time>\100NCZ_8\`: three copies of `fixtures\20260906-_OZ80005.NEF` as `_OZ80005.NEF`, `_OZ80006.NEF`, `_OZ80007.NEF` (one capture date, so one group), the fixture's `.xmp` beside the first, and `fixtures\20260110-_Z8A0138-DxO_DeepPRIME XD3.dng` as `_Z8A0138.dng` (another date).
3. `lr_import_photos` with `dry_run: true`, `copy_to` `%TEMP%\LrC-AVG\import-check\photos-<time>\`, `folder_template` `{yyyy}-{mm}-{dd}`, `name_template` `{yyyy}{mm}{dd}-{name}`, `stack_gap_seconds` 2. Expects 4 planned paths, one group of 3, and no copy_to folder made.
4. The same call without `dry_run`, again with `resume_after` until no `not_yet` is left. Expects 4 imported, nothing failed, nothing in `not_stacked`.
5. Checks the paths: `photos-<time>\2026-09-06\20260906-_OZ8000{5,6,7}.NEF`, the sidecar `20260906-_OZ80005.xmp`, and `photos-<time>\2026-01-10\20260110-_Z8A0138.dng`; and the stack read back: the second NEF count 2, the third count 3, both with the first NEF's uuid as top; no stack on the first NEF's own result or on the DNG.
6. Asks Jim one y/n: does the folder 2026-09-06 show one stack of 3?
7. Puts back: `lr_remove_photos` on the four photos, then deletes both temp folders. The copy_to folder is kept when a photo may still be in the catalog (the removal failed, or an import call stopped), so that no catalog photo loses its file (Greptile, PR #270). Prints `Import check: WORKED/FAILED` and `put back: YES/NO`.

## Pre-run findings (Claude Code)

- The capture dates and groups of the card in step 2, read offline through the built engine's library functions (no Lightroom): the three NEF copies read `2026-09-06 11:12:07`, subsec `00`, and each joins the one before at a 2 s gap; the DNG reads `2026-01-10 06:48:53`, subsec `18`, and joins none; the planned paths are `<copy_to>\2026-09-06\20260906-_OZ8000{5,6,7}.NEF` and `<copy_to>\2026-01-10\20260110-_Z8A0138.dng` [handle: `node` on the session scratchpad script `import-dry.mjs`, 2026-10-29, its output].
- The plugin side was not run by Claude Code. `catalog:addPhoto(pathB, photoA, "below")` in a second write gate made a 2-photo stack with A on top at position 1 in S11 [handle: `docs\reports\phase8.5\S11.md` "Observed", `import_stack`]. A stack of 3, and the order of the frames below the top (each new one goes "below" the top, so whether the last frame ends at position 2 or 3), are [unverified] until this check: step 5 records the positions read back.
- Stacking onto a top the catalog held before the call is [unverified]: this check covers only a top imported in the same call.
- The engine side ran against the simulated Lightroom: `engine\tests\import-stacks.test.ts` (groups with subseconds, the gap boundary, a frame already in the catalog in `not_stacked`, a failed top, a group never split by the time budget, `PLUGIN_TOO_OLD` only with `stack_gap_seconds`, dry_run `groups`) [handle: `npx vitest run tests/import-stacks.test.ts` in `engine\`, 2026-10-29, 9 passed]. The plugin's `stack_with` has busted cases in `plugin\spec\Transfer_spec.lua` (CI runs them; busted is not on this machine's PATH).

## Steps for Jim

1. In Lightroom Classic, open the throwaway catalog that `npm run catalog:throwaway` marked (File > Open Catalog).
2. File > Plug-in Manager, LrC-AVG, Reload Plug-in. Close the Plug-in Manager.
3. Quit Claude Desktop (File > Exit, or the tray icon > Quit).
4. In PowerShell:
   ```powershell
   Set-Location D:\Developer\LrC_Autonomous_Gateway
   npm run import:check
   ```
5. Do not click in Lightroom until the question. When it comes, do what it says in Lightroom's Library module and type y or n, then Enter.
6. Wait for "Import check: WORKED" (or FAILED) and "put back: YES", then tell Claude Code "done".

### If something goes wrong

- If it says "reload the LrC-AVG plugin 1.9.0": File > Plug-in Manager, LrC-AVG, Reload Plug-in, then run step 4 again.
- If it says "is not marked as a throwaway catalog": do step 1 again with the marked catalog, then step 4.
- If it says "with 20260906-_OZ80005.NEF and ... in fixtures": run step 4 from `D:\Developer\LrC_Autonomous_Gateway` (the `Set-Location` line).
- If Lightroom asks whether to remove the photos: click Remove.
- If it says "put back: NO": in the Folders panel, open the folder it names, select all its photos, Photo > Remove Photos..., Remove.

## Observed (Jim)

Results file: 

Headline: 

put back: 

Jim's answer (one stack of 3 in the Library grid): 

Positions read back (second NEF, third NEF): 

Notes: 

## Numbers

| Field | Value | Source |
|---|---|---|
| dry_run: planned paths as expected | | `steps` "dry_run" |
| Imported / failed / not_stacked | | `steps` "lr_import_photos" |
| Copies and sidecar at the dated paths | | `steps` |
| Stack read back (counts 2 and 3, first NEF on top) | | `steps` "the stack read back" |
| lr_import_photos calls (resume_after) | | `results.lr_import_photos.calls` |
| Put back | | `put back` line |

## Verdict

(After Jim's run.)

## Consequences / open questions

(After Jim's run.)
