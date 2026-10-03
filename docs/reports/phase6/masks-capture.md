---
report: masks-capture — how Lightroom stores and changes masks (GitHub issue #59, PR C step 1)
phase: 6
status: template
authored_by: "Template, harness, pre-run findings and open questions: Claude Code (Opus 5.5), 2026-10-03 (branch phase-6/masks). Observed: Jim (blank until his run). Verdict: Jim."
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
| The check | `logs\check-masks-capture-2026-10-03\check.mts` (gitignored, like the earlier one-off checks); its dry run `dryrun.txt` and driver `dryrun-driver.ts.txt` beside it |

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

**What the check is written to do** [handle: `check.mts` header]: steps 0-13 as listed in the Purpose. It uses the plugin's raw `get_settings` and `apply_settings`, because the params map would refuse mask keys. It finds the mask key by structure: the top-level array of objects that changed between the dump before step 2 and the dump after it. No key name is assumed for it.

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
4. **The plugin declares `LrSdkVersion = 13.0`** [handle: `plugin\LrC-AVG.lrplugin\Info.lua`], below `updateAISettings`'s 13.3. Whether Lightroom hides newer calls from such a plugin is [unverified]. If step 7 answers `feature_unavailable`, this is the first suspect [inference]. Changing the declared version is Jim's decision, not part of this step.
5. **The capture photo's uuid** is `CF12AF60-0858-4181-9562-376D16B89126`, an original (no copy name), local id 3869534 [handle: `docs\reports\phase4\P4\p4_chat_session\20260927-26ecc4.json` `target`].
6. **Dry runs** of `check.mts` against the test sim [handle: `logs\check-masks-capture-2026-10-03\dryrun.txt`, five runs, 2026-10-03; driver `dryrun-driver.ts.txt` beside it]. They show only that the script runs, skips, times out and puts back. They show nothing about Lightroom.
   - **Run 1, the sim as it is (no masks).** Step 3 reports `NO the settings hold a new array of mask entries`, steps 4, 5 and 7-10 are skipped, and step 6 writes. After the probe the selection is still the photo. `PUT BACK: YES`; one History step (`AVG capture global write`).
   - **Run 2, an invented five-entry table injected at the Enter prompt.**
     - Every mask step ran: 5 entries identified, the write-back identical, the local exposure 0.125 → 0.25 read back, the global write leaving the table unchanged.
     - The sim never computes, so step 7 waited its full 30 s (114 reads) and reported NO.
     - The copies were named `AVG new sky`, `AVG new linear` and `AVG new radial`, and the questions used those names. Both gradients' geometry read back as written; the rename and hide fields were found; the delete went from 8 to 7 entries with the others unchanged.
     - The snapshot restored everything; `PUT BACK: YES`; seven History steps.
   - **Run 3, hello reporting plugin 0.9.0.** The check stops after `hello`: no write, no snapshot.
   - **Run 4, the invented table and a Ctrl+C before step 5.** The script's dry-run hook emits readline's `SIGINT` event. It printed `ABORTING`, ran no further step, then put back (`PUT BACK: YES`, one History step). A real keyboard Ctrl+C, and the process `SIGINT` / `SIGHUP` handlers, were not exercised: the dry run has no terminal, and on Windows a signal sent to a child process ends it at once [handle: https://nodejs.org/api/process.html#signal-events]. So those stay [unverified].
   - **Run 5, the probe answering an error.** The settings held still for 5 s (5053 ms) before the snapshot was applied; `PUT BACK: YES`.
7. **Tests.** Before: 833 passed, 7 skipped (840), in 61 files. After: 840 passed, 7 skipped (847), in 62 files (`npm test`, 2026-10-03): the 5 contract tests in `bridge-masks.test.ts`, and the Lua 5.1 parse and no-utf8 checks for `Masks.lua`. `npm run build` and `npm run typecheck` pass.

## Observed (Jim)

*Blank until Jim's run. Claude Code fills this from `check.json` and `transcript.txt`, with Jim's y/n answers as recorded there.*

- hello (plugin, Lightroom version):
- Step 2, five masks made in order (y/n):
- Steps 3-13: YES/NO lines and answers:

## Numbers

| Field | Value |
|---|---|
| Mask key; entries before / after step 2 | |
| Entry labels (by strings / by order, agree?) | |
| Differing paths between two reads (ids stable?) | |
| Differing paths after the unchanged write-back | |
| Local exposure field; value stored for +0.50; panel shows +1.00 after doubling (y/n) | |
| Mask table differing after a global-only write | |
| `update_ai_settings` call_ms; sky by table computed (ms, reads) or not | |
| Geometry fields found; read back as written; where they landed (y/n) | |
| Name / active fields; panel shows rename / hide (y/n) | |
| Delete by omission: count before → after, others unchanged | |
| Mask table after the snapshot (differing paths) | |
| DC probe: steps ok / failed; createNewMask → mask visible (ms); setValue immediate / after wait kept | |
| DC probe: selectMask 1 arg / 2 args; deleteMask 1 arg / 2 args | |
| DC sky id found in the table (field name) | |
| PUT BACK (differing paths); photo as before (y/n) | |

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
