---
report: Issue #182 — does a preset saved from Claude Desktop (MSIX) reach Lightroom?
phase: 11 (check/preset-msix-182)
status: observed
authored_by: "Template and harness: Claude Code (Opus 5.5), 2026-10-29. Observed: Claude Code from the results files, 2026-10-29; the run, the Claude Desktop chat and the y/n answers are Jim's. Verdict: from the session brief, for Jim to confirm."
date: 2026-10-29
---

# Issue #182 — does a preset saved from Claude Desktop (MSIX) reach Lightroom?

## Purpose

**The question.** `lr_create_preset_from_active` writes `<name>.xmp` into `%APPDATA%\Adobe\CameraRaw\Settings` [handle: `engine\src\presets\folder.ts:18-23`]. New files a packaged (MSIX) app creates under `AppData\Roaming` go to `%LOCALAPPDATA%\Packages\<package>\LocalCache\Roaming` [handle: https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes, "Common file system operations"], as observed for `AppData\Local` and the intents folder [handle: `docs\reports\phase8.5\issue108\msix-intents-folder.txt:23-30`; issue #180]. Is the preset file that Claude Desktop's engine saves redirected into the Claude package, so that Lightroom (not packaged) never lists it? Every earlier preset check ran with Claude Desktop quit [handle: `docs\reports\phase8\presets-rendered.md:29`], so this is untested [unverified].

**Plan** [stated: Jim, 2026-10-18, issue #182 "Plan"]: test first; a fix (the plugin writes the file, or an SDK preset API) is a separate branch. This branch holds no fix.

**Go rule** (proposed [inference]): the check ends WORKED with NOT REDIRECTED and Jim answers y to the panel question: no fix needed. REDIRECTED with n: the issue is confirmed and the fix branch starts. Any other combination (IN BOTH; REDIRECTED with y; NOT REDIRECTED with n): stop and ask Jim.

**How the check asks Jim:** in the PowerShell window running it, y/n (`.claude\rules\04-workflow.md` "Steps for Jim", the choice Jim made for the Phase 1 check). The one paste is the printed prompt into a Claude Desktop chat: only Claude Desktop's own engine runs inside the package [inference: an engine started from PowerShell is not packaged, so it would not show the redirection].

## Harness

| What | Files |
|---|---|
| The name, the prompt, the folders, the verdict | `engine\src\devtools\presets-msix.ts` |
| The check (`npm run presets:msix`) | `engine\src\devtools\presets-msix-cli.ts` |
| Tests | `engine\tests\presets-msix.test.ts` |

`npm run presets:msix` first reads Claude Desktop's config and stops (FAILED, nothing written) when its `lrc-avg` entry does not run this folder's `engine\dist\mcp\main.js`. It never changes that config. It prints a new preset name, `AVG msix check <6 hex>`, and the sentence to paste into a new Claude Desktop chat, then waits for Jim's y. It looks for a preset of that name (by `crs:Name`, `presets\folder.ts` `findPresetFiles`) in `%APPDATA%\Adobe\CameraRaw\Settings` and in each `%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Adobe\CameraRaw\Settings`, prints each folder with its count, and one of **REDIRECTED** (only in a package), **NOT REDIRECTED** (only in Lightroom's folder), **IN BOTH**, **NOT FOUND**. When found, it asks Jim to restart Lightroom (Lightroom lists a new preset file only after a restart [handle: `docs\reports\phase4\S7.md` Verdict 1]) and whether Develop's Presets panel lists the preset, then whether to delete the file(s) it found. It ends with `Preset MSIX check: WORKED` (found, and Jim answered the panel question) or `FAILED`, then the verdict word. Results: `%TEMP%\LrC-AVG\presets-msix\presets_msix_<time>.json`, user folder shown as `%USERPROFILE%`.

## Observed

Filled by Claude Code from the results files, 2026-10-29; the y/n answers in them are Jim's. Times are UTC (Jim's local time is UTC-7).

- **First try, 11:28:16: FAILED, nothing written.** Claude Desktop's `lrc-avg` entry ran another folder's engine (a `.claude\worktrees\...` checkout), so the check stopped before printing a prompt; "put back: NOT NEEDED" [handle: `docs\reports\phase11\PRESET-MSIX\run1\presets_msix_2026-10-29T11-28-16-677Z.json`, `desktop_entry_runs_this_engine` "no", `put_back`]. The second run found the entry running this folder's engine [handle: the 11:51 file, `desktop_entry_runs_this_engine` "yes"]; how the entry was changed between is not in the files (the check never changes it).
- **Verdict word (REDIRECTED / NOT REDIRECTED / IN BOTH / NOT FOUND):** **NOT REDIRECTED** (11:51:41 run) [handle: `docs\reports\phase11\PRESET-MSIX\run1\presets_msix_2026-10-29T11-51-41-938Z.json`, `where`].
- **Folder the file was in:** `%USERPROFILE%\AppData\Roaming\Adobe\CameraRaw\Settings\AVG msix check b8fcac.xmp`, Lightroom's own preset folder. The package folder `%USERPROFILE%\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Adobe\CameraRaw\Settings` did not exist [handle: the same file, `places`, `detail`].
- **Claude Desktop's reply (file path from the result):** not recorded; the check records Jim's y that the preset was saved (`saved_answer` "y"), not the chat's text [handle: the same file].
- **Jim: the Presets panel lists the preset after a Lightroom restart (y/n):** **y** [handle: the same file, `listed_in_lightroom`].
- **Deleted (y/n, files):** **y**, the one file above [handle: the same file, `delete_answer`, `deleted`].
- **Results file:** `docs\reports\phase11\PRESET-MSIX\run1\presets_msix_2026-10-29T11-51-41-938Z.json`, headline **WORKED**.

## Verdict

- **Go / no-go / conditional (Jim):** **go, no fix needed**, on this report's go rule (WORKED, NOT REDIRECTED, panel y). A preset that Claude Desktop's engine saves lands in `%APPDATA%\Adobe\CameraRaw\Settings`, not in the Claude package, and Lightroom lists it after a restart: issue #182's suspected bug does not happen on this machine [handle: `PRESET-MSIX\run1\presets_msix_2026-10-29T11-51-41-938Z.json`]. [The verdict as given in the session brief of 2026-10-29; Jim confirms it on review of the PR.]
- Why the preset file was not redirected while the intents folder was (issue #180) is [unverified], and so is whether it matters that Lightroom's own folder already existed. One machine, one Claude Desktop version (not recorded in the file).

## Decisions for Jim

- If REDIRECTED: the fix branch — the plugin writes the preset file through a new bridge command, or an SDK preset API (issue #182 "Plan" step 2). **Not needed: the run said NOT REDIRECTED.**
- Whether to close issue #182 with this report as its evidence. It stays open until Jim says so.
