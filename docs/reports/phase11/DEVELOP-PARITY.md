---
report: DEVELOP-PARITY
phase: "11"
status: template
authored_by: "Claude Code (Opus 5.5): purpose, harness, pre-run findings, steps, 2026-10-27. Jim: Observed, Numbers, Verdict (blank until his run)."
date: 2026-10-27
---

# Develop parity tools in Lightroom (#214)

## Purpose

Issue #214 (epic #207) adds the Develop tools upstream Automaat/lightroom-mcp has, on LrC-AVG's safety layer: `lr_apply_auto`, `lr_reset`, `lr_set_process_version`, `lr_list_snapshots`, `lr_create_snapshot`, `lr_apply_snapshot`, `lr_delete_snapshot`, `lr_create_virtual_copies`, and `raw: true` on `lr_get_metadata`. Raw SDK-key writes (D1) and `lr_undo_last_step` (D2) are Jim's open decisions and are not built; mask transfer in `lr_sync_series` waits for #217.

The question: does each tool do in Lightroom Classic on Windows what it says, and does Lightroom's module, folder or collection and selection come back as they were? Upstream's behaviour is `[upstream claim]` (macOS, LrC 15.6) until this run. The issue's acceptance: "Each tool: schema, readOnlyHint/destructiveHint annotations, test against the fake plugin, a harness check, and a report template for Jim"; "All tools leave Lightroom's module, source and selection as they were".

## Harness

`npm run develop:check` (`engine\src\devtools\develop-check-cli.ts`, verdict in `develop-check.ts`). It calls the engine's tool functions (the `Tools` class, as Claude Desktop does), so the tools' own checks run too. Results go to `%TEMP%\LrC-AVG\develop-check\develop_check_<time>.json`. Commands and prerequisites: `.claude\skills\lrc-avg-checks\SKILL.md`.

What it does, in order:
1. Reads both selected photos' Develop settings.
2. `lr_create_snapshot` "develop-check start …" on both (the put-back point).
3. `lr_list_snapshots` on the first: the start snapshot is listed, marked `by_avg`.
4. `lr_apply_auto` with tone and white balance on both: expects `applied` or `unchanged`.
5. `lr_reset` on both: expects `reset`.
6. `lr_set_process_version` 5, then 6, on the first: expects `changed` both times, and records `previous`/`actual`.
7. `lr_get_metadata` with `raw: true` on the first: expects the SDK settings.
8. `lr_create_virtual_copies` of the first, named "AVG develop-check copy": expects `copied`.
9. Reads the selection back.
10. Puts both photos back with `lr_apply_snapshot` (the start snapshot) and compares their settings with step 1.
11. Deletes every snapshot the check and the tools made (`lr_delete_snapshot`) and lists again.
12. Asks three y/n questions.

## Pre-run findings (Claude Code)

- The tools pass their unit tests against the simulated Lightroom [handle: `engine\tests\develop-tools.test.ts`, `engine\tests\develop-snapshots.test.ts`, `npm test` on branch `phase-11/develop-parity`, 2026-10-27].
- `Denoise.lua` now gets its module, source and selection handling from `DevelopSession.lua`, unchanged in behaviour [inference: the code moved as it was; `engine\tests\catalog-denoise.test.ts` and `sdk-version-gate.test.ts` pass]. `npm run denoise:check` was not run again.
- Not tried in Lightroom yet [unverified]: everything below.
  - Whether `LrDevelopController.getProcessVersion()` answers "Version 6" for process version 15.4.
  - Whether `setAutoTone`/`setAutoWhiteBalance` settle within 8 s.
  - Whether Reset clears the crop and the masks [upstream claim].
  - Whether `deleteDevelopSnapshot(snapshotID)` works on 15.6 (spike S5 used it on 15.5.1 [handle: `docs\reports\phase0\S5.md:109`]).
  - Whether `createVirtualCopies` without a name, or of a virtual copy, behaves as expected.

## Steps for Jim

1. In PowerShell, update the repo and install:
   ```powershell
   cd D:\Developer\LrC_Autonomous_Gateway
   git switch phase-11/parity-batch-1
   git pull
   npm install
   ```
2. Quit Claude Desktop (system tray icon > Quit).
3. In Lightroom Classic: File > Plug-in Manager, select LrC-AVG, click Reload Plug-in, then Done.
4. In the Library grid, make virtual copies of two raw photos (Photo > Create Virtual Copy on each). Select both copies, and only them.
5. Run:
   ```powershell
   npm run develop:check
   ```
   Lightroom switches to Develop and back several times; do not click in Lightroom until the window asks a question. It takes about 2-4 minutes.
6. Answer each question with y or n, then Enter. The third question asks you to remove the virtual copy named "AVG develop-check copy": select only it in the grid, Photo > Remove Photo, Remove, then answer.
7. You should see "Develop parity check: WORKED" and "put back: YES". Tell Claude Code "done".

### If something goes wrong

- If it says "reload the LrC-AVG plugin": do step 3 again, then step 5.
- If it says "select two raw photos": select exactly two photos in the Library grid, then step 5 again.
- If it says "put back: NO": in Develop, select each photo, open the Snapshots panel (left) and click the snapshot named in the message. Then tell Claude Code "done".
- If Lightroom shows a dialog during the run: close it, let the run finish, then tell Claude Code "done".

## Observed (Jim)

*(blank until Jim's run)*

## Numbers

| Field | Value |
|---|---|
| Lightroom version, plugin version | |
| `lr_apply_auto` statuses; settings changed | |
| `lr_reset` statuses; masks before/after | |
| `getProcessVersion` before (`previous`) for a 15.4 photo | |
| `lr_set_process_version` 5 / 6 statuses | |
| `lr_get_metadata raw` | |
| `lr_create_virtual_copies` status, copy name | |
| Selection back | |
| Settings back (put back) | |
| Snapshots deleted | |
| Jim's answers 1-3 | |

## Verdict

*(Jim's; the script's WORKED/FAILED is a suggestion)*

## Consequences / open questions

- The "Version N" to process-version number mapping (`engine\src\params\canonical.ts` `PROCESS_VERSION_LABELS`, "Version 6" for 15.4 is `[unverified]`) can be confirmed from step 6.
- `lr_create_virtual_copies` leaves a copy that only Jim can remove: no tool removes photos until D3 is decided.
- The parity map (`docs\reports\phase10\AUTOMAAT_COMPARE_2026-10-26.md` Appendix A) can mark these rows `have` once this run works.
