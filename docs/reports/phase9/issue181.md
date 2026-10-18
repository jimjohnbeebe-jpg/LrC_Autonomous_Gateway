---
report: Issue #181 — does an AI mask stall Lightroom's write gate, and how does a stuck session end?
phase: 9 (fix/p0-179-180-181, before the fix PR)
status: template
authored_by: "Template, harness, engine change and pre-run findings: Claude Code (Opus 5.5), 2026-10-18. Decisions 1 and 2: Jim, 2026-10-18. Observed: Jim (blank). Verdict: Jim (blank)."
date: 2026-10-18
---

# Issue #181 — does an AI mask stall Lightroom's write gate, and how does a stuck session end?

## Purpose

**The question.** On 2026-10-18 an AI Water mask (`lr_create_mask`, `kind: "landscape_water"`) on `2025-01-10_LrcAVG.dng` (uuid `6D1646D4-B625-4CEF-95D6-4D7665E839FF`) got no result from Lightroom in 5 minutes. The engine returned `LIGHTROOM_STUCK` and the session stayed frozen: no write, render or revert [handle: GitHub issue #181 "Summary", "Evidence"]. The same kind on the same photo had computed in 6.7 s that day [handle: `logs\20261018-d41e95.json:1674-1675`, `kind` `landscape_water`, `update_ms` 6.3, `computed_ms` 6698.5; the issue's `timings.total_ms` ≈ 8383 is [stated: issue #181]].

1. Does the stall repeat, and how often? With and without an AI Sky mask made first?
2. Can the user end a stuck or waiting AI mask without restarting Lightroom, and is the wait and the way out clear?

**The issue's acceptance criteria**, quoted [handle: GitHub issue #181 "Acceptance criteria"]:

- "A documented repro, or a documented "could not reproduce in N runs", with timings."
- "If cancellable: a stuck AI mask recovers without restarting Lightroom, and the photo reverts to the pre-session snapshot."
- "If not cancellable: the HUD and the error message make the wait and the restart path clear to a non-technical user."

**Go rule** (PHASES.md has none for a diagnosis; proposed [inference]): the stall is **reproduced** when at least one run of the harness gets no result in 5 minutes; **not reproduced in N runs** when all N compute. Whether it depends on a Sky mask before it is read from the two commands below. No SDK cancel for `updateAISettings` is known [unverified] (see "Pre-run findings"), so the third criterion applies: the engine change is **accepted** when the HUD and the errors say the mask is still computing and how the session ends (a late result, Abort, or a restart), and the Deck's Abort ends the wait and the edit within a few seconds without a Lightroom restart, the photo NOT put back and the snapshot that puts it back named, with the user told to wait for the mask's shape first (Decisions 1 and 2).

**How the check asks Jim:** y/n questions in the PowerShell window, as in every check since Phase 1 [handle: `docs\reports\phase1\PHASE1.md:17`; `.claude\rules\04-workflow.md` "Steps for Jim"; the same for issue #123's probe, `docs\reports\phase8.5\ai-vegetation.md` "Purpose"].

## Harness

| What | Files |
|---|---|
| The probe (`npm run ai:probe`) | `engine\src\devtools\ai-probe.ts` (one run), `ai-probe-plan.ts` (options, the runs, the summary line), `ai-probe-cli.ts` (the command) |
| The engine's change | `engine\src\session\ai-update.ts` (the HUD's time, the wait's Abort), `ai-trace.ts` (first and last 20 probes), `ai-revert.ts` (`STUCK_NOTE`, `LIGHTROOM_STUCK`), `abandon.ts`, `hud-actions.ts` (Abort), `io.ts` (`abortError`, `failed`), `restart.ts` (`revertIfRestarted`). `ai-update.ts` was split first (`ai-timings.ts`, `ai-reads.ts`, `ai-verdict.ts`, leaf files: arch-check fails a new import cycle), and so was `hud-actions.ts` (`hud-notes.ts`, a pure move, with `withHudActions` from `manager.ts`; `reopenLog` moved to `io.ts`) |
| Tests (the Lightroom simulator, not Lightroom) | `engine\tests\session-ai-abort-wait.test.ts`, `session-ai-stuck.test.ts` (was `session-ai-unfreeze.test.ts`), `session-ai-restart.test.ts`, `mcp-deadline.test.ts`, `session-ai-wait-note.test.ts`, `mcp-ai-stuck-text.test.ts`, `ai-probe.test.ts` |

**What the probe does** (new options, issue #181):

- `--kind <kind>`: asks Lightroom for that AI mask, the way the engine asks it (an entry with the sliders of the stalled call, `update_ai_settings` with the plugin's guard, then reads and gate probes), `--repeat <n>` times. After each run the photo is put back to the snapshot "AVG ai-probe before". The kinds are the engine's own names (`landscape_water`, `sky`, ...).
- `--sky-first`: before each run, an AI Sky mask is made and waited for, as pass 2 of the stalled session did.
- Each run waits up to 5 minutes, as the engine does, so that "stuck" here is the engine's `LIGHTROOM_STUCK`.
- Saved to `%TEMP%\LrC-AVG\ai-probe\ai_probe_<time>.json`: for each run its `outcome`, its time `t_ms`, when the gate first read busy (`first_busy_ms`) and when the update read over (`settled_ms`), every probe and read with its time, and (with `--sky-first`) the Sky mask's time `sky_first_ms`; plus a `summary` and the plugin's log. The window ends with one summary line: runs, completed, stuck, other, and the median and the largest time.

**Steps for Jim, the probe.** Claude Desktop quit. Lightroom open in Develop on `2025-01-10_LrcAVG.dng`, that photo alone selected, the LrC-AVG (dev) plugin loaded from `D:\Developer\LrC_Autonomous_Gateway\plugin\LrC-AVG.lrplugin` (this branch changes no Lua; the probe needs plugin 0.16.0 or later, the engine's change 0.20.0).

1. In PowerShell, on branch `fix/p0-179-180-181` (until it is merged; after the merge, on `main`), run the first series. The command builds the engine first, so it starts after a few seconds:
   ```powershell
   cd D:\Developer\LrC_Autonomous_Gateway
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

**Steps for Jim, Abort during a wait (a real session, no stall needed).** Lightroom in Develop on `2025-01-10_LrcAVG.dng`, that photo alone selected.

1. Quit Claude Desktop. In PowerShell, on this branch, register this branch's engine:
   ```powershell
   cd D:\Developer\LrC_Autonomous_Gateway
   npm run build
   npm run desktop:install
   ```
2. Start Claude Desktop and ask: "Begin a session on the selected photo and add an AI Water mask."
3. When the Deck says "Lightroom is computing the AI mask; this can take a few minutes.", click Abort on the Deck at once (the mask computed in about 7 s on 2026-10-18, so click within 2-3 s).
4. Within a few seconds the Deck shows either "Photo not put back; Lightroom is finishing the AI mask. Once it shows, click the AVG snapshot in Develop > Snapshots." or "Aborted: the photo is back as it was before the edit." Note which one.
5. Click the Basic panel's header in Lightroom twice: it folds and unfolds.
6. If the Deck said "Photo not put back", wait until the Water mask's shape shows in Lightroom's Masking panel, then click the newest snapshot whose name starts with "AVG pre-session" in Develop > Snapshots. If no shape shows within 5 minutes, restart Lightroom (File > Exit, then start it again) instead.
7. Tell Claude Code "done" and which Deck line showed; Claude Code reads the session log for the outcome.

### If something goes wrong

- If the window says `Lightroom needs a restart before the next run`, follow its three numbered lines, then run `npm run ai:probe` with no options: it goes on with the saved runs.
- If the window says `select one photo in Lightroom's Develop`, select only `2025-01-10_LrcAVG.dng` in Develop and run the same command again.
- If the window says `the photo could not be put back`, in Lightroom's Develop module open the Snapshots panel, click `AVG ai-probe before`, then run the command again with `--new`.
- If the window says it cannot take the engine's lock, quit Claude Desktop and run the command again.
- If the Deck already shows the mask's result when you click Abort, the Deck says "Aborted: the photo is back as it was before the edit.": that counts, note it in step 4.

## Pre-run findings (Claude Code)

**What the session of 2026-10-18 recorded**

- **No restart was needed; the Deck's Abort recovered the session** [stated: Jim, 2026-10-18, comment on issue #181]. The log ends `"outcome": "abandoned"` at 14:34:06Z [handle: `logs\20261018-441ee2.json:17-18`]. In Lightroom's local time (UTC-7 [inference: 07:34:05.975 local is 14:34:05.975Z, the `ended` time]): `hud_abort` 07:34:05.975 (line 27256), `clear_pending_ai` 07:34:06.005 (line 27259), the next session's `create_snapshot` 07:34:51.853 (line 27268), and the restart only at 08:49:34.990 `stall-diag: startup rebind` (line 27367) [handle: `%TEMP%\LrC-AVG\bridge.log`, on Jim's PC]. The Abort asked for a revert first, was refused with `AI_UPDATE_PENDING`, and fell back to abandon [handle: `engine\src\session\hud-actions.ts:171-174` on the base commit `5070467`].
- **The update was still "running" when the wait ended.** The engine's message: "no result within 5 minutes, Lightroom's update running" [handle: `logs\20261018-441ee2.json:1360`]. The `ai_trace`: `sent` "started"; 40 probes kept, every one `"status": "aborted"` with `"update": "running"`, the first at `t_ms` 11444.6; `probes_dropped` 74; 237 reads, `last_t_ms` 300405.6, `last_entry` "no result yet" [handle: `logs\20261018-441ee2.json:1368-1581`]. That the stall was in Lightroom, not a completion signal the engine missed, is [inference]; the probe's "aborted" is Lightroom's own answer that the gate was held.
- **The log cannot say how the gate ended.** The kept probes were the first 40 (`MAX_PROBES`, old `ai-update.ts:156-157`), so the last 74 probes, and the end of the wait, are not recorded. When Lightroom let go is unknown: the gate was free by 07:34:51.853, when a write that needs it went through [inference: the session's `create_snapshot` is a write; Gate.lua waits up to 60 s for the gate, `plugin\LrC-AVG.lrplugin\Gate.lua:16`].
- **Version notice: no code change.** LrC was 15.6 already on 2026-10-03 [handle: `logs\check-lrc-version-2026-10-03\check.json:101`, `"lrc_version": "15.6"`], and 15.6 is the newest version tested [handle: `engine\src\bridge\lightroom.ts:9-11`]. `lightroomNotices` warns only for a version outside 15.0-15.6 [handle: `engine\src\bridge\lightroom.ts:29-37`], so `notices: []` was correct [handle: `logs\20261018-441ee2.json:12-14`]. The issue's "design rule that the engine notifies on version changes" has no text in PRD.md, ARCHITECTURE.md or LrC_AVG_CONTEXT.md that I could find (grep for "version change", "newer than tested", 2026-10-18); the project notes' 15.5.1 is stale (`CLAUDE.md` Module Map, `params` row) [unverified whether a notice on every change was intended].
- **No SDK cancel for `updateAISettings` is known** [unverified]: `LR_SDK_NOTES.md` has no entry for cancelling it (grep for "cancel", 2026-10-18), and nothing in this repo calls one. I did not look for one in the SDK reference, and invented none.

**What the engine does now** (against the Lightroom simulator; Lightroom's side is [unverified] until Jim's runs)

- **D16 is kept after `LIGHTROOM_STUCK`** (Decision 1). Each later write, render and revert reads the mask table first (`engine\src\session\ai-update.ts:240-245` `settlePending`): a result that came meanwhile lets the session go on; anything else, a "done" record with no digest included, is refused with `AI_UPDATE_PENDING`, nothing written, the plugin's guard kept. The session ends otherwise only by the Deck's Abort or `lr_end_session "abandon"` (nothing read or written, the photo NOT put back) or by a Lightroom restart (the engine then puts the photo back, `restart.ts`) [handle: `engine\tests\session-ai-restart.test.ts:60` "keeps the mask pending after Lightroom's record says done: no write or revert until the entry computes, then the session goes on" (main's guard test, restored); `session-ai-stuck.test.ts:61` "an update that ends with no result frees nothing (D16) …", `:52` "an update that ends with the result: the session goes on …", `:71` "the Deck's Abort once the result has shown puts the photo back …"].
- **The Deck's Abort during the 5-minute wait ends it** (Decision 2). The click sets the session's Abort at once and answers "Abort: ending the wait for the AI mask. The photo is put back only if Lightroom has finished it." (`hud-actions.ts:145`, `:161`, 96 bytes); the wait stops at its next read (`ai-update.ts:123` `checkAbort`): within a poll (`pollMaxMs`, 1 s) plus the read or probe in flight, which may take up to 15 s (`get_settings`, `bridge\client.ts:56` `requestTimeoutMs`) or 5 s (a probe, `probeReplyMs`), so within a few seconds, about one when Lightroom answers reads [inference: from `ai-update.ts` `watch`]. The pending `lr_create_mask` fails with `SESSION_ENDED` (`details.state` "ending", the snapshot named; `io.ts:58-75` `abortError`), not `LIGHTROOM_STUCK`; an error the wait ends with after the Abort (a dropped bridge, say) is reported the same way, not as a session still open (`io.ts:254`). A client that got `pending: true` and calls again with the same arguments gets that `SESSION_ENDED` once, and the next identical call gets `SESSION_ENDED` for the abandoned session [handle: `engine\tests\mcp-deadline.test.ts:194` "issue #181: an AI mask's call detached (pending), the Deck's Abort, then the identical call gets SESSION_ENDED, not LIGHTROOM_STUCK"]. The queued revert puts the photo back if Lightroom's result has shown; if Lightroom restarted under the wait (the bridge dropped and the plugin came back from a new process), the photo is put back as after any restart (`hud-actions.ts:177`, `restart.ts:45` `revertIfRestarted`); otherwise the edit is abandoned (`hud-actions.ts:173-184`).
- **An Abort during the first wait keeps the plugin's guard** (the review of #181). Lightroom is likely still computing the mask then, so `abandon.ts:83` drops the guard only for a stuck or failed mask and otherwise reports `lightroom_guard` "kept": the plugin refuses the engine's writes to the photo until the mask's shape shows, then drops the guard itself [handle: `plugin\LrC-AVG.lrplugin\Pending.lua:120-127` `Pending.refusal`], or until a restart. The HUD says "Photo not put back; Lightroom is finishing the AI mask. Once it shows, click the AVG snapshot in Develop > Snapshots." (`abandon.ts:78`, 117 bytes), and the next call's `SESSION_ENDED` says to wait until the mask's shape shows before the snapshot is clicked or a new session begins (`hud-notes.ts:60`). What the wait saw (`ai_trace`) goes on a failure entry "ai mask (wait ended by the user's Abort)" (`abandon.ts:87`) [handle: `engine\tests\session-ai-abort-wait.test.ts:44` "ends the wait within about a second (Lightroom answering reads) and abandons the edit: nothing written, the photo NOT put back, the guard kept, the trace logged" (with the real 1 s poll, ended in under 1.5 s), `:71` "pressed twice …", `:82` "the result shows right after the Abort: the revert goes ahead …", `:95` "the result arrived before the Abort but the call has not returned …", `:115` "Abort before the update request is sent: no update goes out, and the photo is put back", `:136` "Lightroom restarting under the wait (the bridge dropped), then Abort: the photo is put back as after a restart, not abandoned"]. "Abort must wait" (`ABORT_WAITS`) is gone.
- **The Abort or abandon after `LIGHTROOM_STUCK`** abandons the edit and drops the guard, as before. What it leaves on the photo: everything the session wrote, the AI mask's entry (no result) included, because nothing is read or written (`abandon.ts`). The result says `photo_put_back: false` and names the snapshot [handle: `session-ai-stuck.test.ts:84` "abandons the edit and says the photo was NOT put back …", `:97` "the Deck's Abort: the HUD says …"].
- **Texts.** `LIGHTROOM_STUCK`, `AI_UPDATE_PENDING`, `lr_create_mask`, `lr_end_session` and `lr_help` point 9 say: Lightroom's AI mask is still computing; the session goes on when Lightroom's result shows, and nothing else frees it; the user waits or presses Abort in the Deck (it puts the photo back if the result has shown, else ends the edit as it is and names the snapshot); restarting Lightroom also ends the wait and puts the photo back; prefer linear or radial masks for the rest of the session. They tell Claude that Lightroom does not notify it, so that its next call checks once the user says to go on, and that it must not ask for the same AI mask again. `lr_create_mask` and `lr_help` say that Abort during the wait fails the call with `SESSION_ENDED`; `lr_help`, `lr_end_session` (`lightroom_guard` "kept") and the README's Abort row say to wait until the mask's shape shows before the snapshot is clicked. No text says the session unfreezes or frees itself or that no restart is needed. `AI_MASK_FAILED` still asks for a restart [handle: `engine\tests\mcp-ai-stuck-text.test.ts`]. `lr_create_mask`'s description is 4,061 characters of the 4,096 allowed [handle: `engine\tests\mcp-portable.test.ts`; `node -e` reading `MASK_DEFS` from `engine\dist\mcp\defs-masks.js` printed 4061, 2026-10-18].
- **HUD.** From 10 s into the wait the note reads "Lightroom's AI mask is still computing (m:ss)", or the dialog note with the time, changed at most once a second. Each change is a `hud_update` to the plugin, one in flight at a time, a newer state replacing one still waiting [handle: `engine\src\hud\publisher.ts:8`, `:85`, `:182-219`]; what that does to Lightroom while a stalled update holds its gate is [unverified] (it comes after issue #174's stutter), and the probe has no HUD (see "Observed"). The stuck note, "Lightroom's AI mask is still computing. When done, ask the AI to go on. Abort leaves it as is; a restart puts it back.", is 118 bytes of the 120 allowed [handle: `bridge\hud-protocol.ts:55`; `engine\src\session\ai-revert.ts:24`; `mcp-ai-stuck-text.test.ts`]. It says to ask the AI because nothing polls once the wait is over: the session checks only on Claude's next write, render or revert (`engine\src\session\io.ts`, `end.ts`) [inference: the HUD keeps the note until then]. No protocol or plugin change: `plugin\LrC-AVG.lrplugin\HudText.lua:89`, `:98` ("wait, or restart Lightroom") are the HUD's Put back lines, which write nothing while a mask computes (D16), and they stay.
- **Trace.** The log keeps the first 20 and the last 20 probes and counts the rest [handle: `session-ai-wait-note.test.ts` "the trace's probes"].
- **Gates, on branch `fix/p0-179-180-181` in `D:\Developer\LrC_Autonomous_Gateway`, 2026-10-18** (the simulator, not Lightroom), after the review fixes (commit `32b6914`): `npm run build` ok; `npm test` 152 files, 1682 passed, 3 skipped (12:44 local); `npm run typecheck` ok; `npm run arch:check` ok, 32 known violations ignored, none added: moving `reopenLog` to `io.ts` removed 36 file cycles, and the baseline was shrunk with `--baseline-mode shrink-only` (68 to 32 entries, none new). `session-ai-abort-wait.test.ts` (then 5 tests) ran three more times alone before the review: 5 of 5 passed each time. The restart test there fails when the restart check in `finishAbort` is switched off (tried once, 2026-10-18).
- **The harness, against the simulator** (`engine\tests\ai-probe.test.ts`): ten runs of one kind, a Sky mask first, the Sky mask failing, the wait per run, the options and the summary line are tested; no run was made against Lightroom.

## Observed (Jim)

*Filled by Jim; Claude Code collects it from the saved results.*

- Series 1 (`--sky-first`): 
- Series 2 (no Sky first): 
- Did any run get no result in 5 minutes? What did the three y/n answers say? 
- HUD during a real session (not a probe run; the probe has no HUD): in an AI mask wait longer than 10 s, did the HUD's time change about once a second, and did Lightroom stay responsive (the Basic panel's header folds and unfolds)? 
- Abort during a wait (a real session, "Steps for Jim, Abort during a wait"): which Deck line showed, about how soon after the click, and did Lightroom stay responsive? 

## Numbers

| Series | Runs | Completed | Stuck | Other | Median (ms) | Largest (ms) |
|---|---|---|---|---|---|---|
| Water, Sky first | | | | | | |
| Water | | | | | | |

## Verdict

*Decided by Jim. A script's suggestion is labelled as one.*

## Consequences / open questions

**Decisions for Jim** (both decided)

1. **After `LIGHTROOM_STUCK`: keep D16.** Picked: (a) Keep D16 [stated: Jim, 2026-10-18, "Keep D16 (Recommended)"]. D16: nothing is written to the photo while a mask the engine asked for has no result [stated: Jim, 2026-10-04, "Wait for Lightroom (Recommended)" and "Yes: revert after restart (Recommended)"; handle: `engine\src\session\ai-update.ts` header]. The reason: the update's own record says "done" before the computation ends (the digests came 0.3-0.5 s after `updateAISettings` returned [handle: `docs\reports\phase6\masks-capture\capture3-check.json` steps `4_*`]), and in capture 5's row E the engine's put-back, made after Lightroom's gate was free again, left Lightroom's screen on the edit until Jim restarted Lightroom [stated: Jim; handle: `docs\reports\phase6\masks-capture.md` "Capture 5" (row E)]. An earlier commit of this branch freed the session when a probe read the update over with no result 2 s later; that is removed (`updateOver`, `endFailed`, the `ai_mask_failed` notice, the `AI_MASK_NO_RESULT` log entry), and main's guard test is back (see "Pre-run findings"). Not met by this: the issue's "reverts without a restart" line, which is conditional on a cancel that is not known [unverified]; met: the third criterion, the wait and the ways out made clear.
2. **The Deck's Abort during the 5-minute wait.** Picked: (b) Abort ends the wait and abandons the edit [stated: Jim, 2026-10-18, "Abort ends the wait now"]. Built as above (the wait ends within a few seconds, not at once: see "Pre-run findings"); `hud-actions.ts` was split first (`hud-notes.ts`, a pure move, no behaviour change). An independent review of the branch (2026-10-18) added: the guard kept during the first wait, the restart check before the abandon, the trace on the abandon's entry, and the `SESSION_ENDED` for an error after the Abort. Before it, the Abort answered "Abort must wait" during the wait [handle: `engine\src\session\hud-actions.ts:155` on the base commit `5070467`].

**Still [unverified] until Jim's runs**: whether Lightroom's update returns after a stall at all; whether the stall depends on a Sky mask before it; any cause; that the Deck's Abort during a real wait ends it within a few seconds and that Lightroom then stays responsive (the "Observed" Abort line; a stall itself is not needed for it); that the kept guard clears itself once the mask shows in Lightroom (`Pending.lua:120-127` clears it only when a later write is checked [inference: from the code]); that Lightroom, its guard dropped by an abandon after `LIGHTROOM_STUCK` while it may still compute, gives no trouble to the next session's writes (`GUARD_NOTE.cleared` already says a restart is the safe way); whether the HUD's once-a-second time makes Lightroom stutter while a stalled update holds its gate (the interval is `noteEveryMs` in `engine\src\session\ai-timings.ts`, which can be raised to 5 s if it does).

**Known gap, not changed here (pre-existing; the review of #181)**: the LrDevelopController route (`engine\src\session\ai-masks.ts:152-168` `byDevelop`) marks its mask pending only after its own wait (`waitComputed`, up to `dcWaitMs`, 10 s); an Abort during that wait stops it before `s.aiPending` is set, so the Abort's revert is not held back for that mask the way the table route's is [inference: from the code; the route is the fallback for subject, sky and background only]. Left for a later issue.
