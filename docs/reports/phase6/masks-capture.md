---
report: masks-capture — how Lightroom stores and changes masks (GitHub issue #59, PR C step 1)
phase: 6
status: observed
authored_by: "Template, harness, pre-run findings, open questions and the Capture 2 section: Claude Code (Opus 5.5), 2026-10-03 (branch phase-6/masks). Capture 1 Observed and Numbers: collected by Claude Code from Jim's run files (committed in the masks-capture folder beside this report), Jim's y/n answers as typed. Capture 2 Observed: blank until Jim's run. Verdict: Jim."
date: 2026-10-03
---

# masks-capture — how Lightroom stores and changes masks

## Purpose

Before any mask tool is built (issue #59, PR C step 2), learn from one live photo how Lightroom Classic stores masks in `getDevelopSettings()`, and what writing them back does. Rule 03 allows SDK key names in our code only from a live `getDevelopSettings()` dump; this capture takes that dump, with masks in it.

**Jim's decisions, 2026-10-03:**
- Masks work inside editing sessions [stated: "Inside sessions (Recommended)"].
- The mask route is the mask table written with `applyDevelopSettings` (plus `photo:updateAISettings()` for AI masks), with an `LrDevelopController` fallback for AI masks [stated: "Table + Develop fallback"].
- The capture photo is `20260907-_OZ80099.NEF` [stated].

**The questions** (the check's step numbers in brackets):
1. Which top-level key holds the masks, and what does each of five mask types look like: linear gradient, radial gradient, Select Sky, Select Subject, luminance range? [3]
2. Are the entries' ids stable: between two reads, after a write-back, after a snapshot? [3, 4, 11]
3. Does the unchanged table, written back through the bridge (Lua → JSON → engine → JSON → Lua), read back identical? [4]
4. How is a mask's local exposure stored? The research says EV/4 [community: issue #59 research]. Does the panel agree? [5]
5. Does a global-only write leave the mask table alone? [6]
6. Does an AI mask added as a table entry compute after `update_ai_settings`, and how long does it take? [7]
7. Which fields hold a gradient's geometry, and in which frame do written values land (uncropped or cropped photo)? [8]
8. Are there fields to rename or hide a mask, and does writing them show in the Masks panel? [9]
9. Does writing the array without one entry delete just that mask? [10]
10. Does `applyDevelopSnapshot` put the mask table back? [11, 12, 13]
11. `LrDevelopController` (the D3 fallback):
    - the shape of `getAllMasks()`;
    - whether `createNewMask("aiSelection", "sky")` returns before the mask exists;
    - whether a `setValue` of `local_Exposure` right after it is dropped, and one after a wait is kept;
    - whether `selectMask` and `deleteMask` take the id once or twice;
    - whether its mask ids appear in the table. [12]
12. Does a plugin that declares `LrSdkVersion = 13.0` see `photo:updateAISettings`, which came with SDK 13.3? [7]

**Go / no-go rule.** PHASES.md gives this capture no rule. Proposed [inference], for Jim to decide:
- **go** for step 2's table route when questions 1, 3, 9 and 10 come back clean and PUT BACK is YES;
- AI masks by table go when question 6 computes. Otherwise step 2 builds the D3 fallback, if question 11 shows it works;
- **no-go** when the table cannot be written back unchanged (question 3). Mask tools then wait for a new decision.

**How the check asks Jim:** y/n questions in the PowerShell window, as in the phase checks (rule 04 lets Jim choose this per check). Every question is phrased so that `y` is the good answer.

## Harness

| Part | Files |
|---|---|
| Plugin 0.11.0 | `plugin\LrC-AVG.lrplugin\Masks.lua` (new): `update_ai_settings`, `probe_masks_dc`; registered in `Dispatch.lua`; version in `Info.lua`, `Bridge.lua` |
| Engine protocol | `engine\src\bridge\protocol.ts` `COMMANDS` (zod result schemas) and `CommandPayloads`; `engine\src\bridge\version.ts` `PLUGIN_VERSION` 0.11.0 |
| Tests | `engine\tests\bridge-masks.test.ts` (contract), `engine\tests\helpers\lightroom-sim-masks.ts` (the sim's answers), `engine\tests\lua-plugin.test.ts` (handlers = `COMMANDS`, Lua 5.1 parse) |
| The check | `logs\check-masks-capture-2026-10-03\check.mts` (gitignored, like the earlier one-off checks; Jim runs it from there). The copy Jim ran is committed as `docs\reports\phase6\masks-capture\check-capture1.mts.txt`, and its dry runs as `dryrun-capture1.txt` beside it |
| Jim's run | `docs\reports\phase6\masks-capture\`: `transcript.txt`, `check.json`, `3_dump-1.json` (the five-entry table), `12_probe_dc.json` (the DC probe), copied from his run's files; no user folder appears in them |

**The two commands** [handle: `plugin\LrC-AVG.lrplugin\Masks.lua` header]:
- **`update_ai_settings { photo_uuid, expect? }`** → `{ uuid, call_ms, command_ms, gate? }`. It finds the photo by uuid (`Photos.find`), then calls `photo:updateAISettings()` in its own write gate, `"AVG update AI masks"`.
  - A Lightroom without the call answers `feature_unavailable` (recoverable). A call that raises answers `update_failed`.
  - It does not wait for the mask to compute: the check reads `get_settings` for that. So no mask field name is written in Lua.
- **`probe_masks_dc { target_uuid }`** → `{ uuid, filename, steps: [{ step, ok, result | error, ms }], stopped? }`. It works on the selected photo, outside any write gate. If the selected photo is not `target_uuid`'s, it refuses with `target_mismatch`, as `Develop.lua` `target()` does.
  - `LrDevelopController` acts on the current photo, not on a photo object. So before every step the probe checks that the selected photo is still the target and that its own 60 s deadline has not passed. If either fails, it records why in `stopped` and runs no further step. A probe the engine has given up on therefore stops by itself.
  - it switches to Develop and opens Masking;
  - it creates an AI sky mask, writes `local_Exposure` 0.5 at once, waits up to 10 s for the mask to show in `getAllMasks()`, then after 2 s more writes 0.75 and reads the photo's settings;
  - it creates an AI subject mask;
  - it selects the sky mask with `selectMask(id)` and the subject mask with `selectMask(id, id)`;
  - it deletes the sky mask with `deleteMask(id)` and the subject mask with `deleteMask(id, id)`.
  - Every SDK call is looked up with `type(fn) == "function"` and run under `LrTasks.pcall`. A missing call is recorded as a failed step, never raised. Every wait has a timeout.

**What the check is written to do** [handle: `docs\reports\phase6\masks-capture\check-capture1.mts.txt` header]: steps 0-13 as listed in the Purpose. It uses the plugin's raw `get_settings` and `apply_settings`, because the params map would refuse mask keys. It finds the mask key by structure: the top-level array of objects that changed between the dump before step 2 and the dump after it. No key name is assumed for it.

It labels each new entry two ways and records whether they agree:
- by the order Jim made the masks;
- by the type strings inside the entry. The strings it looks for (`Mask/Gradient`, `Mask/CircularGradient`, `Mask/Image`, `RangeMask`) are [community: issue #59 research].

Field names it changes are found in Jim's own entries and are named in check.json:
- a top-level number whose name starts with `LocalExposure`;
- geometry fields `ZeroX/ZeroY/FullX/FullY` and `Top/Left/Bottom/Right` [community: same research], set only when Jim's entry has them. The new linear gradient goes at the bottom (full effect at the bottom edge, gone a third of the way up), where Jim's own linear (top edge down) is not, so its question can come back `n`;
- `*Name*` strings and `*Active*` booleans. When the entries have a name field, the copies are named `AVG new sky`, `AVG new linear` and `AVG new radial`, and the questions call them by those names;
- string fields ending in `ID`, which a copied entry gets new values for in the same format;
- fields with `Digest` in the name, which a copied entry drops.

The History names it writes:
- `AVG capture write-back`
- `AVG capture local exposure`
- `AVG capture global write`
- `AVG capture add sky`
- `AVG capture add gradients`
- `AVG capture rename hide`
- `AVG capture delete radial`
- `AVG update AI masks`, the write gate's name

Whatever happens, the snapshot `AVG capture before <time>` puts the photo back at the end, and every setting is compared with the start. The snapshot and the History steps stay on the photo, as in the earlier checks.
- **Ctrl+C.** In a terminal, readline takes Ctrl+C itself, and without handlers a second one would end Node before the put-back. So Ctrl+C (readline's and the process's `SIGINT`) and closing the window (`SIGHUP`) only set a flag. The check then skips every remaining step and goes straight to the put-back. Step 1 prints the snapshot's name and the manual fallback. Closing the window leaves Node about 10 s before Windows ends it [handle: https://nodejs.org/api/process.html#signal-events, read 2026-10-03], which may cut the put-back short, so Jim's steps say Ctrl+C.
- **After the probe.** The check passes `target_uuid`, checks that the probe answered for `_OZ80099`, and calls `get_selection` afterwards to report any change of selection. When the probe fails or times out (the check waits 90 s), it reads the settings every second until they have held still for 5 s, for at most 90 s, before it applies the snapshot.
- **Absent, `[]` and `{}`** count as the same in every comparison: a photo without masks has no mask key at all (pre-run finding 2). Step 6 reports "unchanged" only when the mask key was there before its write.

Results land in the check's folder: `check.json`, `transcript.txt`, and `raw\*.json` (the full dumps). Copies of the dumps go to `%TEMP%\LrC-AVG\masks-capture\`. Claude Code collects them.

### Steps for Jim

Do these when Claude Code asks for the run. Claude Code has checked out `phase-6/masks` in the repo folder and run `npm run build` first. It takes about 15 minutes [inference: five masks by hand and up to nine questions].

1. Right-click the Claude icon in the Windows system tray, then click **Quit**.
2. In Lightroom Classic, open **File > Plug-in Manager**. In the list on the left, click **LrC-AVG (Autonomous Vision Gateway)**, then click **Reload Plug-in**. Click **Done**, then wait 20 seconds.
3. In the **Library** module's **Folders** panel (left side), click the `fixtures` folder, so `20260907-_OZ80099.NEF` shows in the Filmstrip.
4. In VS Code's PowerShell terminal, at `D:\Developer\LrC_Autonomous_Gateway`, run:

   ```powershell
   node logs\check-masks-capture-2026-10-03\check.mts
   ```

   You should see `YES  Lightroom 15.6 runs plugin 0.11.0`, then `YES  selected 20260907-_OZ80099.NEF; snapshot ... taken`.
5. It lists steps a-g. Follow them in Lightroom, in that order:
   1. press **D**, then **Shift+W**;
   2. Linear Gradient, with Exposure **0.5**;
   3. Radial Gradient;
   4. Sky;
   5. Subject;
   6. Range > Luminance Range, then one click on a bright part.

   Come back to the PowerShell window and press **Enter**. Then answer its question with `y` or `n` and **Enter**.
6. It writes to the photo by itself. It stops to ask up to eight more questions. Each one tells you where to look first (the Masks panel, a mask's Exposure slider, or the whole photo). Type `y` or `n`, then press **Enter**.
7. When it prints `12. The plugin now drives the Develop module by itself`, do not click in Lightroom until the next line appears (up to a minute).
8. The last lines say `PUT BACK: YES` or `NO`, ask whether the photo looks as before, then say `masks capture: WORKED` or `DONE, n NO / FAILED lines`. A NO line is a finding, not your mistake. Tell Claude Code "done".

The menu labels in step 5 (Create New Mask, Linear Gradient, Range > Luminance Range) are written from Lightroom's usual Masking panel, not observed in this project [unverified].

### If something goes wrong

- If it prints `LOCK BUSY`, Claude Desktop is still running: do step 1 again, wait 60 seconds, then do step 4 again.
- If it prints `Lightroom plugin not connected within 30000 ms`, check that Lightroom is open and that **File > Plug-in Manager** lists LrC-AVG as **Enabled**, then do step 4 again.
- If it prints `NO   Lightroom ... runs plugin 0.9.0` (or any number below 0.11.0), quit Lightroom, start it again, wait 20 seconds, then do step 4 again.
- If you need to stop, or the window shows no new line for 5 minutes after you pressed Enter, press **Ctrl+C** once. Do not press it again, and do not close the window. It prints `ABORTING`, then puts the photo back by itself and prints `PUT BACK: YES` or `NO`. Wait for those last lines. Tell Claude Code.
- If it prints `PUT BACK: NO`, wait 1 minute. Then, in Lightroom's Develop module, open the **Snapshots** panel (left side) and click the snapshot it names (it starts with `AVG capture before`). Tell Claude Code.

## Pre-run findings (Claude Code)

1. **The JSON round trip keeps a mask table as Lightroom gave it.** `get_settings` returns the whole `getDevelopSettings()` table [handle: `plugin\LrC-AVG.lrplugin\Develop.lua:65,126`]. `apply_settings` passes `payload.settings` straight to `applyDevelopSettings` [handle: `Develop.lua:142`]. What survives `Json.lua`, read from the code (no Lua runtime runs here, so this is [inference] from the lines named):
   - **Nested arrays and objects** survive.
     - A table whose keys are exactly 1..n is written as an array [handle: `plugin\LrC-AVG.lrplugin\Json.lua:35-42`, `57-60`]. It decodes to keys 1..n again [handle: `Json.lua:183-197`].
     - Any other table is written as an object with string keys [handle: `Json.lua:61-63`].
     - A table with both array and string keys, or with holes, would come back with string keys "1", "2", …, which is lossy. Whether Lightroom's mask table holds such a table is answered by step 4.
   - **Empty tables** are written as `[]` and decode to an empty table [handle: `Json.lua:12`, `36`], the same thing in Lua. Lua cannot tell `{}` from `[]` in the first place.
   - **Numbers.** Lua 5.1 has only doubles. They are written with `%.14g` [handle: `Json.lua:32`], so a value needing 15-17 significant digits is rounded at the 14th, a change below 1e-13 relative. Rounding twice at 14 digits gives the same text, so step 4's comparison cannot see it, and no render can. Integers up to 1e14 are exact. NaN and infinities become `null`, which decodes to nil, so the key would be dropped [handle: `Json.lua:31`, `206`].
   - **Strings** pass as UTF-8; only `"`, `\` and control bytes are escaped [handle: `Json.lua:4-8`].
   - **Booleans** pass as they are.
   - **Functions and userdata** fail the encode. The engine then gets `encode_failed` instead of silence [handle: `Json.lua:66`; `plugin\LrC-AVG.lrplugin\Bridge.lua:128`]. A mask table holding userdata would show as that error at step 3.
   - **Size and depth.** Nesting is capped at 64 [handle: `Json.lua:45`]. Lines are capped at 32 MiB on the engine side [handle: `engine\src\bridge\lines.ts:19`]. LrSocket passed 16 MiB [handle: vault LR_SDK_NOTES "To record in Phase 0", LrSocket].
   - **Verdict: `Json.lua` is not changed.** Step 4 is the live check.
   - Step 4 cannot tell "taken" from "ignored", because an ignored write also reads back unchanged. Step 5's changed value tells them apart.
2. **The mask key is absent from the pinned dumps.** The S5 NEF dump, a photo without masks, has `EnableMaskGroupBasedCorrections: true` and no mask table key [handle: `docs\reports\phase0\S5\s5_20260907-_OZ80093.NEF.json`; `engine\src\params\sdk-keys.lrc15.json:500`]. So the table appears only when masks exist [inference], and the check finds it by what changed rather than by name.
3. **The SDK reference.**
   - `photo:updateAISettings()`: "Updates AI Settings for this photo. Must be called from within a catalog:withWriteAccessDo or catalog:withProlongedWriteAccessDo gate. First supported in version 13.3 of the Lightroom Classic SDK" [handle: https://lrc.mcor.dev/modules/LrPhoto.html, read 2026-10-03].
   - `getAllMasks`, `getSelectedMask`, `createNewMask`, `selectMask`, `deleteMask` and `goToMasking` are SDK 11.0. All but `goToMasking` "Must be called while the Develop module is active", and `getSelectedMask`, `selectMask` and `deleteMask` also while the masking tool is open [handle: https://lrc.mcor.dev/modules/LrDevelopController.html, read 2026-10-03].
   - `selectMask` and `deleteMask` are listed as `(id, param)`, with one description for both arguments.
   - `local_Exposure` is in the reference's "Version 6" list of local parameters [handle: same page].
   - `switchToModule` and `getCurrentModuleName` are SDK 6.0 [handle: https://lrc.mcor.dev/modules/LrApplicationView.html, read 2026-10-03].
4. **The plugin declares `LrSdkVersion = 13.0`** [handle: `plugin\LrC-AVG.lrplugin\Info.lua`], below `updateAISettings`'s 13.3. (Jim's run answered this: the call worked; see Numbers.) Whether Lightroom hides newer calls from such a plugin is [unverified]. If step 7 answers `feature_unavailable`, this is the first suspect [inference]. Changing the declared version is Jim's decision, not part of this step.
5. **The capture photo's uuid** is `CF12AF60-0858-4181-9562-376D16B89126`, an original (no copy name), local id 3869534 [handle: `docs\reports\phase4\P4\p4_chat_session\20260927-26ecc4.json` `target`].
6. **Dry runs** of `check.mts` against the test sim [handle: `docs\reports\phase6\masks-capture\dryrun-capture1.txt`, five runs, 2026-10-03, user folder redacted; the driver is reproduced in the working copy's `logs\check-masks-capture-2026-10-03\dryrun-driver.ts.txt`, not committed]. They show only that the script runs, skips, times out and puts back. They show nothing about Lightroom.
   - **Run 1, the sim as it is (no masks).** Step 3 reports `NO the settings hold a new array of mask entries`, steps 4, 5 and 7-10 are skipped, and step 6 writes. After the probe the selection is still the photo. `PUT BACK: YES`; one History step (`AVG capture global write`).
   - **Run 2, an invented five-entry table injected at the Enter prompt.**
     - Every mask step ran: 5 entries identified, the write-back identical, the local exposure 0.125 → 0.25 read back, the global write leaving the table unchanged.
     - The sim never computes, so step 7 waited its full 30 s (114 reads) and reported NO.
     - The copies were named `AVG new sky`, `AVG new linear` and `AVG new radial`, and the questions used those names. Both gradients' geometry read back as written; the rename and hide fields were found; the delete went from 8 to 7 entries with the others unchanged.
     - The snapshot restored everything; `PUT BACK: YES`; seven History steps.
   - **Run 3, hello reporting plugin 0.9.0.** The check stops after `hello`: no write, no snapshot.
   - **Run 4, the invented table and a Ctrl+C before step 5.** The script's dry-run hook emits readline's `SIGINT` event. It printed `ABORTING`, ran no further step, then put back (`PUT BACK: YES`, one History step). A real keyboard Ctrl+C, and the process `SIGINT` / `SIGHUP` handlers, were not exercised: the dry run has no terminal, and on Windows a signal sent to a child process ends it at once [handle: https://nodejs.org/api/process.html#signal-events]. So those stay [unverified].
   - **Run 5, the probe answering an error.** The settings held still for 5 s (5053 ms) before the snapshot was applied; `PUT BACK: YES`.
7. **Tests.** Before: 833 passed, 7 skipped (840), in 61 files. After capture 1's commands: 840 passed, 7 skipped (847), in 62 files: the 5 contract tests in `bridge-masks.test.ts`, and the Lua 5.1 parse and no-utf8 checks for `Masks.lua`. After capture 2's: 846 passed, 7 skipped (853), in 62 files (`npm test`, 2026-10-03): 2 more contract tests, and the same checks for `MaskProbe.lua` and `MaskCalibrate.lua`. `npm run build` and `npm run typecheck` pass.

## Observed (Jim)

*Collected by Claude Code from Jim's run files; Jim's y/n answers as typed.* Jim ran the check on 2026-10-03 from 21:57:42 to 22:02:14 UTC. The files are committed in `docs\reports\phase6\masks-capture\`: `transcript.txt`, `check.json`, `3_dump-1.json` and `12_probe_dc.json`.

- **hello:** plugin 0.11.0, Lightroom 15.6, declared SDK 13 [handle: `check.json` `hello`].
- **Step 1:** `20260907-_OZ80099.NEF` selected, snapshot `AVG capture before 14:57:43`, 177 settings saved. The photo is uncropped: `CropLeft` 0, `CropRight` 1, `CropTop` 0, `CropBottom` 1, `CropAngle` 0 [handle: `check.json` step `1_photo`].
- **Every YES/NO line read YES** (20 lines), `failures` is empty, and the last line reads `masks capture: WORKED` [handle: `transcript.txt` lines 2-63; `check.json` `failures`].
- **Jim answered `y` to all eight questions** [handle: `transcript.txt` lines 18, 28, 36, 41, 43, 46, 47, 61]:
  1. "Did you make all five masks, in the order b-f …?"
  2. "Does its Exposure now show +1.00?"
  3. "Is there a mask named 'AVG new sky', and does its red overlay cover the sky?"
  4. "Is the bottom of the photo brighter than before, fading out about a third of the way up ('AVG new linear')?"
  5. "Does that oval sit in the upper right of the photo (right half, upper half)?"
  6. "Is the mask that was 'AVG new linear' now named 'AVG renamed'?"
  7. "… Is the brightening at the bottom of the photo gone now (the 'AVG renamed' mask switched off)?"
  8. "Does the photo look as it did before the check, with none of the check's masks left?"

## Numbers

*From the files above.*

| Field | Value |
|---|---|
| Mask key; entries before / after step 2 | `MaskGroupBasedCorrections`; 0 / 5. No other top-level key changed [handle: `check.json` `3_dumps.changed_top_keys`] |
| Entry labels (by strings / by order, agree?) | 0 linear, 1 radial, 2 sky, 3 subject, 4 luminance; strings and order agree for all five [handle: `check.json` `3_dumps.labels`] |
| Differing paths between two reads (ids stable?) | 0: ids stable between reads [handle: `3_dumps.differs_between_reads`] |
| Differing paths after the unchanged write-back | 0, every setting compared [handle: `4_write_back.differing`] |
| Local exposure field; value stored for +0.50; panel shows +1.00 after doubling (y/n) | `LocalExposure2012`; 0.125 (EV/4); 0.25 written and read back; y [handle: `5_local_exposure`; `transcript.txt` line 28] |
| Mask table differing after a global-only write | 0, with `Exposure2012` 0.33 → 0.43 [handle: `6_global`] |
| `update_ai_settings` call_ms; sky by table computed (ms, reads) or not | 2,844.7 ms, gate `executed`, at declared SDK 13. The copy written without digests got new `MaskDigest`, `InputDigest` and `LocalInputDigest` 1,216 ms after the call (1 read), with no error field [handle: `7_sky`] |
| Geometry fields found; read back as written; where they landed (y/n) | Linear `ZeroX/ZeroY/FullX/FullY`, radial `Top/Left/Bottom/Right`; both read back as written; y, y [handle: `8_geometry_plan`, `transcript.txt` lines 38-43]. The radial also has `Angle`, `Feather`, `Midpoint`, `Roundness`, `Flipped` and `Version` [handle: `3_dump-1.json`, entry 1] |
| Name / active fields; panel shows rename / hide (y/n) | `CorrectionName`, `CorrectionActive`; y, y [handle: `9_fields`, `9_fields_written`] |
| Delete by omission: count before → after, others unchanged | 8 → 7, 0 differing paths [handle: `10_delete`] |
| Mask table after the snapshot (differing paths) | 0, and 0 in all settings [handle: `11_snapshot`] |
| DC probe: steps ok / failed; createNewMask → mask visible (ms); setValue immediate / after wait kept | 32 / 0. Sky 2,479 ms, subject 875 ms. `getValue("local_Exposure")` right after `setValue(…, 0.5)` returned nothing; after the wait, `setValue(…, 0.75)` then `getValue` returned 0.75. Yet `getDevelopSettings()` read right after showed `LocalExposure2012` 0 [handle: `12_probe_dc.json` steps `getValue_immediate_sky`, `getValue_after_wait_sky`, `getDevelopSettings_after_sky`] |
| DC probe: selectMask 1 arg / 2 args; deleteMask 1 arg / 2 args | Each worked: the selected mask became the one asked for, and the count went 2 → 1 → 0 [handle: `12_probe_dc.json` steps `getSelectedMask_after_1arg`, `_2arg`, `mask_count_after_1arg`, `_2arg`] |
| DC sky id found in the table (field name) | `CorrectionID` (`8E077BDB-…`); the DC tool id equals the table's `MaskID` (`2DB0B254-…`) [handle: `12_probe_dc.json` `getAllMasks_after_sky` against `getDevelopSettings_after_sky`] |
| PUT BACK (differing paths); photo as before (y/n) | 0 after the probe, 0 at the put-back; y [handle: `12_snapshot_after_probe`, `13_put_back`; `transcript.txt` line 61] |

## Verdict

*Jim's decision: go / conditional / no-go, per the proposed rule in Purpose.*

## Consequences / open questions

- **For step 2** (after Jim's go): pin the mask table's shape as a zod schema, and the local key names, from these dumps into `engine\src\params\` (rule 03). Map the panel's units to stored units from the step 5 number. Choose the AI-mask route from steps 7 and 12.
- **For the vault LR_SDK_NOTES**, after Jim accepts: the mask table facts this run observes.
- **Still [unverified] after this run, whatever it shows:**
  - mask types not captured: brush, color and depth range, objects, people, landscape, background;
  - a cropped, rotated or Upright photo's geometry frame;
  - `createNewMask` inside a write gate (the probe stays outside; the research says a gate rolls it back [community]);
  - the History names Lightroom gives the probe's DC steps, which the SDK cannot read;
  - timing on a photo whose AI model is not yet loaded;
  - whether `Reload Plug-in` loads a new Lua module such as `Masks.lua`, or only a restart does [inference: `require` loads it on the reload]. Step 0's version line shows which.
- `Json.lua` keeps `%.14g` (pre-run finding 1). If a later mask value needs more digits, `%.17g` would carry every double exactly, at the cost of longer numbers in every settings line [inference].

## Capture 2: every local slider's scale, and the AI mask templates

### Purpose

Capture 1 worked on Jim's run: every line YES, and the put-back exact [handle: `docs\reports\phase6\masks-capture\check.json`, `failures` empty, 8 answers `y`; capture 1's Observed and Numbers above]. It pinned one scale: the local exposure is stored as EV/4. The panel's +0.50 was stored as 0.125, and a stored 0.25 showed as +1.00 [handle: same file, step `5_local_exposure`; Jim answered y]. Step 2 needs the scale of every local slider, and the table entries of the AI masks capture 1 did not make. Jim chose to run a second capture first [stated: "Yes, capture 2 first (Recommended)", relayed by the lead, 2026-10-03].

**The questions:**
- **A.** For each slider field of a correction, what does the Masks panel show for a stored value? Is the relation linear, which `LrDevelopController` name reads it, and what range does the panel give it?
  - The fields: `LocalTemperature`, `LocalTint`, `LocalExposure2012`, `LocalContrast2012`, `LocalHighlights2012`, `LocalShadows2012`, `LocalWhites2012`, `LocalBlacks2012`, `LocalTexture`, `LocalClarity2012`, `LocalDehaze`, `LocalHue`, `LocalSaturation`, `LocalSharpness`, `LocalLuminanceNoise`, `LocalMoire`, `LocalDefringe`, `LocalToningHue`, `LocalToningSaturation`, `LocalGrain` [handle: `docs\reports\phase6\masks-capture\3_dump-1.json`, capture 1's linear entry].
  - `LocalExposure`, `LocalContrast`, `LocalClarity`, `LocalBrightness`, `CorrectionAmount` and `LocalCurveRefineSaturation` are recorded each round but not written. They are not the sliders of process version 15.4 [inference: older-process names, and the amount].
- **B.** Which table entries does Lightroom make for AI masks of type `background`, `people` and `landscape`, created through `LrDevelopController`? `objects` is left out: without a stroke it would likely leave Lightroom in a tool [inference].
- **C.** Does the panel show the value the probe read? One question for Jim.

**Proposed rule** [inference], for Jim to decide: step 2 pins a field's scale only when its row in `calibration.json` has no flag. A field with a flag is refused by the mask tools until it is understood. Likewise, step 2 pins an AI mask type only when `templates.json` holds its entry.

### Harness

| Part | Files |
|---|---|
| Plugin | `plugin\LrC-AVG.lrplugin\MaskCalibrate.lua` (new): `probe_masks_calibrate`, `probe_masks_create`. `MaskProbe.lua` (new) holds the probes' shared parts, split out of `Masks.lua`. Plugin version unchanged at 0.11.0. |
| Engine protocol | `engine\src\bridge\protocol.ts` (both commands, zod result schemas); sim answers in `engine\tests\helpers\lightroom-sim-masks.ts`; contract tests in `engine\tests\bridge-masks.test.ts` |
| The check | `logs\check-masks-calibrate-2026-10-03\check.mts` (gitignored; Jim runs it from there). The copy at this commit is `docs\reports\phase6\masks-capture\check-capture2.mts.txt`, and its dry runs are `dryrun-capture2.txt` |

**The two commands** [handle: `plugin\LrC-AVG.lrplugin\MaskCalibrate.lua` header]. Both are probes like `probe_masks_dc`: pinned to `target_uuid`, re-checked before every step, bounded by their own deadline, and outside any write gate (`MaskProbe.lua`).
- Every probe, `probe_masks_dc` included, calls `goToMasking` only when `getSelectedTool` is not `"masking"`, the only way capture 1 called it.
- Every probe ends with `selectTool("loupe")` and records `getSelectedTool_end`, so the capture does not leave Lightroom in a mask tool. That `"loupe"` closes Masking is [unverified] until this run.
- **`probe_masks_calibrate { target_uuid, mask_id, mask_name?, names }`** → `{ uuid, filename, steps, stopped?, selected? }`.
  - It waits up to 5 s for the mask to be listed, then selects it by id. If that does not take, it selects it by name.
  - Then it waits a second and reads `getValue` and `getRange` of each name. With no mask selected it reads nothing.
  - The DC mask id is the table's `CorrectionID`, and the DC tool id is the table's `MaskID` [handle: Jim's capture 1 run, `docs\reports\phase6\masks-capture\12_probe_dc.json`, `getAllMasks_after_sky` (`8E077BDB-…`, tool `2DB0B254-…`) against `getDevelopSettings_after_sky`].
- **`probe_masks_create { target_uuid, subtypes, wait_seconds? }`** → `{ uuid, filename, steps, stopped? }`.
  - It calls `createNewMask("aiSelection", subtype)` for each subtype and waits up to `wait_seconds` (default 10) for the mask to show.
  - It records the ids that are new since just before each create (`new_masks_<subtype>`).
  - The masks stay; the check puts the photo back with a snapshot.

**What the check is written to do** [handle: `docs\reports\phase6\masks-capture\check-capture2.mts.txt` header]:
0. It takes the instance lock and checks the plugin version. Both commands must answer an empty payload with `bad_request`; an older build of 0.11.0 answers `unknown_command`, and the check then asks for a reload.
1. It selects the photo, takes the snapshot `AVG calibrate before <time>`, and saves every setting.
2. **Round 1.** It writes one correction, `AVG calibrate`: a fresh copy of capture 1's linear entry, with new ids, and every slider field at its own round 1 value. The base values:
   - signed fields: 0.2, then -0.4, then 0.3;
   - exposure: 0.125, -0.25, 0.1875;
   - `LocalToningHue`, `LocalToningSaturation` and `LocalGrain`: 0.2, 0.5, 0.35.

   Field number i (0-19) gets base × (1 + 0.05 i) in rounds 1-2 and base × (1 + 0.05 (19 − i)) in round 3. So no two fields share a value, and every value stays within -1..1 (largest 0.975) [inference]. Values within 0..1 are valid whether a field is stored as a fraction or in degrees [inference].

   It reads the entry back, then runs `probe_masks_calibrate` over every candidate name. The names are `local_<X>` from the SDK reference's Version 6 list and the field-named variant, such as `local_Contrast2012`, plus `local_Amount` and `local_RefineSaturation` [unverified until this run]. Values read with another mask selected are not used.
3. **The question.** Jim clicks `AVG calibrate` in the Masks panel and says whether a slider shows the value the probe read (Contrast, if it answered non-zero).
4. **Rounds 2 and 3** work as round 1, each with a fresh copy and new ids, so a probe never reads the previous round's mask.
5. **The results table.** Per field it gives the DC name that answered, stored → panel for each round, and `scale` and `offset` from rounds 1-2. A flag marks:
   - no DC answer;
   - a constant answer;
   - a stored value Lightroom changed;
   - fewer than 2 rounds;
   - a round 3 off the line by more than 1 % of the span. Because round 3 reverses the per-field factors, a name that reads another field misses round 3. For neighbouring fields on a ×100 slider the miss is about 2.5 panel units [inference: the algebra in the script's header].

   When a name answers but stays constant, the next candidate is used. The table is saved as `calibration.json`, also when the run stops early.
6. The snapshot puts the photo back.
7. **The AI masks.** `probe_masks_create` runs for `background`, `people` and `landscape` (10 s each). A subtype counts only when its mask showed and exactly one id is new since just before its create, not claimed by an earlier subtype and not in the table before. A subtype that made no mask is never credited with the mask still selected from the one before. After a 3 s wait the check reads the table and saves each counted entry, and any unclaimed new entry, in `templates.json`.
8. **Always:** the snapshot is applied and every setting is compared with step 1. They are compared again 5 s later, in case a mask still computing changed them. Then Jim's last question.

The History names it writes are `AVG calibrate write 1` to `AVG calibrate write 3`. After Ctrl+C no further step or probe runs. The stable-wait after a failed probe and the manual fallback work as in capture 1. Closing the window also asks for the put-back, but Windows ends Node about 10 s later [handle: https://nodejs.org/api/process.html#signal-events, read 2026-10-03]. So Jim's steps say Ctrl+C.

**Dry runs** [handle: `docs\reports\phase6\masks-capture\dryrun-capture2.txt`, four runs, 2026-10-03, user folder redacted]. The template is capture 1's committed `3_dump-1.json`. The runs show only the script's flow and arithmetic, nothing about Lightroom; every scale and entry in them is invented.
1. **The sim as it is.** The writes and read-backs worked, every probe selected nothing, and every field read "no DC answer". No AI subtype was credited. `PUT BACK: YES`, also 5 s later.
2. **Invented DC answers.** Scale 4 for exposure and 100 for the others. On purpose: `local_Contrast` answered the older-process field, `LocalHue` was made non-linear, `local_Moire` read `LocalDefringe`, and `people` made no mask.
   - 18 of 20 fields came out clean.
   - `LocalHue` and the misread `LocalMoire` were flagged non-linear (round 3: 34.5 against 37.03 on the line).
   - `LocalContrast2012` fell back to `local_Contrast2012`.
   - The question asked about `+23`.
   - `background` and `landscape` were credited with their own entries. `people` was not, with "no new mask showed", although the background mask was still selected.
   - `PUT BACK: YES`.
3. **Ctrl+C before round 2.** It aborted, flagged every field "fewer than 2 rounds", and put back.
4. **A plugin build without the commands.** It stopped before any write and printed the reload instruction.

### Steps for Jim

Do these when Claude Code asks for the run. Claude Code has checked out `phase-6/masks` in the repo folder and run `npm run build` first. It takes about 5 minutes [inference: three writes, two probes, two questions].

1. Right-click the Claude icon in the Windows system tray, then click **Quit**.
2. In Lightroom Classic, open **File > Plug-in Manager**. In the list on the left, click **LrC-AVG (Autonomous Vision Gateway)**, then click **Reload Plug-in**. Click **Done**, then wait 20 seconds.
3. In the **Library** module's **Folders** panel (left side), click the `fixtures` folder, so `20260907-_OZ80099.NEF` shows in the Filmstrip.
4. In VS Code's PowerShell terminal, at `D:\Developer\LrC_Autonomous_Gateway`, run:

   ```powershell
   node logs\check-masks-calibrate-2026-10-03\check.mts
   ```

   You should see `YES  Lightroom 15.6 runs plugin 0.11.0`, `YES  the plugin knows probe_masks_calibrate`, `YES  the plugin knows probe_masks_create`, then `YES  selected 20260907-_OZ80099.NEF`.
5. When it prints `The plugin now selects the mask in Develop > Masking`, do not click in Lightroom until it asks a question.
6. It asks about one slider. In Lightroom's Develop module: if the Masks panel is not open, press **Shift+W**. In the Masks panel, click **AVG calibrate**. Look at the slider it names, then type `y` or `n` and press **Enter**.
7. It writes twice more and prints a results table. When it prints `The plugin now creates AI masks`, do not click in Lightroom until the next line (up to a minute).
8. After `--- 9_put_back` it waits 5 seconds by itself. The last lines say `PUT BACK: YES` or `NO`. Then it asks you to look at the photo and the Masks panel: if the Masks panel is not open, press **Shift+W**. Answer whether the photo looks as before (type `y` or `n`, then **Enter**). Then they say `masks capture 2: WORKED` or `DONE, n NO / FAILED lines`. A NO line is a finding, not your mistake. Tell Claude Code "done".

### If something goes wrong

- If it prints `LOCK BUSY`, Claude Desktop is still running: do step 1 again, wait 60 seconds, then do step 4 again.
- If it prints `Reload the plugin`, do step 2 again, then step 4. If it prints that line again, quit Lightroom, start it again, wait 20 seconds, then do step 4.
- If you need to stop, or the window shows no new line for 5 minutes, press **Ctrl+C** once. Do not press it again, and do not close the window. It prints `ABORTING`, puts the photo back by itself and prints `PUT BACK: YES` or `NO`. Tell Claude Code.
- If it prints `PUT BACK: NO`, wait 1 minute. Then, in Lightroom's Develop module, open the **Snapshots** panel (left side) and click the snapshot it names (it starts with `AVG calibrate before`). Tell Claude Code.

### Observed (Jim)

*Blank until Jim's run. Claude Code fills this from `check.json`, `calibration.json`, `templates.json` and `transcript.txt`.*
