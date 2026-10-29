---
report: Issue #182 — does a preset saved from Claude Desktop (MSIX) reach Lightroom?
phase: 11 (check/preset-msix-182)
status: template
authored_by: "Template and harness: Claude Code (Opus 5.5), 2026-10-29. Observed: blank until Jim runs the check."
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

- **Verdict word (REDIRECTED / NOT REDIRECTED / IN BOTH / NOT FOUND):**
- **Folder the file was in:**
- **Claude Desktop's reply (file path from the result):**
- **Jim: the Presets panel lists the preset after a Lightroom restart (y/n):**
- **Deleted (y/n, files):**
- **Results file:**

## Verdict

- **Go / no-go / conditional (Jim):**

## Decisions for Jim

- If REDIRECTED: the fix branch — the plugin writes the preset file through a new bridge command, or an SDK preset API (issue #182 "Plan" step 2).
