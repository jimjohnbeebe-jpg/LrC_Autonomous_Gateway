---
report: Issue #180 — the user intents folder is MSIX-virtualized under Claude Desktop
phase: 9 (wip/180-intents-folder)
status: template
authored_by: "Template, harness, code and pre-run findings: Claude Code (Opus 5.5), 2026-10-18. Observed, Numbers and Verdict: Jim, still blank."
date: 2026-10-18
---

# Issue #180 — the user intents folder is MSIX-virtualized under Claude Desktop

## Purpose

**The question.** Under Claude Desktop from the Microsoft Store (MSIX), the engine's default user intents folder `%LOCALAPPDATA%\LrC-AVG\intents` was Claude's private copy, so intents saved there were invisible to File Explorer, Claude Code and OpenCode, and intents saved by those were invisible to Claude Desktop [handle: GitHub issue #180 "Summary"; `docs\reports\phase8.5\issue108\msix-intents-folder.txt:23-30`]. After this change the default is `<Documents>\LrC-AVG\intents`, where Documents is Windows' own Documents folder (it follows a OneDrive move) [stated: Jim, 2026-10-18]. Does an intent saved from Claude Desktop now land where File Explorer shows it, and does the engine report the real path and say when it runs virtualized?

**Acceptance criteria of the issue, quoted:**

1. "The same intent file is listed by the engine whether it was launched from Claude Desktop (packaged), Claude Code or OpenCode."
2. "An intent saved by `lr_save_intent` from Claude Desktop is visible in Explorer at the folder `lr_list_intents` reports."
3. "`lr_list_intents` reports the real on-disk path, and flags packaged/virtualized execution."
4. "`painted_hills_crimson_gold` loads from Claude Desktop, and the vault prompt runs as written." (Issue #180, "Related: #179": the reference workflow also needs geometric masks, so only "loads" is checked here.)

**Go rule** (PHASES.md has none for a fix; proposed [inference]): **go** when `npm run intents:check` ends with WORKED, Claude Desktop's `lr_save_intent` result names `...\Documents\LrC-AVG\intents` with `from: "default"`, and its `lr_get_intent` finds `painted_hills_crimson_gold`. **No-go** when the test intent is only inside the Claude package or in the old AppData folder. Anything else is **conditional**.

**Out of scope** [stated: Jim, 2026-10-18]: presets (`%APPDATA%\Adobe\CameraRaw\Settings`, a separate issue) and the log folders, which stay where they are; the docs say where they really are.

**How the check asks Jim:** no questions. Jim chats with Claude Desktop and runs one PowerShell command; the harness reads the disk. This is the default of `.claude\rules\04-workflow.md` "Steps for Jim" without y/n: there is nothing only Jim can observe, as the folders and the engine's tool log hold the answers.

## Harness

| What | Files |
|---|---|
| The default folder, the Documents lookup, the virtualization probe, the real-path mapping | `engine\src\intents\folder.ts` |
| The copy from the two older folders, once, with a marker | `engine\src\intents\migrate.ts`; called from `settings\folders.ts` `intentsDirMigrating()` (the library's folder in `engine\src\mcp\main.ts`) when the folder is the default |
| What the tools report (`intents_folder.real_path`, `virtualized`, `package`, `warning`; `notes`) | `engine\src\mcp\tools-intents.ts`; `settings\folders.ts` `locate()` |
| The schema v1 warning | `engine\src\intents\version.ts` |
| The check (`npm run intents:check`) | `engine\src\devtools\intents-check-cli.ts` (disk), `intents-check.ts` (judging, printing), `intents-restore.ts` (`-- --restore`: Claude Desktop's config put back) |
| Tests | `engine\tests\intents-folder.test.ts`, `intents-migrate.test.ts`, `intents-check.test.ts`, `intents-restore.test.ts`, `settings-folders-migrate.test.ts`, `settings-tools.test.ts`, `settings.test.ts`, `intents.test.ts` |

`npm run intents:check` prints the Documents intents folder; for the new folder and the two old ones (the real `%LOCALAPPDATA%\LrC-AVG\intents` and each `Packages\Claude_*` private copy) the intent ids in it; whether `painted_hills_crimson_gold.json` is in any of them; the intents of the old folders that the new one lacks; and the migration marker. It ends with WORKED (the test intent `avg_check_180.json` is in the new folder and was not copied there by the migration) or FAILED (only inside a Claude package, or only in the old AppData folder, or nowhere). It then deletes `avg_check_180.json` wherever it found it, and its line in the migration marker, and says so (a line left there would fail the next run). With `-- --restore` it also puts Claude Desktop's `lrc-avg` entry back as it was before step 1 and ends with `put back: YES` or `NO`: the entry of the newest `claude_desktop_config.json.backup-<time>` whose `lrc-avg` does not run this worktree's engine, or no entry when that backup had none, set through the same code as `desktop:install` (backup, read-back) [handle: `engine\src\devtools\intents-restore.ts`; `engine\src\setup\apply-config.ts:96-102` writes the backup before each change; `engine\tests\intents-restore.test.ts` against a temporary folder]. It does nothing (`put back: NOT NEEDED`) when the entry does not run this worktree's engine. On Jim's PC it has not run yet [unverified]. Results go to `%TEMP%\LrC-AVG\intents-check\intents_check_<time>.json`, with your user folder shown as `%USERPROFILE%`.

### Steps for Jim

The engine of the branch `wip/180-intents-folder` is in the worktree `D:\Developer\LrC_Autonomous_Gateway\.claude\worktrees\wf_abb59bb4-98c-2`. Lightroom may be open or closed.

1. In PowerShell, run:

   ```powershell
   Set-Location "D:\Developer\LrC_Autonomous_Gateway\.claude\worktrees\wf_abb59bb4-98c-2"
   npm run desktop:install
   ```

   It builds the engine and points Claude Desktop's `lrc-avg` entry at this worktree's `engine\dist\mcp\main.js`, with the tool log in this worktree's `logs\` folder [handle: `engine\src\devtools\install-desktop-config-cli.ts:31-39`; `docs\DEVELOPMENT.md:52`]. You should see a line that the entry was added or updated, with the backup it made. The last line says to run the Phase 2 check; skip that.
2. Quit Claude Desktop: right-click the Claude icon in the Windows system tray and choose **Quit**. Start Claude Desktop and open a new chat.
3. Paste this into the chat and click **Allow** when it asks to use `lr_save_intent`:

   > Use lr_save_intent to save this intent. I approve it: schema_version 2, id "avg_check_180", label "LrC-AVG check 180", category "test", brief "Temporary intent for the issue 180 folder check", priors {}, replace true. Then show me the intents_folder part of the result: path, real_path, from and virtualized.

   Claude's reply should show `path` and `real_path` ending in `Documents\LrC-AVG\intents` and `from: "default"`. I expect `virtualized: true` and a `package` named `Claude_...` for Claude Desktop from the Microsoft Store [inference: the probe is designed to find the package, and no run has been made yet].
4. In the same chat, paste this and click **Allow**:

   > Use lr_list_intents. Tell me the ids whose source is "user", and show me any notes and warnings. Then use lr_get_intent on painted_hills_crimson_gold and tell me its source and path.

5. In PowerShell, in the same folder, run:

   ```powershell
   npm run intents:check -- --restore
   ```

   It should end with `WORKED: avg_check_180.json is in C:\Users\...\Documents\LrC-AVG\intents, the intents folder in Documents.`, then `put back: YES: ...`, `Quit Claude Desktop from the tray icon and start it again.` and `Tell Claude Code "done"; the results are saved.` It has put Claude Desktop's `lrc-avg` entry back as it was before step 1, whether that was the setup's or the development entry.
6. Quit Claude Desktop from the tray icon and start it again.
7. Tell Claude Code "done". Claude Code collects the check's results file and the `lr_save_intent` and `lr_list_intents` lines of the tool log in `D:\Developer\LrC_Autonomous_Gateway\.claude\worktrees\wf_abb59bb4-98c-2\logs\`; there is nothing to copy.

### If something goes wrong

- If Claude's reply in step 3 shows `from: "page"`: in Lightroom choose File > Plug-in Manager, select LrC-AVG, clear the **Intents folder** box, click **Done**, open a new chat, and do step 3 again.
- If it shows `from: "environment"`: tell Claude Code; the entry has an `LRC_AVG_INTENTS_DIR` that wins over the default.
- If `npm run intents:check` says `FAILED` and names a folder inside `Packages\Claude_...`, or the old `AppData\Local\LrC-AVG\intents`: Claude Desktop is still running another engine. The check has put the entry back, so run step 1 again, quit Claude Desktop from the tray, start it, open a new chat, and do steps 3 to 5 again.
- If it says `FAILED: avg_check_180.json is nowhere`: the save in step 3 did not happen (no **Allow** clicked, or Claude declined). Do step 3 again, then step 5. If you quit Claude Desktop after the first step 5, do step 1 and step 2 before step 3.
- If the last lines say `put back: NO`: tell Claude Code "done"; the line names the reason, and Claude Code puts the entry back.
- If they say `put back: NOT NEEDED`: nothing to do; step 1 was not run from this folder, or step 5 was already run.
- If Claude Desktop does not list `lrc-avg` tools after step 2: quit it from the tray icon (closing the window leaves it running) and start it again.

## Pre-run findings (Claude Code)

Run by Claude Code on the dev PC (Windows 11, PowerShell 7, Node 24), 2026-10-18, before any run by Jim. User folder shown as `%USERPROFILE%`.

- **The mechanism, from Microsoft's own page.** On Windows 10 1903 and later, new files and folders under `Local`, `Local\Microsoft`, `Roaming`, `Roaming\Microsoft` and `Roaming\Microsoft\Windows\Start Menu\Programs` are redirected to a per-user, per-package private location; "In response to a file open command, the OS will open the file from the per-user, per-package location first. If that location doesn't exist, then the OS will attempt to open the file from the real AppData location"; "Write outside the package: Allowed if the user has permissions", and Documents is in none of the redirected lists [handle: https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes "Common file system operations", fetched 2026-10-18]. The same page says new AppData files are "merged at runtime to appear in the real AppData location" for the packaged app ("AppData operations on Windows 10, version 1903 and later"), which is the packaged side's view; File Explorer and PowerShell did not see them [handle: `docs\reports\phase8.5\issue108\msix-intents-folder.txt:23-30`]. The two do not contradict each other.
- **Registry.** The same page says "All writes under HKCU are copied on write to a private per-user, per-app location" and redirects no HKCU reads ("Registry"). That the engine under Claude Desktop reads the real `User Shell Folders\Personal` value is therefore [inference]; it is checked by step 3 (the reply must name the same Documents folder as `npm run intents:check`).
- **The Documents folder, from the registry.** `reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders" /v Personal` printed `Personal    REG_EXPAND_SZ    %USERPROFILE%\Documents`. `documentsFolder()` gave `C:\Users\jimbe\Documents` and `defaultUserIntentsDir({})` gave `C:\Users\jimbe\Documents\LrC-AVG\intents` [handle: Claude Code, a node script importing `engine\dist\intents\index.js`, 2026-10-18]. A Documents folder moved to OneDrive, and a path with non-ASCII characters (reg.exe prints in the console code page), are [unverified]: on this PC the value is the plain `%USERPROFILE%\Documents`. A value that cannot be read, or that names a folder that does not exist, falls back to `~\Documents`.
- **Where `painted_hills_crimson_gold` lives.** Not where issue #180 guessed. `%LOCALAPPDATA%\LrC-AVG\intents` does not exist; `Get-ChildItem "$env:USERPROFILE\Documents\LrC-AVG\intents"` printed `painted_hills_crimson_gold.json` (10/13/2026 7:19 PM, 2796 bytes), `painterly_portrait.json` and `portrait_jpeg_natural.json` (both 10/10/2026 11:05 AM). The package copy holds only the two v1 files, `painterly_portrait.json` (10/5) and `portrait_jpeg_natural.json` (10/8/2026 9:05 PM) [handle: `Get-ChildItem` of `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Local\LrC-AVG` and `%LOCALAPPDATA%\LrC-AVG`, 2026-10-18]. So Claude Desktop did not list it because its default folder was the package copy, and no merged view of a real folder was in play: whether a packaged engine sees real-folder files is [unverified] here, as there is no real intents folder to merge.
- **Unpackaged engine, new default.** The built engine's `IntentLibrary` with the default folder listed `painted_hills_crimson_gold`, `painterly_portrait`, `portrait_jpeg_natural` as user intents, with no warnings (so the two in Documents are schema v2); `locateFolder` said `virtualized: false` [handle: Claude Code, `list-probe.mjs` against `engine\dist`, 2026-10-18]. This covers criterion 1 for an unpackaged engine; the Claude Desktop side is steps 3 and 4.
- **The harness, before any save.** `npm run intents:check` printed the three places, `painted_hills_crimson_gold.json: found in C:\Users\jimbe\Documents\LrC-AVG\intents`, `Migration marker: none`, the chat prompt, `No avg_check_180.json to delete.` and `FAILED: avg_check_180.json is nowhere...`, exit code 1 [handle: Claude Code, 2026-10-18, results file `%TEMP%\LrC-AVG\intents-check\intents_check_2026-10-18T17-24-56-761Z.json`]. This run checks the harness only.
- **Nothing to migrate on this PC.** Both old locations hold only names that the Documents folder already has, so the migration copies nothing here; it writes a marker whose only line is its header, so that an intent deleted or renamed in Documents later (the two old v1 files there, say) is not copied back from an old folder [inference from the listings above and `migrate.ts` (never overwrite; the marker is written after every look at an old folder)]. The first version wrote the marker only after a copy, and a review found that it then brought a deleted file back at the next engine start [stated: the review of this branch, 2026-10-18: a script against `engine\dist\intents\migrate.js` with a temporary `LOCALAPPDATA`; start 1 copied nothing and wrote no marker, start 2, after the file was deleted from the target, copied it from the Claude package folder]. The same two starts against the fixed build: start 1 copied nothing and left `migrated-from-appdata.txt` and `old.json` in the target; start 2, after `old.json` was deleted, copied nothing and left only the marker [handle: Claude Code, 2026-10-18, a Node script with a temporary `LOCALAPPDATA` run against `engine\dist\intents\migrate.js`, output `start 1: { copied: [] } [ 'migrated-from-appdata.txt', 'old.json' ]`, `start 2: { copied: [] } [ 'migrated-from-appdata.txt' ]`]; `engine\tests\intents-migrate.test.ts` "writes the marker also when an old folder held nothing to copy" covers it. The copying itself is covered by the tests only.
- **Gates**, 2026-10-18, in the worktree: `npm run build` and `npm run typecheck` printed no errors; `npm run arch:check` printed "no dependency violations found (292 modules, 1532 dependencies cruised)" and "68 known violations ignored" (the baseline file is unchanged; no Module Map edge was added); `npm test` passed 141 files, 1597 tests, 9 skipped. A first `npm test`, run while the other gates ran, failed one test, `bridge-client.test.ts` "reads a response split mid-character..." (`no response within 300 ms`); that file passes alone (19 of 19) and the second full run passed, so it was a timing flake under load [inference]. After the review fixes (marker after every look, `--restore`, the probe cleanup, `intentsDirMigrating`), the same four gates in the worktree: `npm run build`, `npm run typecheck` (engine exit 0) printed no errors; `npm run arch:check` printed "no dependency violations found (293 modules, 1539 dependencies cruised)" and "68 known violations ignored"; `npm test` passed 143 files, 1609 tests, 9 skipped [handle: Claude Code, 2026-10-18]. `intents:check -- --restore` was also run against a temporary `LOCALAPPDATA`, `TEMP` and `LRC_AVG_INTENTS_DIR`, never Jim's folders or config: run 1 deleted the test file and its marker line, printed FAILED (the marker had named it), then `put back: YES` from the backup; run 2 printed WORKED and `put back: NOT NEEDED`, exit codes 1 and 0 [handle: Claude Code, 2026-10-18, a Node script in the session scratchpad driving `engine\dist\devtools\intents-check-cli.js`].

### Audit: paths the plugin and the engine both use

"Under AppData" is the redirect risk for a packaged engine (Claude Desktop from the Microsoft Store) when the engine *creates* files there. A file that already exists in the real folder is opened from there [handle: the Microsoft page above].

| Path | Written by | Read by | Under AppData | Split? | Handle |
|---|---|---|---|---|---|
| User intents folder, now `<Documents>\LrC-AVG\intents` (was `%LOCALAPPDATA%\LrC-AVG\intents`) | the engine (`lr_save_intent`), people, other clients | the engine, people | no (was yes) | was split (observed); fixed by this change | `engine\src\intents\folder.ts`; `msix-intents-folder.txt:23-30`; listings above |
| Settings page values (intents and log folder, mode, ports, ...) | the plugin, in Lightroom's preferences | the engine, over the bridge (`get_prefs`) | no file | no | `plugin\LrC-AVG.lrplugin\Prefs.lua:42`; `engine\src\settings\read.ts` |
| `%USERPROFILE%\.lrc-avg\bridge_token`, `bridge_ports.json` | the plugin | the engine | no (profile root) | not by the Microsoft page [inference]; the bridge connected from Claude Desktop in the Phase 2 chat | `plugin\LrC-AVG.lrplugin\Endpoint.lua:2-8, 22`; `engine\src\bridge\endpoint.ts:34-42`; `docs\reports\phase2\PHASE2.md:179, 201` |
| `%USERPROFILE%\.lrc-avg\hud_endpoint.json` | the engine that holds the bridge lock | the Deck (a normal process) | no | not by the page [inference]; the Deck with Claude Desktop's engine [unverified] in this report | `engine\src\hud\channel.ts:31, 142-145`; `docs\reports\phase7\PHASE7.md:73-74` (chats C1, C2) |
| `%USERPROFILE%\.lrc-avg\log_folders.json` | the engine | the engine | no | no | `engine\src\settings\log-folders.ts:19` |
| `%LOCALAPPDATA%\LrC-AVG\last-start.json` | the engine | the plugin (Status), `phase9-local` | yes | yes, and handled: the plugin and the check read the real file and each `Packages\Claude_*` copy; seen in the package on this PC (10/18/2026 8:49 AM), none in the real folder | `engine\src\log\last-start.ts`; `plugin\LrC-AVG.lrplugin\MenuStatus.lua:66-85`; `engine\src\devtools\phase9-local-checks.ts:112-117`; listing above |
| `%LOCALAPPDATA%\LrC-AVG\logs` (tool log, session logs, recipes) | the engine | people, the engine (`lr_get_session_log`) | yes | yes for Claude Desktop (observed: `...\Claude_pzs8sxrjxfjjc\LocalCache\Local\LrC-AVG\logs\engine-20261017.jsonl`), unless `LRC_AVG_LOG_DIR` or the page's Log folder is outside AppData. Out of scope [stated: Jim, 2026-10-18]; README now says so. (The issue's "Logs ... appear unaffected" holds for the dev entry, which sets `LRC_AVG_LOG_DIR` to the repo's `logs\`.) | listing above; `engine\src\log\tool-log.ts:13-18`; `engine\src\devtools\install-desktop-config-cli.ts:31` |
| `%LOCALAPPDATA%\LrC-AVG\setup-result.json`, `.txt` | the setup (`setup-cli --installer`, a normal process) | the plugin (Status), the NSIS installer | yes | no: no packaged process writes it | `engine\src\setup\setup-cli.ts:8`; `plugin\LrC-AVG.lrplugin\MenuStatus.lua` `entryLines` |
| `%LOCALAPPDATA%\LrC-AVG\status.txt`, `hud\window.json` | the plugin (Status), the Deck | people | yes | no: no engine writes them | `plugin\LrC-AVG.lrplugin\MenuStatus.lua:6`; listing above |
| `%TEMP%\LrC-AVG\previews` (`%TEMP%` is `%LOCALAPPDATA%\Temp`) | the plugin (JPEG thumbnails) | the engine, which also deletes them | yes | not for reading and deleting files that exist in the real folder: the engine creates none there (`readFileSync`, `rmSync`, `unlinkSync` only); the Phase 2 chat looked at a preview | `plugin\LrC-AVG.lrplugin\Preview.lua:33`; `engine\src\preview\service.ts:21, 113, 198`; `docs\reports\phase2\PHASE2.md:179, 201` |
| `%TEMP%\LrC-AVG\exports` | the plugin (`lr_export_photos`) | the engine, which moves the files out | yes | as previews; the move with Claude Desktop's engine is [unverified] | `plugin\LrC-AVG.lrplugin\Transfer.lua:67`; `engine\src\library\files.ts:26, 61, 195` |
| `%TEMP%\LrC-AVG\bridge.log`, `bridge_status.json` | the plugin | the plugin (Status), the checks | yes | no engine involved | `plugin\LrC-AVG.lrplugin\Log.lua:2, 20` |
| `%APPDATA%\Adobe\CameraRaw\Settings` (presets) | the engine (`lr_create_preset_from_active`, `writeFileSync` with `wx`) | Lightroom | yes (Roaming) | probably yes for Claude Desktop [inference: Roaming is in the Microsoft page's list]. Separate issue [stated: Jim, 2026-10-18] | `engine\src\presets\folder.ts:21, 105` |
| Claude Desktop's `claude_desktop_config.json` | the setup (a normal process) | Claude Desktop | yes (its own location) | handled: the setup finds the Store build's copy | `engine\src\setup\desktop-config.ts:78-107` |
| `%APPDATA%\Adobe\Lightroom\Modules\LrC-AVG.lrplugin` | the setup | Lightroom | yes | no: no packaged process writes it | `hud\src-tauri\windows\hooks.nsh:105-125` |

## Observed (Jim)

*(blank: filled by Jim, or collected by Claude Code from the saved results, with the files named)*

- Step 1 output (entry added or updated):
- Claude Desktop's reply to step 3 (`path`, `real_path`, `from`, `virtualized`, `package`):
- Claude Desktop's reply to step 4 (user intent ids, notes, warnings, `painted_hills_crimson_gold` source and path):
- `npm run intents:check` headline and results file:
- Step 6 (which switch back, and that Claude Desktop lists `lrc-avg` again):

## Numbers

| Field | Value |
|---|---|
| Documents intents folder the check printed | |
| `avg_check_180.json` in it (WORKED/FAILED) | |
| `lr_save_intent`: `path` / `real_path` / `from` | |
| `virtualized` / `package` as Claude Desktop reported | |
| `painted_hills_crimson_gold` listed from Claude Desktop (source, path) | |
| `notes` or `warnings` in the `lr_list_intents` result | |

## Verdict

*(Jim decides: go / conditional / no-go.)* A script's suggestion, labelled as one, appears only as the harness headline (WORKED/FAILED) above.

## Consequences / open questions

- **Decided, not asked again:** Documents is the default [stated: Jim, 2026-10-18]. The environment variable and the page value still win over it; presets and logs are out of scope.
- **The uninstaller is unchanged.** `hooks.nsh:148-175` removes `%LOCALAPPDATA%\LrC-AVG\intents` and the package copy when "Delete the application data" is ticked; it names nothing in Documents, so the intents in Documents stay [handle: `hud\src-tauri\windows\hooks.nsh:148-175`]. The README says so.
- **The migration runs once, from the engine, only for the default folder.** It copies `*.json` files the new folder lacks from the real folder, then from each `Packages\Claude_*` private copy (the first folder wins a name both hold); never overwrites; never deletes; writes `migrated-from-appdata.txt` in the new folder after every look at an old folder that exists, also when it copied nothing (the file then holds its header only), and not when the copy stopped on an error. While that marker exists it copies nothing more, so an intent deleted or renamed in the new folder is not copied back from an old one. If a packaged engine could not see the real old folder, its marker would block a second look from an unpackaged engine until the marker is deleted [unverified: the Microsoft page says the packaged side sees a merged view]; `intents:check` lists any old intents the new folder lacks.
- **Before the first read of the settings page** (Lightroom closed) the engine uses the default folder even if the page names another one, so the copy can land in the Documents folder of a user who then works in the page's folder; the copy is harmless there (it never overwrites or deletes) and was kept so that the default list is complete while Lightroom is closed [inference from `engine\src\settings\folders.ts` `update`/`intents()`; `engine\tests\settings-tools.test.ts` "use the default folder before any page read"].
- **A page value or `LRC_AVG_INTENTS_DIR` under AppData still splits** for a packaged engine; the tools now say so (`intents_folder.warning`) with the real path. Whether Claude passes the warning on to the user is the model's choice.
- **Still [unverified]:** the real value of `Personal` for a OneDrive-moved or non-ASCII Documents folder; that a packaged engine reads the real registry value; the tool results from Claude Desktop (the steps above).
- **Docs to change after Jim's run (vault, outside the repo):** LR_SDK_NOTES "Under Claude Desktop from the Microsoft Store (MSIX)" (line 312 there) still says the default is the redirected folder and that the change is deferred to Phase 9; it needs this report's result.
