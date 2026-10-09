---
report: offline — does LrC-AVG refuse a photo whose original file is missing?
phase: 8 (fix/offline-original, between rows 4 and 5)
status: template
authored_by: "Template, harness and pre-run findings: Claude Code (Opus 5.5), 2026-10-09 (fix/offline-original). Observed: Jim (blank until he runs npm run offline:check). Verdict: Jim."
date: 2026-10-09
---

# offline — does LrC-AVG refuse a photo whose original file is missing?

## Purpose

**The finding.** In spike S10 the photo `20260907-_OZ80099-Edit.tif`, whose original file is gone [stated: Jim, 2026-10-09, "seems to have disappeared"], took every write unvalidated and exported no JPEG [handle: `docs\reports\phase8\S10.md` "Consequences" item 8]. An edit on it would write values Lightroom never checked and fail at its first preview.

**The fix** (R2 in the row 3 plan [stated: Jim, 2026-10-09, "Go", R2 A]; this PR's plan [stated: Jim, 2026-10-09, "Go with recommendations. Insure that missing files are reported by the MCP and in the UX."]):
- plugin 0.19.0: `get_context` reports `available` (`photo:checkPhotoAvailability()`) and `smart_preview`; `apply_settings`, `export_preview` and `export_photo` answer `original_missing` for a missing original. Snapshots stay allowed, and so does an `apply_settings` marked `put_back` (a probe's or a pass's revert, values the photo held before), so a put-back still works (Greptile, PR #101);
- engine 0.23.0: `lr_begin_session` refuses it with `ORIGINAL_MISSING` before the snapshot. `lr_sync_series` skips it, gives its reason and syncs the rest (D2 A). `lr_export_photos` lists it under `failed`. `lr_get_active_photo_context` reports `original_missing` and gives a note to pass on to the user;
- a photo with a smart preview is refused too (D1 A);
- UX: a refused begin opens no edit, so the chat reports it: the error tells Claude to tell the user and how to reconnect the file. A file lost during an open edit is named in the step's error and on the Deck/HUD ("The photo's original file is missing: reconnect it in Lightroom (Library > Find Missing Photos).") [stated: Jim, 2026-10-09, "Chat + in-edit notes (Recommended)", "Writes + exports (Recommended)"].

**What this check answers.** Does `checkPhotoAvailability()` report the missing TIFF as missing, and the present JPG as present, on Jim's Lightroom? And does each refusal happen there? The SDK says only that it "Reports whether this photo is believed to be present on disk at this time" [handle: https://lrc.mcor.dev/modules/LrPhoto.html, read 2026-10-09].

**Rule.** PHASES.md gives this fix no go/no-go rule. Proposed [inference]: **go** when every line below reads YES; **no-go** (record, and find another signal) when `missing reported` is NO.

**How the check asks Jim:** one y/n question in PowerShell, as in the phase checks (rule 04 lets Jim choose this per check).

## Harness

| Part | Files |
|---|---|
| The check | `engine\src\devtools\offline-check.ts` (the steps), `offline-check-cli.ts` (`npm run offline:check`) |
| Tests | `engine\tests\offline-check.test.ts` (the check against the simulated plugin), `engine\tests\offline-original.test.ts` (the engine's refusals, sync, export, the HUD line) |

**What `npm run offline:check` is written to do** [handle: `engine\src\devtools\offline-check.ts` header]:
1. It checks that the plugin is 0.19.0 or later.
2. It reads `get_context` by uuid for `20260907-_OZ80099-Edit.tif` (uuid `F472C80A-31EF-47B1-8C05-6910CC7D90AA`) and for `DSC_0031.JPG` Copy 1 (`12409199-51E4-4AC3-8EE9-6DB994858630`). If the TIFF is not reported missing, the check stops there, so no edit or write reaches a photo that is there.
3. It selects the TIFF. It calls `lr_get_active_photo_context` (expects `original_missing: true`) and then `lr_begin_session` (expects `ORIGINAL_MISSING`). If a session is open anyway, the check ends it with revert, which puts the photo back, and reports FAILED (Greptile, PR #101).
4. It sends `apply_settings` by uuid, with the photo's own exposure, so a write that got through changes no value. It also sends `export_preview`. Both are expected to answer `original_missing`. It compares the photo's settings with those read before step 3.
5. It selects Jim's photo again, releases the bridge, so the command ends and Claude Desktop can connect, and asks whether Lightroom's Library menu has "Find Missing Photos", the menu path the messages name [unverified].

Results go to `%TEMP%\LrC-AVG\offline\`, and Claude Code collects them.

## Steps for Jim

1. In Lightroom: **File > Plug-in Manager**, click **LrC-AVG** in the list on the left, click **Reload Plug-in**, then **Done**.
2. In Lightroom's **Library** module (press **G**), open the **Collections** panel on the left and click the collection **fixtures**. Click any photo in it.
3. Quit Claude Desktop: right-click the Claude icon in the Windows system tray (bottom right) > **Quit**.
4. In VS Code, open PowerShell in `D:\Developer\LrC_Autonomous_Gateway` and run:

   ```powershell
   npm run offline:check
   ```

   It prints one line per photo and asks one question, ending "Type y or n, then Enter:". Open Lightroom's **Library** menu (menu bar, top) and answer. It ends with `Offline original check: WORKED` or `FAILED`, and the photo you clicked is selected again.
5. Tell Claude Code "done".
6. Start Claude Desktop again, so it runs engine 0.23.0.

### If something goes wrong

- **It says the plugin is not 0.19.0 or later:** do step 1 again, then run the command again.
- **It says Lightroom does not report the TIFF as missing:** tell Claude Code. Nothing was written to any photo.
- **It says "Lightroom is not connected":** check that Lightroom is open and step 3 was done, then run the command again.

## Pre-run findings (Claude Code)

- `npm run build`, `npm run typecheck` and `npm test` pass on this branch [handle: this PR's description].
- The check against the simulated plugin: WORKED with a missing TIFF; FAILED, with no write, session or snapshot, when the TIFF is present; FAILED with the reload advice on plugin 0.18.1 [handle: `engine\tests\offline-check.test.ts`].
- `checkPhotoAvailability`, `smartPreviewInfo` and the refusals' behaviour in Lightroom are [unverified] until the Observed section below.

## Observed (Jim)

*Blank until Jim runs the check.*

## Numbers

| Line | Result |
|---|---|
| missing reported (`available` false for the TIFF) | |
| present reported (`available` true for the JPG) | |
| context tool reports `original_missing` | |
| begin refused (`ORIGINAL_MISSING`) | |
| write refused | |
| export refused | |
| nothing written | |
| selection restored | |
| TIFF has a smart preview | |
| "Find Missing Photos" in the Library menu | |

## Verdict

*Jim's, after the run.*

## Consequences / open questions

- Still [unverified] after this check: the Deck/HUD line for a file lost during an open edit (tested against the simulated plugin only [handle: `engine\tests\offline-original.test.ts` "lost during an edit"]), and what `checkPhotoAvailability` answers for a missing original that has a smart preview.
- After the merge: vault `MCP_TOOLS.md` gets the `ORIGINAL_MISSING` code and the context fields; `LR_SDK_NOTES.md` gets the observed `checkPhotoAvailability` answer.
