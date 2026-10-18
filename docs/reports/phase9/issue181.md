---
report: Issue #181 — does an AI mask stall Lightroom's write gate, and does the session now free itself?
phase: 9 (wip/181-stuck-ai-mask, before the fix PR)
status: template
authored_by: "Template, harness, engine change and pre-run findings: Claude Code (Opus 5.5), 2026-10-18. Observed: Jim (blank). Verdict: Jim (blank)."
date: 2026-10-18
---

# Issue #181 — does an AI mask stall Lightroom's write gate, and does the session now free itself?

## Purpose

**The question.** On 2026-10-18 an AI Water mask (`lr_create_mask`, `kind: "landscape_water"`) on `2025-01-10_LrcAVG.dng` (uuid `6D1646D4-B625-4CEF-95D6-4D7665E839FF`) got no result from Lightroom in 5 minutes. The engine returned `LIGHTROOM_STUCK` and the session stayed frozen: no write, render or revert [handle: GitHub issue #181 "Summary", "Evidence"]. The same kind on the same photo had computed in 6.7 s that day [handle: `logs\20261018-d41e95.json:1674-1675`, `kind` `landscape_water`, `update_ms` 6.3, `computed_ms` 6698.5; the issue's `timings.total_ms` ≈ 8383 is [stated: issue #181]].

1. Does the stall repeat, and how often? With and without an AI Sky mask made first?
2. When Lightroom lets go after the engine gave up, does the session now free itself and put the photo back, with no restart of Lightroom?

**The issue's acceptance criteria**, quoted [handle: GitHub issue #181 "Acceptance criteria"]:

- "A documented repro, or a documented "could not reproduce in N runs", with timings."
- "If cancellable: a stuck AI mask recovers without restarting Lightroom, and the photo reverts to the pre-session snapshot."
- "If not cancellable: the HUD and the error message make the wait and the restart path clear to a non-technical user."

**Go rule** (PHASES.md has none for a diagnosis; proposed [inference]): the stall is **reproduced** when at least one run of the harness gets no result in 5 minutes; **not reproduced in N runs** when all N compute. Whether it depends on a Sky mask before it is read from the two commands below. The change to the engine is **accepted** when, in a stall, the session frees itself after Lightroom lets go and Abort or `lr_end_session "revert"` puts the photo back without restarting Lightroom; that needs a stall, so it may stay [unverified] if none occurs.

**How the check asks Jim:** y/n questions in the PowerShell window, as in every check since Phase 1 [handle: `docs\reports\phase1\PHASE1.md:17`; `.claude\rules\04-workflow.md` "Steps for Jim"; the same for issue #123's probe, `docs\reports\phase8.5\ai-vegetation.md` "Purpose"].

## Harness

| What | Files |
|---|---|
| The probe (`npm run ai:probe`) | `engine\src\devtools\ai-probe.ts` (one run), `ai-probe-plan.ts` (options, the runs, the summary line), `ai-probe-cli.ts` (the command) |
| The engine's change | `engine\src\session\ai-update.ts` (`settlePending`, the HUD's time), `ai-trace.ts` (first and last 20 probes), `ai-revert.ts`, `abandon.ts`, `hud-actions.ts` (texts). `ai-update.ts` was split first (`ai-timings.ts`, `ai-guard.ts`, `ai-reads.ts`, `ai-verdict.ts`, leaf files: arch-check fails a new import cycle) |
| Tests (the Lightroom simulator, not Lightroom) | `engine\tests\session-ai-unfreeze.test.ts`, `session-ai-wait-note.test.ts`, `mcp-ai-stuck-text.test.ts`, `ai-probe.test.ts` |

**What the probe does** (new options, issue #181):

- `--kind <kind>`: asks Lightroom for that AI mask, the way the engine asks it (an entry with the sliders of the stalled call, `update_ai_settings` with the plugin's guard, then reads and gate probes), `--repeat <n>` times. After each run the photo is put back to the snapshot "AVG ai-probe before". The kinds are the engine's own names (`landscape_water`, `sky`, ...).
- `--sky-first`: before each run, an AI Sky mask is made and waited for, as pass 2 of the stalled session did.
- Each run waits up to 5 minutes, as the engine does, so that "stuck" here is the engine's `LIGHTROOM_STUCK`.
- Saved to `%TEMP%\LrC-AVG\ai-probe\ai_probe_<time>.json`: for each run its `outcome`, its time `t_ms`, when the gate first read busy (`first_busy_ms`) and when the update read over (`settled_ms`), every probe and read with its time, and (with `--sky-first`) the Sky mask's time `sky_first_ms`; plus a `summary` and the plugin's log. The window ends with one summary line: runs, completed, stuck, other, and the median and the largest time.

**Steps for Jim.** Claude Desktop quit. Lightroom open in Develop on `2025-01-10_LrcAVG.dng`, that photo alone selected, the LrC-AVG (dev) plugin loaded from `D:\Developer\LrC_Autonomous_Gateway\plugin\LrC-AVG.lrplugin` (this branch changes no Lua; the probe needs plugin 0.16.0 or later, the engine's change 0.20.0).

1. In PowerShell, in the folder of this branch (until it is merged, the worktree below; after the merge, `D:\Developer\LrC_Autonomous_Gateway`), run the first series. The command builds the engine first, so it starts after a few seconds:
   ```powershell
   cd D:\Developer\LrC_Autonomous_Gateway\.claude\worktrees\wf_abb59bb4-98c-3
   npm run ai:probe -- --new --kind landscape_water --repeat 10 --sky-first
   ```
2. When it asks "Does it show water?" type `y` and press Enter. When it asks "Does it show sky?" type `y` and press Enter.
3. Do not click in Lightroom. Each run takes about 10 s when Lightroom computes the mask, and up to 5 minutes when it does not. The window puts the photo back after each run and starts the next.
4. If a run gets no result, the window asks three y/n questions (is an error dialog open, did one show, does Lightroom respond). Answer each with `y` or `n` and press Enter.
5. When the window prints `AI mask probe: DONE`, run the second series, which is the same without the Sky mask first:
   ```powershell
   npm run ai:probe -- --new --kind landscape_water --repeat 10
   ```
6. Answer the same question (`y`) and wait for `AI mask probe: DONE`.
7. Tell Claude Code "done". It collects both result files from `%TEMP%\LrC-AVG\ai-probe\`.

### If something goes wrong

- If the window says `Lightroom needs a restart before the next run`, follow its three numbered lines, then run `npm run ai:probe` with no options: it goes on with the saved runs.
- If the window says `select one photo in Lightroom's Develop`, select only `2025-01-10_LrcAVG.dng` in Develop and run the same command again.
- If the window says `the photo could not be put back`, in Lightroom's Develop module open the Snapshots panel, click `AVG ai-probe before`, then run the command again with `--new`.
- If the window says it cannot take the engine's lock, quit Claude Desktop and run the command again.

## Pre-run findings (Claude Code)

**What the session of 2026-10-18 recorded**

- **No restart was needed; the Deck's Abort recovered the session** [stated: Jim, 2026-10-18, comment on issue #181]. The log ends `"outcome": "abandoned"` at 14:34:06Z [handle: `logs\20261018-441ee2.json:17-18`]. In Lightroom's local time (UTC-7 [inference: 07:34:05.975 local is 14:34:05.975Z, the `ended` time]): `hud_abort` 07:34:05.975 (line 27256), `clear_pending_ai` 07:34:06.005 (line 27259), the next session's `create_snapshot` 07:34:51.853 (line 27268), and the restart only at 08:49:34.990 `stall-diag: startup rebind` (line 27367) [handle: `%TEMP%\LrC-AVG\bridge.log`, on Jim's PC]. The Abort asked for a revert first, was refused with `AI_UPDATE_PENDING`, and fell back to abandon [handle: `engine\src\session\hud-actions.ts:171-174`].
- **The update was still "running" when the wait ended.** The engine's message: "no result within 5 minutes, Lightroom's update running" [handle: `logs\20261018-441ee2.json:1360`]. The `ai_trace`: `sent` "started"; 40 probes kept, every one `"status": "aborted"` with `"update": "running"`, the first at `t_ms` 11444.6; `probes_dropped` 74; 237 reads, `last_t_ms` 300405.6, `last_entry` "no result yet" [handle: `logs\20261018-441ee2.json:1368-1581`]. That the stall was in Lightroom, not a completion signal the engine missed, is [inference]; the probe's "aborted" is Lightroom's own answer that the gate was held.
- **The log cannot say how the gate ended.** The kept probes were the first 40 (`MAX_PROBES`, old `ai-update.ts:156-157`), so the last 74 probes, and the end of the wait, are not recorded. When Lightroom let go is unknown: the gate was free by 07:34:51.853, when a write that needs it went through [inference: the session's `create_snapshot` is a write; Gate.lua waits up to 60 s for the gate, `plugin\LrC-AVG.lrplugin\Gate.lua:16`].
- **Version notice: no code change.** LrC was 15.6 already on 2026-10-03 [handle: `logs\check-lrc-version-2026-10-03\check.json:101`, `"lrc_version": "15.6"`], and 15.6 is the newest version tested [handle: `engine\src\bridge\lightroom.ts:9-11`]. `lightroomNotices` warns only for a version outside 15.0-15.6 [handle: `engine\src\bridge\lightroom.ts:29-37`], so `notices: []` was correct [handle: `logs\20261018-441ee2.json:12-14`]. The issue's "design rule that the engine notifies on version changes" has no text in PRD.md, ARCHITECTURE.md or LrC_AVG_CONTEXT.md that I could find (grep for "version change", "newer than tested", 2026-10-18); the project notes' 15.5.1 is stale (`CLAUDE.md` Module Map, `params` row) [unverified whether a notice on every change was intended].
- **No SDK cancel for `updateAISettings` is known** [unverified]: `LR_SDK_NOTES.md` has no entry for cancelling it (grep for "cancel", 2026-10-18), and nothing in this repo calls one. I did not look for one in the SDK reference, and invented none.

**What the engine does now** (against the Lightroom simulator; Lightroom's side is [unverified] until Jim's run)

- **The session frees itself.** After `LIGHTROOM_STUCK`, each write, render and revert first asks the plugin (`probe_write_gate`, which already existed) whether this request's update is over with the gate free. A result that came meanwhile lets the session go on. An update over with the gate free and still no result `settleMs` (2 s) later is a failed mask: the engine drops the plugin's guard (`clear_pending_ai`), writes are allowed, and the next session result carries `hud_actions` `ai_mask_failed` saying what happened, that the mask's entry stays, and how to put the photo back; the log gets a failure entry (code `AI_MASK_NO_RESULT`, not `AI_MASK_FAILED`, which `left-open.ts` reads as a mask still without a result). If the guard cannot be dropped, or the probe gets no answer, the session stays frozen as before [handle: `engine\tests\session-ai-unfreeze.test.ts`]. The note rides on the next session tool result that carries `hud_actions` (lr_step, the mask tools, lr_end_session, as the Deck-fallback note does, `engine\src\session\manager.ts` `withNotices`); `lr_get_preview` and `lr_get_metrics` carry none, and a call that fails leaves it for the next.
- **A revert after the gate is free puts the photo back to the pre-session snapshot, with no restart**, and the Deck's Abort does the same [handle: `session-ai-unfreeze.test.ts` "a revert once the gate is free …", "the Deck's Abort once the gate is free …"].
- **The Abort while the gate is still held** abandons the edit, as before. What it leaves on the photo: everything the session wrote, the AI mask's entry (no result) included, because nothing is read or written (`abandon.ts`). The result says `photo_put_back: false` and names the snapshot, and the HUD says "Photo not put back (AI mask stuck). To undo: Develop > Snapshots > "AVG pre-session …"." [handle: `session-ai-unfreeze.test.ts` "abandons the edit and says the photo was NOT put back …", "the Deck's Abort: the HUD says …"].
- **Texts.** `LIGHTROOM_STUCK`, `AI_UPDATE_PENDING`, `lr_create_mask`, `lr_step`, `lr_end_session` and `lr_help` say: Lightroom's AI mask is still computing; the session unfreezes by itself and no restart is needed; the user waits or presses Abort in the Deck (what it does); prefer linear or radial masks for the rest of the session. `AI_MASK_FAILED` still asks for a restart [handle: `engine\tests\mcp-ai-stuck-text.test.ts`].
- **HUD.** From 10 s into the wait the note reads "Lightroom's AI mask is still computing (m:ss)", or the dialog note with the time, changed at most once a second; the stuck note is exactly 120 bytes of the 120 allowed [handle: `bridge\hud-protocol.ts:55`; `Buffer.byteLength(STUCK_NOTE)` printed 120, 2026-10-18; `engine\tests\mcp-ai-stuck-text.test.ts`, `session-ai-wait-note.test.ts`]. The time starts at 10 s, the engine's `dialogAfterMs`, so a mask that computes in about 6.7 s, as the control run did, changes nothing on the HUD. No protocol or plugin change.
- **Trace.** The log keeps the first 20 and the last 20 probes and counts the rest [handle: `session-ai-wait-note.test.ts` "the trace's probes"].
- **Gates, in the worktree of branch `wip/181-stuck-ai-mask`, 2026-10-18** (the simulator, not Lightroom): `npm run build` ok; `npm test` 141 files, 1605 passed, 9 skipped (10:49-10:53 local, `engine` vitest); `npm run typecheck` ok; `npm run arch:check` ok, 68 known violations ignored, none added (the baseline file is untouched).
- **The harness, against the simulator** (`engine\tests\ai-probe.test.ts`): ten runs of one kind, a Sky mask first, the Sky mask failing, the wait per run, the options and the summary line are tested; no run was made against Lightroom.

## Observed (Jim)

*Filled by Jim; Claude Code collects it from the saved results.*

- Series 1 (`--sky-first`): 
- Series 2 (no Sky first): 
- Did any run get no result in 5 minutes? What did the three y/n answers say? 

## Numbers

| Series | Runs | Completed | Stuck | Other | Median (ms) | Largest (ms) |
|---|---|---|---|---|---|---|
| Water, Sky first | | | | | | |
| Water | | | | | | |

## Verdict

*Decided by Jim. A script's suggestion is labelled as one.*

## Consequences / open questions

**Decisions for Jim**

1. **A late end of a stuck mask frees the session, but `AI_MASK_FAILED` still asks for a restart.** Both are "Lightroom's update is over, the gate is free, no result 2 s later". Jim decided the second needs a save-and-restart because Lightroom may be unstable [stated: Jim, 2026-10-11, "Go with recommendations"; handle: `engine\src\session\ai-update.ts` header]. The issue asks that a stuck session recover without a restart [handle: GitHub issue #181 "Acceptance criteria"], so the change frees only the session that had already waited 5 minutes. Options: (a) keep as is (recommended until a run shows what a late end looks like in Lightroom); (b) free `AI_MASK_FAILED` the same way.
2. **The Deck's Abort cannot cut the 5-minute wait.** While the engine waits it answers "Abort must wait" [handle: `engine\src\session\hud-actions.ts:155`]; Abort works once `LIGHTROOM_STUCK` came. Options: (a) keep (recommended: the wait is bounded and the HUD now shows the time); (b) let Abort end the wait at once and abandon the edit. (b) is a change to `hud-actions.ts`, which is over 300 lines and would be split first.

**Still [unverified] until Jim's run**: that Lightroom's update returns after a stall and the plugin's `update.state` then reads `done` with the gate free; that a revert then goes through; whether the stall depends on a Sky mask before it; any cause.
