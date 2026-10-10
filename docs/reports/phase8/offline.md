---
report: offline — does LrC-AVG refuse a photo whose original file is missing?
phase: 8 (fix/offline-original and fix/offline-file-exists, between rows 4 and 5)
status: template
authored_by: "Template, harness, pre-run findings, the first three runs written up from their files: Claude Code (Opus 5.5), 2026-10-09 (fix/offline-original, fix/offline-file-exists). Observed: Jim ran npm run offline:check three times on 2026-10-09 and reported the menu item; the re-run is blank until he runs it. Verdict: Jim."
date: 2026-10-09
---

# offline — does LrC-AVG refuse a photo whose original file is missing?

## Purpose

**The finding.** In spike S10 the photo `20260907-_OZ80099-Edit.tif`, whose original file is gone [stated: Jim, 2026-10-09, "seems to have disappeared"], took every write unvalidated and exported no JPEG [handle: `docs\reports\phase8\S10.md` "Consequences" item 8]. An edit on it would write values Lightroom never checked and fail at its first preview.

**The fix** (R2 in the row 3 plan [stated: Jim, 2026-10-09, "Go", R2 A]; PR #101's plan [stated: Jim, 2026-10-09, "Go with recommendations. Insure that missing files are reported by the MCP and in the UX."]):
- plugin 0.19.0 (PR #101):
  - `get_context` reports `available` and `smart_preview`.
  - `apply_settings`, `export_preview` and `export_photo` answer `original_missing` for a missing original.
  - Snapshots stay allowed, and so does an `apply_settings` marked `put_back` (a probe's or a pass's revert, values the photo held before), so a put-back still works.
- plugin 0.19.1 (fix/offline-file-exists, after runs 1-3):
  - `available` is false when either signal says so: `photo:checkPhotoAvailability()`, or the file on disk (`LrFileUtils.exists` on the photo's path). The SDK signal alone was stale once (run 1, below).
  - `get_context` adds both signals, `sdk_available` and `file_exists`.
- engine 0.23.0 (PR #101):
  - `lr_begin_session` refuses the photo with `ORIGINAL_MISSING` before the snapshot.
  - `lr_sync_series` skips it, gives its reason and syncs the rest (D2 A).
  - `lr_export_photos` lists it under `failed`.
  - `lr_get_active_photo_context` reports `original_missing` and gives a note to pass on to the user.
- engine 0.23.1: the messages name the menu item Jim saw.
- A photo with a smart preview is refused too (D1 A).
- **UX:**
  - A refused begin opens no edit, so the chat reports it: the error tells Claude to tell the user, and how to reconnect the file.
  - A file lost during an open edit is named in the step's error and on the Deck/HUD: "The photo's original file is missing: reconnect it in Lightroom (Library > Find All Missing Photos)." [stated: Jim, 2026-10-09, "Chat + in-edit notes (Recommended)", "Writes + exports (Recommended)"].

**What this check answers.** Does LrC-AVG report the missing TIFF as missing and the present JPG as present, on Jim's Lightroom? And does each refusal happen there? The SDK says only that `checkPhotoAvailability` "Reports whether this photo is believed to be present on disk at this time" [handle: https://lrc.mcor.dev/modules/LrPhoto.html, read 2026-10-09].

**Rule.** PHASES.md gives this fix no go/no-go rule. Proposed [inference]:
- **go** when every line below reads YES;
- **no-go** (record, and find another signal) when `missing reported` is NO.

**How the check asks Jim:** runs 1-3 asked one y/n question about the Library menu. Jim found it ambiguous [stated: Jim, 2026-10-09, "the question was ambigous"], and his answer is recorded below. The re-run asks nothing; it waits for Enter only when Jim has to click the TIFF himself (rule 04 lets Jim choose this per check).

## Harness

| Part | Files |
|---|---|
| The check | `engine\src\devtools\offline-check.ts` (the steps), `offline-check-cli.ts` (`npm run offline:check`) |
| Tests | `engine\tests\offline-check.test.ts` (the check against the simulated plugin), `engine\tests\offline-original.test.ts` (the engine's refusals, sync, export, the HUD line) |
| Runs 1-3 | `docs\reports\phase8\offline\offline_check_*.json` (the check's own result files), `bridge_log_excerpts.txt` (the plugin log lines of the three runs) |

**What `npm run offline:check` is written to do** [handle: `engine\src\devtools\offline-check.ts` header]:
1. It checks that the plugin is 0.19.1 or later.
2. It reads `get_context` by uuid for `20260907-_OZ80099-Edit.tif` (uuid `F472C80A-31EF-47B1-8C05-6910CC7D90AA`) and for `DSC_0031.JPG` Copy 1 (`12409199-51E4-4AC3-8EE9-6DB994858630`). If the TIFF is not reported missing, the check stops there, so no edit or write reaches a photo that is there.
3. It selects the TIFF. If Lightroom does not select it, it asks Jim to click it and press Enter, then checks that the TIFF alone is selected. It calls `lr_get_active_photo_context` (expects `original_missing: true`) and then `lr_begin_session` (expects `ORIGINAL_MISSING`). If a session is open anyway, the check ends it with revert, which puts the photo back, and reports FAILED (Greptile, PR #101).
4. It sends `apply_settings` by uuid, with the photo's own exposure, so a write that got through changes no value. It also sends `export_preview`. Both are expected to answer `original_missing`. It compares the photo's settings with those read before step 3.
5. It selects Jim's photo again and releases the bridge, so the command ends and Claude Desktop can connect.

Results go to `%TEMP%\LrC-AVG\offline\`, and Claude Code collects them.

## Steps for Jim (the re-run, after fix/offline-file-exists is merged)

1. In Lightroom: **File > Plug-in Manager**, click **LrC-AVG** in the list on the left, click **Reload Plug-in**, then **Done**.
2. In Lightroom's **Library** module (press **G**), open the **Collections** panel on the left and click the collection **fixtures**. Click any photo in it.
3. Quit Claude Desktop: right-click the Claude icon in the Windows system tray (bottom right) > **Quit**.
4. In VS Code, open PowerShell in `D:\Developer\LrC_Autonomous_Gateway` and run:

   ```powershell
   npm run offline:check
   ```

   It prints one line per photo. If it then says "Lightroom did not select 20260907-_OZ80099-Edit.tif", click that photo (only that one) in the **fixtures** collection and press **Enter** in PowerShell. It ends with `Offline original check: WORKED` or `FAILED`, and the photo you clicked in step 2 is selected again.
5. Tell Claude Code "done".
6. Start Claude Desktop again, so it runs engine 0.23.1.

### If something goes wrong

- **It says the plugin is not 0.19.1 or later:** do step 1 again, then run the command again.
- **It says Lightroom does not report the TIFF as missing:** tell Claude Code. Nothing was written to any photo.
- **It says the selection is not the TIFF alone:** run the command again and click only the TIFF when asked.
- **It says "Lightroom is not connected":** check that Lightroom is open and step 3 was done, then run the command again.

## Pre-run findings (Claude Code)

- `npm run build`, `npm run typecheck` and `npm test` pass on each branch [handle: the PR descriptions of #101 and fix/offline-file-exists].
- The check against the simulated plugin:
  - WORKED with a missing TIFF;
  - FAILED, with no write, session or snapshot, when the TIFF is present;
  - WORKED after Jim's click when Lightroom does not select the TIFF;
  - stops when the click left another photo selected;
  - FAILED with the reload advice on plugin 0.19.0
  [handle: `engine\tests\offline-check.test.ts`].
- The plugin's two-signal rule (`Photos.lua available`) has no Lua test here: it is [unverified] until the re-run.
- The TIFF is not on disk [handle: `Test-Path "D:\Developer\LrC_Autonomous_Gateway\fixtures\S10\20260907-_OZ80099-Edit.tif"` printed `False`, 2026-10-09; that is the path `get_context` gave in runs 1-3].

## Observed (Jim)

**Runs 1-3, 2026-10-09, 20:53-20:55 local, plugin 0.19.0, engine 0.23.0** [handle: `docs\reports\phase8\offline\offline_check_2026-10-10T03-53-44-109Z.json`, `…03-54-30-473Z.json`, `…03-54-46-032Z.json`; `bridge_log_excerpts.txt`]:

| Run | TIFF `available` | JPG `available` | What happened | Menu answer |
|---|---|---|---|---|
| 1 (03:53:44Z) | **true** | true | Stopped: "Lightroom does not report 20260907-_OZ80099-Edit.tif as missing, so nothing was tried on it." | y |
| 2 (03:54:30Z) | false | true | `select_photo` failed: "Lightroom did not select photo 4028328 (active photo nil, 20 selected)" | n |
| 3 (03:54:46Z) | false | true | the same `select_photo` failure | y |

- **Smart previews:** the TIFF has none (`smart_preview` false in all three runs); the JPG has one (true).
- **Nothing reached the TIFF:** no `apply_settings` or `export_preview` was sent in any run [handle: `bridge_log_excerpts.txt`, only get_context, get_selection and select_photo lines].
- **Selection:** Jim's selection was put back in each run (`selection_restored` true).
- **The menu item:** "There is a menu item under Library that says 'Find all missing photos,' but not a 'Find Missing Photos.'" [stated: Jim, 2026-10-09]. Jim ran the check several times because the question was ambiguous, so the three y/n answers are not used.

**Re-run:** *blank until Jim runs it.*

## Numbers

| Line | Runs 1-3 | Re-run |
|---|---|---|
| missing reported (`available` false for the TIFF) | NO, then YES, YES | |
| present reported (`available` true for the JPG) | YES ×3 | |
| context tool reports `original_missing` | not run | |
| begin refused (`ORIGINAL_MISSING`) | not run | |
| write refused | not run | |
| export refused | not run | |
| nothing written | not run (nothing was sent) | |
| selection restored | YES ×3 | |
| TIFF has a smart preview | no | |
| the Library menu item | "Find all missing photos" [stated] | — |

## Analysis (Claude Code)

- **The SDK signal was stale on first touch.** `checkPhotoAvailability()` said true for a file not on disk, then false 46 s later [handle: runs 1-2 `contexts.missing.available`]. Why it changed is [unverified]: one guess is that run 1's own read made Lightroom look again [inference]. A begin on the first touch could have passed the check. Plugin 0.19.1 adds the file-on-disk signal.
- **`select_photo` did not select the TIFF.** Lightroom answered "active photo nil, 20 selected" after `setSelectedPhotos`. Spike S10 had selected this photo in the "fixtures" collection [handle: `docs\reports\phase8\S10.md` "Observed", run 2 writes on it]. Why it failed now is [unverified]: the photo may have been outside the current view. The re-run lets Jim click it.

## Verdict

*Jim's, after the re-run.*

## Consequences / open questions

- Still [unverified] after the re-run:
  - the Deck/HUD line for a file lost during an open edit (tested against the simulated plugin only [handle: `engine\tests\offline-original.test.ts` "lost during an edit"]);
  - what either signal says for a missing original that has a smart preview;
  - `LrFileUtils.exists` on a disconnected network drive (how long it takes).
- After the re-run: vault `MCP_TOOLS.md` gets the `ORIGINAL_MISSING` code and the context fields; `LR_SDK_NOTES.md` gets the stale first answer and the two-signal rule.
