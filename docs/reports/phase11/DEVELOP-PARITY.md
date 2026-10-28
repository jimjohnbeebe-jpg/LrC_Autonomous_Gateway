---
report: DEVELOP-PARITY
phase: "11"
status: observed
authored_by: "Claude Code (Opus 5.5): purpose, harness, pre-run findings, steps, 2026-10-27; Observed and Numbers copied from the run files, 2026-10-27 (runs 1 and 2). Jim: the run, his answers, Verdict (blank)."
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
   git switch main
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

### Run 1, 2026-10-27: FAILED (one put-back comparison)

Jim ran `npm run develop:check` on two virtual copies of raw photos, `_OZ80739.NEF` (`FCA2E337`, the "first photo") and `_OZ80738.NEF` (`2D31DD06`), and said "done" [stated: Jim, 2026-10-27, "npm run develop:check done."]. The results file ends `headline: FAILED` [handle: `docs\reports\phase11\DEVELOP-PARITY\run1\develop_check_2026-10-28T02-24-27-615Z.json`]:

```text
YES lr_create_snapshot FCA2E337-...: ok (expected ok)
YES lr_create_snapshot 2D31DD06-...: ok (expected ok)
YES lr_list_snapshots: listed (expected listed)
YES lr_apply_auto tone + white balance: applied, applied (expected applied or unchanged)
YES lr_reset: reset, reset (expected reset)
YES lr_set_process_version 5: changed (expected changed)
YES lr_set_process_version 6: changed (expected changed)
YES lr_get_metadata raw: read (expected read)
YES lr_create_virtual_copies: copied (expected copied)
YES lr_apply_snapshot (put back) FCA2E337-...: ok (expected ok)
YES lr_apply_snapshot (put back) 2D31DD06-...: ok (expected ok)
YES the selection is as it was
NO  both photos' Develop settings are back as they were
NO  the check's snapshots are deleted again
YES Jim's answer 1: y
YES Jim's answer 2: y
YES Jim's answer 3: y
```

- **Every tool step worked.** `lr_apply_auto` changed ten Basic settings on each photo, the same way on both: Exposure +0.14 and +0.25, Contrast +6, Highlights -74 and -73, Shadows +61, Whites +7, Blacks -16, Vibrance +15, Saturation +3, Temperature 5050 -> 5150, Tint 21 -> 18. It took 5.9 s and 12.5 s. `lr_reset` put all ten back to the photo's defaults (2.4 s and 2.8 s). `lr_set_process_version` went Version 6 -> 5 -> 6 on the first photo, with no setting changed. `lr_get_metadata raw` read the copy's metadata, its 81 canonical settings and its raw SDK table (`process_version` 15.4). `lr_create_virtual_copies` made "AVG develop-check copy" [handle: `docs\reports\phase11\DEVELOP-PARITY\run1\develop_check_2026-10-28T02-24-27-615Z.json`, `results`].
- **The NO line:** both photos were put back from their start snapshot, and each was then read and compared with the settings read before the check. The second photo compared equal. The first photo did not: it kept its entry, so the check deleted no snapshot ("Not every photo came back"), which explains the second NO. **What differed was not kept.** After Jim's three answers, the harness's cleanup step put the first photo back a second time, and that comparison came out equal (`put_back`: `changed: {}`). The second record overwrote the first, both in `put_back` and under the same step name in `results` [handle: `docs\reports\phase11\DEVELOP-PARITY\run1\develop_check_2026-10-28T02-24-27-615Z.json`, `steps` lists "lr_apply_snapshot (put back) FCA2E337-..." twice; `put_back` holds only that photo]. The engine's tool log folder for the run is empty.
- **Timing, from the plugin's log** [handle: `docs\reports\phase11\DEVELOP-PARITY\run1\bridge-log-excerpt.txt`]: the first photo's put-back ran at 19:24:58.563, and the harness's comparison read at 19:25:00.300, 1.7 s later. The second photo's put-back ran at 19:25:16.398, read at 19:25:18.045. The cleanup's put-back of the first photo ran at 19:26:26.415, read at 19:26:28.317. All three reads come after the apply returned. The first photo is the one that also had its process version changed twice and a virtual copy made from it (19:24:53-19:24:58), just before its put-back.
- **Jim's answers:** 1 y (Lightroom back in the same module and source, same two photos selected); 2 y (History of the first photo shows this check's steps); 3 y (Jim removed the "AVG develop-check copy" virtual copy).
- **Left behind:** since no snapshot was deleted, both photos keep this check's snapshots ("AVG develop-check start ...", "AVG pre-auto ...", "AVG pre-reset ...", "AVG pre-process-version ..." twice on the first photo, "AVG pre-apply ..."). Both photos are Jim's virtual copies made for this check.

### Run 2, 2026-10-27: WORKED

After the fix PR #240 (`a6f9bb5`; the harness keeps the first put-back's record), Jim reloaded the plugin and ran `npm run develop:check` on two other raw virtual copies (`E0675F16`, the first photo, and `DD6E06AA`) [stated: Jim, 2026-10-27, "Finished npm run develop:check"]. The results file ends `headline: WORKED`, `put_back_ok: true`; LrC 15.6, plugin 1.5.0, engine 1.5.0 [handle: `docs\reports\phase11\DEVELOP-PARITY\run2\develop_check_2026-10-28T04-13-10-877Z.json`]:

```text
YES every tool step (snapshots x2, list, auto, reset, process version 5 and 6, get_metadata raw, virtual copy)
YES lr_apply_snapshot (put back) E0675F16-...: ok
YES lr_apply_snapshot (put back) DD6E06AA-...: ok
YES lr_delete_snapshot x10 (6 on the first photo, 4 on the second): ok
YES the selection is as it was
YES both photos' Develop settings are back as they were
YES the check's snapshots are deleted again
YES Jim's answers 1-3: y, y, y
```

- **Put back at the first comparison:** both photos compared equal (`put_back`: `changed: {}` for each), so run 1's NO did not repeat. Why run 1's first photo differed stays unknown: its differences were not kept, and this run had none to keep.
- **Nothing left behind** but the "AVG develop-check copy" virtual copy, which Jim removed (answer 3).

## Numbers

| Field | Value |
|---|---|
| Lightroom version, plugin version | LrC 15.6, plugin 1.5.0 |
| `lr_apply_auto` statuses; settings changed | applied, applied (white balance and tone each applied); 10 Basic settings each, 5.9 s and 12.5 s |
| `lr_reset` statuses; masks before/after | reset, reset; the 10 settings back to default; masks not reported (neither photo had a mask) [inference: no `masks` key in either result] |
| `getProcessVersion` before (`previous`) for a 15.4 photo | "Version 6" (the photo's `ProcessVersion` is 15.4) |
| `lr_set_process_version` 5 / 6 statuses | changed ("Version 6" -> "Version 5"), changed ("Version 5" -> "Version 6"); no setting changed |
| `lr_get_metadata raw` | read: canonical settings, SDK table, metadata |
| `lr_create_virtual_copies` status, copy name | copied, "AVG develop-check copy" |
| Selection back | YES |
| Settings back (put back) | Run 1: **NO** for the first photo at the first comparison (what differed was not kept); YES for the second photo; YES for the first photo at the cleanup's second put-back, 88 s later. Run 2: YES for both at the first comparison |
| Snapshots deleted | Run 1: NO (skipped because a photo was not back). Run 2: YES, 10 of 10 |
| Jim's answers 1-3 | Run 1: y, y, y. Run 2: y, y, y |

Run 1 from `docs\reports\phase11\DEVELOP-PARITY\run1\develop_check_2026-10-28T02-24-27-615Z.json` and `docs\reports\phase11\DEVELOP-PARITY\run1\bridge-log-excerpt.txt`; run 2 from `docs\reports\phase11\DEVELOP-PARITY\run2\develop_check_2026-10-28T04-13-10-877Z.json`.

## Verdict

**Conditional** [stated: Jim, 2026-10-27, "Go with recommendations. 5. Agreed"]: on a rerun after the harness keeps the first put-back's differences (fix PR after #239).

## Consequences / open questions

- The "Version N" to process-version number mapping: **"Version 6" is 15.4** on this photo: `previous` "Version 6" and `ProcessVersion` "15.4" [handle: `docs\reports\phase11\DEVELOP-PARITY\run1\develop_check_2026-10-28T02-24-27-615Z.json`, `lr_set_process_version 5` and `lr_get_metadata raw`].
- **Open: why the first photo's first put-back did not compare equal.** It may be timing (read 1.7 s after the apply, though the second photo compared equal at the same delay), or something the process-version round trip or the virtual copy left that one snapshot apply did not undo and a second did [inference: both unconfirmed]. A rerun with a harness that keeps the first comparison's differences would answer it; that is Jim's decision.
- **Harness defect:** the cleanup's second put-back overwrites the first put-back's record (`put_back`, and the step's result under the same name), so a NO loses its evidence [handle: `engine\src\devtools\develop-check-cli.ts:85-95` and `:160`].
- `lr_create_virtual_copies` leaves a copy that only Jim can remove: no tool removes photos until D3 is decided.
- The parity map (`docs\reports\phase10\AUTOMAAT_COMPARE_2026-10-26.md` Appendix A) can mark these rows `have` once this run works.
