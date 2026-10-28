---
report: DEVELOP-CATALOG-D123
phase: "11"
status: template
authored_by: "Claude Code (Opus 5.5): purpose, harness, pre-run findings, steps, 2026-10-28. Jim: the run, his answers, Observed, Verdict (blank)."
date: 2026-10-28
---

# Settings by Lightroom key, global undo, removal from the catalog (#207 D1-D3)

## Purpose

Epic #207 decisions D1, D2 and D3, option (b) each [stated: Jim, 2026-10-28, "Go with recommendations"]:

- **D1** (#214): `lr_set_develop_settings`, upstream's `set_develop_settings`: Develop settings by Lightroom's SDK key, keys limited to the pinned `getDevelopSettings()` dump, never free text. A key the canonical map holds is checked as `lr_step` checks it (type and range); other number and true/false keys are written as given (`unranged`) on the photo active in Develop, read back, and the photo is put back from the snapshot taken just before when Lightroom did not take a key. It is its own tool, not a session step: a session's per-pass limits, clipping pull-backs and pass undo work per canonical slider (`engine\src\session\plan.ts`, `guardrail.ts`), so a raw key inside a pass would not be limited or put back by them [inference: from that code].
- **D2** (#214): `lr_undo_last_step`, upstream's `undo_last_step`: Lightroom's Edit > Undo, once, `confirm: true`, refused while a session is open or one was left open.
- **D3** (#218 row 10): `lr_remove_photos`, upstream's `remove_photos_from_catalog`: `LrSelection.removeFromCatalog` on exactly the photos named, `confirm: true`, Lightroom Classic 14.3 or later, a master refused without all its virtual copies, the view put back. The "optional cleanup of unpicked Variants copies" is the same tool: `lr_end_session` and `lr_select_variant` now say that `lr_remove_photos` removes the unpicked copies when the user asks.

The question: does each tool do in Lightroom Classic on Windows what it says, and does Lightroom's module, folder or collection and selection come back as they were? Upstream's behaviour is `[upstream claim]` (macOS, LrC 15.6) until this run. The issues' acceptance: "Each tool: schema, readOnlyHint/destructiveHint annotations, test against the fake plugin, a harness check, and a report template for Jim"; "All tools leave Lightroom's module, source and selection as they were" (#214); for #218, "a Lightroom check by Jim in a copy of a catalog or a throwaway one". This check removes only virtual copies it made itself, so it runs in Jim's own catalog.

## Harness

`npm run develop-catalog:check` (`engine\src\devtools\develop-catalog-check-cli.ts`; the shared `step` in `develop-check.ts`). It calls the engine's tool functions (the `Tools` class, as Claude Desktop does), so the tools' own checks run too. Results go to `%TEMP%\LrC-AVG\develop-catalog-check\develop_catalog_check_<time>.json`. Commands and prerequisites: `.claude\skills\lrc-avg-checks\SKILL.md`.

What it does, in order (the selected photo is only read; every write goes to the check's own copies):
1. Reads the one selected photo's Develop settings and the selection.
2. `lr_create_virtual_copies` three times: copies "AVG develop-catalog-check A", "B" and "C". Only the uuids these calls answer are ever removed.
3. Two refusals that send nothing to Lightroom: an unknown key (`UNKNOWN_PARAMETER`) and `Exposure2012` 9 (`OUT_OF_RANGE`).
4. `lr_set_develop_settings` on copy A: `Exposure2012` +0.5 from its value (a canonical key) and `LensManualDistortionAmount` 10 (an unranged key): expects `set`.
5. `lr_undo_last_step`: expects `undone`; then copy A is compared with step 4's "before".
6. `lr_set_develop_settings` on copy A with `LensManualDistortionAmount` 1000: expects `not_taken` and the put-back; copy A is compared with its settings just before.
7. `lr_remove_photos` with the three copies and a made-up uuid: expects `removed` 3 and `missing` 1; each copy is looked up again and must be gone.
8. The selection, and the selected photo's settings against step 1.
9. Four y/n questions.

If a step stops the run, the check still removes its own copies and says so ("put back").

## Pre-run findings (Claude Code)

- The three tools pass their tests against the simulated Lightroom: request shapes, the not-taken put-back, and the refusals (session open, session left open, confirm missing, unknown key, out of range, a text or table key, the old process version, a master without its copies, a Lightroom older than 14.3, an older plugin) [handle: `engine\tests\develop-catalog-decisions.test.ts`, `npx vitest run tests/develop-catalog-decisions.test.ts` in `engine\`, 12 passed, 2026-10-28].
- The removal call is gated at 14.3 before anything is selected, and no other plugin file calls it [handle: `engine\tests\sdk-version-gate.test.ts` "checks LrSelection.removeFromCatalog before Remove.photos selects anything"]; `Remove.lua` parses as Lua 5.1 and keeps yielding catalog calls outside read gates [handle: `engine\tests\lua-plugin.test.ts`, `engine\tests\lua-read-gate.test.ts`].
- The SDK calls, from Adobe's SDK 15.2 reference on disk: `LrSelection.removeFromCatalog()`, "Removes the selection from the catalog. First supported in version 14.3" [handle: `D:\Developer\LightRoom Classic Dev Kit\API Reference\modules\LrSelection.html:641-643`]; `LrUndo.canUndo()` and `LrUndo.undo()`, "Undoes the last history state", from 6.0 [handle: `API Reference\modules\LrUndo.html:363`, `:393`]; `LrApplicationView.gridView()` from 7.4 [handle: `API Reference\modules\LrApplicationView.html:480-482`]; `virtualCopies`, "All virtual copies of this photo" [handle: `API Reference\modules\LrPhoto.html`, getRawMetadata].
- Not tried in Lightroom yet [unverified]: everything below.
  - Whether `removeFromCatalog` asks the user first (a dialog) or removes at once.
  - What `LrUndo.undo()` undoes after `lr_set_develop_settings`: the write gate "AVG set develop settings …" is expected [inference: a write gate's name is Lightroom's Undo item, LR_SDK_NOTES "Recorded in Phase 6 — 2026-10-02"], not the snapshot or the selection change.
  - Whether Lightroom refuses `LensManualDistortionAmount` 1000 on the photo active in Develop (its range is not pinned).
  - Whether the surviving selection, the module and the source come back after the removal.

## Steps for Jim

1. In PowerShell, update the repo and install:
   ```powershell
   cd D:\Developer\LrC_Autonomous_Gateway
   git switch main
   git pull
   npm install
   ```
2. Quit Claude Desktop (system tray icon > Quit).
3. In Lightroom Classic: File > Plug-in Manager, select LrC-AVG, click Reload Plug-in, then Done.
4. In the Library grid, select ONE raw photo at process Version 6, and only it. The check does not change it; it makes three virtual copies of it and removes them again.
5. Run:
   ```powershell
   npm run develop-catalog:check
   ```
   Lightroom switches to Develop and to the Library grid and back several times; do not click in Lightroom until the window asks a question. It takes about 1-3 minutes.
6. Answer each question with y or n, then Enter.
7. You should see "Develop and catalog decisions check: WORKED" and "put back: YES". Tell Claude Code "done".

### If something goes wrong

- If it says "reload the LrC-AVG plugin": do step 3 again, then step 5.
- If it says "select ONE raw photo": select exactly one photo in the Library grid, then step 5 again.
- If Lightroom shows a dialog asking to confirm removing photos: click Remove (the check selects only its own three copies before it asks Lightroom to remove, and if the dialog is still open after 10 s the grid stays on those copies). Let the run finish, answer n to questions 1 and 2, then tell Claude Code "done".
- If Lightroom shows any other dialog: close it, let the run finish, answer n to question 2, then tell Claude Code "done".
- If it says "put back: NO": in the Library grid (All Photographs), select the copies named "AVG develop-catalog-check A", "B" and "C", choose Photo > Remove Photos..., then Remove. Then tell Claude Code "done".

## Observed (Jim)

_Blank until Jim's run._

## Numbers

| Field | Value |
|---|---|
| Lightroom version, plugin, engine | |
| Headline, put back | |
| Refusals (unknown key, out of range) | |
| `lr_set_develop_settings` on copy A: status, `changed`, `unranged` | |
| `lr_undo_last_step`: `undone`, `can_undo`; copy A against before the write | |
| `LensManualDistortionAmount` 1000: status, `not_taken`; copy A after the put-back | |
| `lr_remove_photos`: status, removed, missing; copies gone | |
| Selection and the photo's settings back | |
| Jim's answers 1-4 | |

## Verdict

_Jim's: go / conditional / no-go._

## Consequences / open questions

- On a go: PARITY.md's three rows lose their `[unverified]`, and LR_SDK_NOTES gets what `removeFromCatalog` and `LrUndo.undo` did on Windows.
- Still `[unverified]` after this run: `lr_set_develop_settings` on a rendered photo and on a photo in HDR edit mode (the extended curve keys), the removal of a master together with its copies, removal of more than three photos, undo after anything other than this tool's write.
