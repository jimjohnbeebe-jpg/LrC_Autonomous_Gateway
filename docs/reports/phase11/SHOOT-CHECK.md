---
report: SHOOT-CHECK
phase: "11"
status: template
authored_by: "Claude Code (Opus 5.5): purpose, harness, pre-run findings, steps, 2026-10-29. Observed, Numbers and Verdict: blank, for Jim's run."
date: 2026-10-29
---

# SHOOT-CHECK: cull, keyword and batch a shoot in Claude Desktop (issues #111, #112, #110)

## Purpose

Issues #111 (cull a shoot), #112 (keyword a shoot) and #110 (batch-edit a shoot) are built from tools that exist, plus `lr_get_contact_sheet` and the three MCP prompts `lrc-avg-cull`, `lrc-avg-keyword` and `lrc-avg-batch` (branch `phase-11/contact-sheet`) [stated: Jim, 2026-10-29, "Go on all.", the plan for issues #111, #112 and #110 with its recommendations]. This check answers, on one real shoot in Claude Desktop:

1. Can Claude cull about 48 photos from contact sheets, show its proposal, wait for a yes, and flag them?
2. Can it keyword them and write titles and captions the same way?
3. Does every flag, keyword and text field go back to its value before the chat when asked (put back)?
4. Can it sync an accepted hero edit onto 20 photos of the same scene with `lr_sync_series`, show them on a sheet, and undo single photos from their "AVG pre-sync" snapshots?

The dry run before a write is the chat's job, not an engine flag (decision D2 of the plan, option (a)): the prompts make Claude show a table and the `lr_get_metadata` before values and wait for the yes. The check verifies what the tool log can show (every photo was on a sheet and read with `lr_get_metadata` before its first write) and asks Jim the rest.

How the answer reads (an inference, not a PHASES.md rule; the verdict is Jim's): **go** when the check says `Shoot check: WORKED` and `put back: YES`. Issue #111 and #112 close on this run with stacks refused (decision D3, option (a): the SDK stacks only at import [handle: `docs\reports\phase8.5\S11.md` "Consequences"]); #110 closes on it with a new issue for unattended per-photo converge sessions (decision D1, option (a)). Jim says when each issue closes.

**How the check asks Jim:** y/n in the PowerShell window running it (`.claude\rules\04-workflow.md` "Steps for Jim", the method Jim chose for the Phase 1 check and allowed for any check), chosen for this check by Claude Code on 2026-10-29 under Jim's "Go on all." [stated]. The chat itself is typed in Claude Desktop: only Claude Desktop's own engine can show what a Claude Desktop chat does [inference].

## Harness

| What | Files |
|---|---|
| What the tool log shows, the verdict, the questions | `engine\src\devtools\shoot-check.ts` |
| The check (`npm run shoot:check`) | `engine\src\devtools\shoot-check-cli.ts` |
| Tests (fixture tool-log records, no Lightroom) | `engine\tests\shoot-check.test.ts` |
| Each write's per-photo before and after in the tool log (`writes`) | `engine\src\mcp\tools-catalog.ts` `written` |

`npm run shoot:check` starts no engine and sends nothing to Lightroom, so it never competes with Claude Desktop's engine for the bridge (issue #211, `ENGINE_BUSY`). It reads Claude Desktop's config and stops (FAILED, nothing written) when the `lrc-avg` entry does not run this folder's `engine\dist\mcp\main.js` or sets `LRC_AVG_TOOLS` to a profile other than `full` (the `edit` profile hides the catalog tools, `engine\src\mcp\profiles.ts`). It prints the chat's steps and waits for Enter. Then it reads the tool log Claude Desktop's engine wrote since the check started (the folder is the entry's `LRC_AVG_LOG_DIR`, else `%LOCALAPPDATA%\LrC-AVG\logs`, `engine\src\log\tool-log.ts` `defaultLogDir`), with `phase2-collect.ts` `collectChatLogs`, which also saves excerpts of that log and of Claude Desktop's MCP log.

From the records it counts:

- `lr_get_contact_sheet` calls and cells (each call's `args.uuids`, less its `not_yet` when the log has one) and the fast-preview fallbacks when the log names them;
- the writes `lr_set_flag`, `lr_set_ai_metadata`, `lr_set_keywords` and `lr_set_iptc`, photo by photo, from each call's logged `writes` (before and after). A photo is **put back** when its last `after` equals its first `before`: the whole flag and keyword list (in any order), and for IPTC and AI metadata the fields the calls named ("" and none count the same). A photo whose last read-back failed counts as not put back. So does the photo a call stopped at when Lightroom stopped answering (`maybe_written`). The photos written before that stop come from the error's `details.written`;
- any photo whose first write came with no `lr_get_contact_sheet` naming it before, or no `lr_get_metadata` that read it (the call's uuids less its logged `failed_uuids`);
- `lr_sync_series` calls, and `lr_apply_snapshot` calls after the first of them (at least 2: the undo of two photos).

Then it asks seven y/n questions (the first is recorded, not judged: whether Claude Desktop's + menu lists MCP prompts is [unverified], `engine\src\mcp\prompts.ts:4`), prints one OK / NO line per condition, `Shoot check: WORKED` or `FAILED`, and `put back: YES` / `NO`. Results: `%TEMP%\LrC-AVG\shoot-check\shoot_check_<time>.json`, with `shoot_chat_tool_log_<time>.jsonl` and `shoot_desktop_mcp_log_<time>.txt`, user folder shown as `%USERPROFILE%`.

## Pre-run findings (Claude Code)

- The verdict on fixture records: a full cull + keyword + put-back + batch chain is WORKED with put back YES; a missing put-back is put back NO with the photo named; a write with no sheet or no `lr_get_metadata` before it is FAILED; a failed read-back counts as not put back; no batch undo is FAILED [handle: `cd engine; npx vitest run tests/shoot-check.test.ts`, 6 passed, 2026-10-29].
- Before this branch the tool log kept only `changed` and `failed` counts of a write [handle: `engine\src\mcp\tools-catalog.ts` `written`, as on `origin/main` 40a6800], so it could not show a put-back; the branch adds `writes`.
- What `lr_get_contact_sheet` logs beyond its arguments depends on the `phase-11/contact-sheet` branch: the check reads a `cells` array (`fast_fallback` per cell) or a `fallbacks` number, and `not_yet`; when neither is logged it says "fallbacks not in the log" and judges nothing on it [inference].

## Steps for Jim

Run these after both PRs (`phase-11/contact-sheet` and `phase-11/shoot-check`) are merged into `main`.

1. In PowerShell:
   ```powershell
   cd D:\Developer\LrC_Autonomous_Gateway
   git switch main; git pull
   npm run build
   npm run desktop:install
   ```
2. Quit Claude Desktop from its tray icon (right-click > Quit), then start it again from the Start menu.
3. Open Lightroom Classic in the Library module, with the LrC-AVG plugin 1.5.0 or later enabled (File > Plug-in Manager shows the version).
4. In the same PowerShell window:
   ```powershell
   npm run shoot:check
   ```
5. Do the steps it prints in Lightroom and Claude Desktop, in order: the cull, the keywords, the put-back, the batch. Say yes to Claude's tables when they look right.
6. Come back to the PowerShell window, press Enter, and answer its y/n questions.
7. Tell Claude Code "done".

### If something goes wrong

- If the check says `Stopped: Claude Desktop's "lrc-avg" entry does not run ...` or `has LRC_AVG_TOOLS=...`: run step 1's `npm run desktop:install` again, then steps 2 and 4.
- If the check says `Tool log: NOT found`: tell Claude Code; the check looked in the folder printed there.
- If the check says `put back: NO`: in the same Claude Desktop chat type `Put back every flag, keyword and caption you changed.` Claude Code lists the photos still changed from the results file.
- If a batch photo still shows the hero's look after the undo: in Develop, open the Snapshots panel (left) and click its "AVG pre-sync ..." snapshot.
- If Claude Desktop says a tool is not available: the entry runs the `edit` profile; do the first item above.

## Observed (Jim)

- Shoot (folder, number of photos, burst size):
- Claude Desktop version:
- The + menu listed the three prompts (y/n):
- Contact sheets: number of sheets, cells, fallbacks (from the results file):
- Cull proposal shown and waited for (y/n):
- Picks and rejects sensible (y/n), notes:
- Keywords and captions sensible (y/n), notes:
- Caption seen in the Metadata panel (y/n):
- Put back (from the results file):
- Batch: hero look on the targets, two undone photos back (y/n), notes:
- Results file:

## Numbers

| Field | Value |
|---|---|
| Photos culled | |
| Sheets / cells / fallbacks | |
| Flags written (pick / reject) | |
| Keywords and IPTC writes (photos) | |
| Photos not put back | |
| Batch targets synced / undone | |
| Headline | |

## Verdict

- Go / no-go / conditional (Jim):

## Consequences / open questions

- Whether Claude Desktop's + menu lists MCP prompts is [unverified] until this run.
- Whether Claude's vision can judge focus and closed eyes on contact-sheet cells of about 490 px is [unverified]; the prompts send doubtful frames to `lr_get_preview` with a region [inference: the plan's risk list].
- The put-back judgement covers flags, keywords, IPTC text and AI metadata. The batch's undo is counted (`lr_apply_snapshot` calls), and whether every photo went back is Jim's answer.
