---
report: AVG-P7 Phase 7 acceptance on the Deck
phase: 7
status: accepted
authored_by: "Template, harness and pre-run findings: Claude Code (Opus 5.5), 2026-10-06, branch phase-7/check (vault PHASE7_PLAN row 6). Observed: Jim's runs and answers; log analysis and Numbers: Claude Code (Opus 5.5), 2026-10-07, branch phase-7/results (row 7). Verdict: Jim."
date: 2026-10-07
---

# AVG-P7: Phase 7 acceptance on the Deck

## Purpose

Phase 7 built the Deck, a free-floating HUD window for Lightroom (spec `docs\hud\lrc-avg-hud-spec-v2.md` section 2.7). This check is Jim's acceptance of it in real edits on Jim's machine:
- the lines of spec 11.1 as 2.7 amends them, A1-A24 without A20 (Whole edit, deferred with E5);
- the section 9 budgets, measured on the built Deck.

The phase rule, PHASES.md "Phase 7", quoted: "Acceptance (spec section 11): the S9 gates S9-1 to S9-11 pass; A1-A24 checked by Jim in full on C, and on placement, forms and keyboard focus for A and B; the spec 11.2 simulator tests pass; the section 9 budgets are measured." The re-plan narrows it to the Deck (layout C) [stated: Jim, 2026-10-05, "Defer development of all of the HUDs except for the detached deck"]: vault PHASE7_PLAN.md "Acceptance".

The plan for this row [stated: Jim, 2026-10-06, "go", to the recommendations]:
- D1 A: scripted edits for most lines, plus two Claude Desktop chats for the lines that name Claude Desktop (A1, A3, A6, A8).
- D2 A: the Deck logs `got` and `painted` for each state (hud 0.3.1), so all six budgets are measured.
- D3 A: for A24 the check renames the Deck's program and gives it its name back.
- D4: Jim answers y/n in PowerShell.

**How a line passes.** Each line passes only when Jim answers y. Where the logs can show the same thing, a log check sits beside Jim's answer, and the line needs both. "Acceptance: WORKED" needs every line YES, the photo put back after every step, and every budget measured. A budget over its target is named in the headline. Whether that blocks Phase 7 is Jim's verdict.

## Harness

- `npm run phase7:check` runs `hud\probe\check\check.ts`. The other modules are:
  - `summary.ts`: the lines, the state's schema and the verdict;
  - `ctx.ts`: the state file, the engine, the bridge and the put-back;
  - `edits-a.ts` and `edits-b.ts`: edits 1-5;
  - `chats.ts`: chats 1-2;
  - `fallback.ts`: the classic window and Lightroom's quit;
  - `budgets.ts`: the timings, memory and CPU.
- **The engine.** Like `npm run deck:menu` (row 5), it runs the real engine from `engine\dist` against Lightroom, without a chat. For the two chats it gives the Lightroom bridge to Claude Desktop's engine and takes it back afterwards. Claude Desktop lets the bridge go a minute after Claude's last call [handle: `engine\src\mcp\main.ts` IDLE_RELEASE_MS; `docs\reports\phase5\PHASE5.md` "Observed"].
- **The photo.**
  - The first run records the selected photo and its settings, and takes a snapshot "AVG P7check start <run>".
  - After every step the photo is compared with those settings, and put back with that snapshot if anything differs (lines `back.<step>`).
  - The snapshot and the edits' "AVG pre-session" snapshots stay in the photo's Snapshots panel, as Phase 5's check left its own.
  - Edit 4's copies are removed by Jim, with Phase 5's steps (`docs\reports\phase5\PHASE5.md` "Steps for Jim", step 14), because the bridge has no command that deletes a photo. The check confirms each removal by uuid (line `copies.removed`).
- **Steps and resuming.**
  - Steps: edits E1-E5, chats C1-C2, F1 (no Deck), F2 (Lightroom quits).
  - The check resumes where it stopped: finished steps are skipped. `npm run phase7:check -- --new` starts over, and `npm run phase7:check -- --redo E1,E2,E3` marks those steps unfinished, then runs every unfinished step in order.
  - F2 runs only when every other step has finished, because nothing can be put back after Lightroom quits.
  - A run stopped with Ctrl+C, or killed, puts back the photo, the Deck's program name and its `window.json` first: at its end, or else at the next start (also before `--new` starts over). On Ctrl+C the check starts no new edit call and waits for the one in flight before it puts the photo back.
  - The settings page's Mode is read (`get_prefs`) before every edit. If it is not what the edit needs, the check asks Jim to set it. After E3, or after a run stopped during E3, it asks for Autonomous again until it reads it.
  - E4 stays unfinished while any of its copies are still in the catalog. The next run asks for them first, before it makes new ones.
- **The Deck.** The check installs Deck 0.3.2 at its start. The Deck stays installed.
- **Logs.**
  - The Deck's logs: `%TEMP%\LrC-AVG\hud\hud_<pid>_<start>.jsonl`.
  - The plugin's log, `%TEMP%\LrC-AVG\bridge.log`, says whether the classic window opened (`hud: shown`).
  - The engine's session logs give the end of each edit and the HUD events.
  - For the chats, Claude Desktop's engine's tool log gives when Claude began.
- **Results.** `%TEMP%\LrC-AVG\P7\p7_state.json` and the run folder beside it, which holds:
  - `deck\` (the Deck's logs);
  - `plugin-log_<run>.txt`;
  - `sessions\`;
  - the tool log;
  - `p7_summary.json`.

  Claude Code collects them into `docs\reports\phase7\P7\`.

### What each step checks

| Step | Lines | What happens |
|---|---|---|
| E1 | A1, A2, A4, A12, A19, A22, A23 | The check stops the Deck, starts an edit and makes passes until it converges. You click Lightroom's title bar first, so `\` tests the keyboard without a click. You click Accept. The check measures memory and CPU, shown and hidden (one minute each, hands off). |
| E2 | A5 (drag), A7, A9, A13, A16 | You move, resize and minimise Lightroom, then try the screen modes and F (and F with the Deck on another monitor, when two are connected). You drag and widen the Deck. Then you click Abort while the check keeps Claude working. |
| E3 | A5 (spot), A11, A14, A15 | Mode "Approve each pass" (Plug-in Manager). Approve with Enter, Ctrl+Backspace, Esc, then twice Ctrl+Backspace. Mode back to Autonomous. |
| E4 | A17, A18, A21 | Three copies. You click another photo (Target changed), click copy B's card, then press 3 and Enter. You remove the copies. |
| E5 | A5 (fallback) | The check writes a spot on no monitor into the Deck's `window.json`, starts an edit, then puts the file back. |
| C1 | A1, A3, A8 | A Claude Desktop chat. |
| C2 | A6 | A chat where you quit Claude Desktop once the Deck appears. |
| F1 | A24 | The Deck's program renamed: the classic window opens, and you click Abort there. |
| F2 | A10 | You quit Lightroom. The Deck must close within 5 s. |

### Steps for Jim

Allow about 60 minutes [inference: five scripted edits with two one-minute measurements, two chats with up to 2½ minutes' wait each, and Lightroom's quit]. You can stop between steps: the next run goes on from there.

1. Quit Claude Desktop: right-click the Claude icon in the Windows system tray > **Quit**.
2. In Lightroom Classic, in Develop, click `20260907-_OZ80093.NEF` in the Filmstrip (the original, without a turned-page corner), so it is the only selected photo.
3. In VS Code's PowerShell terminal, at `D:\Developer\LrC_Autonomous_Gateway`, run:

   ```powershell
   npm run phase7:check
   ```

   It builds, installs the Deck 0.3.2 and says `The check's photo: 20260907-_OZ80093.NEF.`
4. Follow the window, step by step. Each instruction ends with `Press Enter when done.` or `Type y or n, then Enter:`, or says `(The check sees it; nothing to type here.)`. Answer y only when what the question describes happened.
5. **Chat 1.** When the window says `Chat 1`, do the five numbered steps it prints in Claude Desktop. The chat sentence is `Tune the active photo for golden hour landscape.`. Afterwards, leave Claude Desktop open while the check waits for the bridge (up to 2½ minutes).
6. **Chat 2.** Open a new chat with the same sentence. As soon as the Deck appears, quit Claude Desktop from its tray icon (right-click > Quit), then answer the question.
7. **Last step.** When the window says `Now quit Lightroom`, choose File > Exit in Lightroom. If Lightroom asks to back up its catalog, answer as you usually do. Then answer the last question.
8. The last lines say `Phase 7 acceptance: WORKED` or `FAILED (…)`, then `Every step has run.` and `Results saved automatically`. Tell Claude Code "done".

### If something goes wrong

- If it says Lightroom is not running, open Lightroom in Develop and run the command again.
- If it says Claude Desktop's engine is running, or another engine holds the bridge, quit Claude Desktop from its tray icon, wait a minute, and run the command again.
- If it says to select exactly one photo, do step 2 and run the command again.
- If it asks you to set the Mode, do the steps it prints (File > Plug-in Manager > LrC-AVG > Sessions > Mode > Done), then press Enter. If it says the Mode is still not right after three tries, set it and run the command again: it goes on from the step that stopped.
- If it says `ERROR in <step>`, the run stops there and puts the photo back. Tell Claude Code the error line before you run it again.
- If you need to stop, press Ctrl+C: the check puts things back and saves what it has. Run the command again later to go on.
- If the last lines say `put_back` in an error, tell Claude Code before you edit that photo.

### Steps for Jim: re-run of E5 and C1 (after `fix/snapshot-develop`)

Run 2's put-backs after E5 and C1 left the photo different while Lightroom was in Library [handle: `docs\reports\phase7\snapshot-library\timeline.txt`]. Plugin 0.18.1 switches Lightroom to Develop before it applies a snapshot. This re-run starts in Library on purpose, so the put-back after E5 has to make that switch. Allow about 15 minutes [inference: E5 plus one chat with up to 2½ minutes' wait].

1. In Lightroom: File > Plug-in Manager > LrC-AVG > **Reload Plug-in**, then **Done**.
2. Quit Claude Desktop: right-click the Claude icon in the Windows system tray > **Quit**.
3. In Lightroom, press **G** (Library Grid), then in the Catalog panel on the left click **All Photographs**. Leave Lightroom in Library. The check selects its photo, `20260907-_OZ80099.NEF`, by itself.
4. In VS Code's PowerShell terminal, at `D:\Developer\LrC_Autonomous_Gateway`, run:

   ```powershell
   npm run phase7:check -- --redo E5,C1
   ```

5. Follow the window as in the steps above. At the end of E5, Lightroom switches to Develop by itself: that is the fix at work.
6. **Chat 1.** Do the five numbered steps the window prints in Claude Desktop, then leave Claude Desktop open while the check waits for the bridge.
7. The last lines say `Phase 7 acceptance: WORKED` or `FAILED (…)`. Tell Claude Code "done".

If something goes wrong:
- If it says `not 0.18.1 or later`, do step 1 again and run the command again.
- If an error line names `select_photo` or the photo, do step 3 again and run the command again.
- Any other error: tell Claude Code the error line before you run it again.

## Pre-run findings (Claude Code)

1. **Tests and builds** (2026-10-06, branch `phase-7/check`):
   - `npm test`: 83 files, 1069 passed, 1 skipped.
   - `npm test -w hud`: 7 files, 53 passed (the 14 new ones in `hud\probe\check\summary.test.ts` and `budgets.test.ts`), plus cargo test, 5 passed.
   - `npm run typecheck`: clean.
   - `npm run deck:build`: built `LrC-AVG HUD_0.3.1_x64-setup.exe` (1.35 MiB).
2. **What the new tests cover:**
   - `summary.test.ts`:
     - every 11.1 line but A20 has checks;
     - one NO fails its line, and a missing answer is NOT RUN;
     - a skipped check (one monitor) does not count;
     - a failed put-back fails "cleanup";
     - an unmeasured or incomplete budget fails the run, and one over its target is named;
     - a step's error fails the run until the step finishes;
     - nearest-rank p95;
     - the state schema.
   - `budgets.test.ts`: each budget is measured from its own start to its own stop:
     - cold start only for a Deck the check started;
     - warm show only for a hidden Deck's new edit;
     - update to paint only while the Deck is shown;
     - click to userAction by click id;
     - Deck processes kept apart.
3. **Dry run against the Lightroom simulator** [handle: `docs\reports\phase7\check-dryrun\dryrun.txt`, with the driver verbatim].
   - **Setup:** the simulator played Lightroom, the real `engine\dist\mcp\main.js` played Claude Desktop, and no real Deck ran.
   - **Pass 1:** E1-E4 ran without an error, the photo was put back after each step, and the copies were removed. E5 stopped on a bug: when the Deck has never saved a spot, its `hud` folder does not exist, and the check did not create it. Fixed.
   - **Pass 2**, from the same saved state:
     - the check resumed at E5 and ran E5, C1, C2, F1 and F2;
     - the photo was back after every step;
     - the bridge went to "Claude Desktop" and came back, after its idle release in C1 and after it quit in C2;
     - the Deck's program was renamed and restored;
     - Lightroom's quit was seen;
     - `--redo E5` then ran E5 alone.
   - **Pass 3:** `--redo F1` on a fresh simulator. A24's log checks were all YES. Pass 2's A24 log NO came from the driver, which never closed the simulated classic window.
   - **Expected NOs:** without a Deck, every Deck-log check is NO and every budget is NOT MEASURED. Those lines are tested by Jim's run.
   - **Pass 4**, after Greptile review 1's nine fixes, on a fresh simulator:
     - all nine steps ran without an error, and the photo was back after every step;
     - E3 asked for the Mode through `get_prefs` and read Autonomous again at its end;
     - the copies were removed and the Deck's program restored.
4. **Not run by Claude Code:** anything on the real Deck in Lightroom. That is Jim's run (rule: "Lightroom-side results are Jim's observations").

## Observed (Jim)

### Run 1 (2026-10-07 02:45-03:11 UTC): stopped in E4

Evidence: `docs\reports\phase7\P7\run1\`. It holds the state, the summary, the plugin's log, the Deck's log `deck\hud_11208_1791341156930.jsonl`, the session logs and the engine's tool log. Photo: `20260907-_OZ80099.NEF`. Deck 0.3.1, plugin 0.18.0, engine 0.20.0. The analysis of the logs is Claude Code's.

- **E1-E3 finished.** E4 stopped with `3 copies of 20260907-_OZ80099.NEF are still in the catalog`.
- **Jim's NOs:** A19, A9 (screen modes), A9 (F with two monitors) and A21. The log checks A5 drag, A21 and copies removed were also NO.
- **Steps not reached:** E5, C1, C2, F1 and F2.
- **Put back:** the cleanup recorded no error, and the Mode was read back at Autonomous after E3.

**Jim's answers, after the run** [stated: Jim, 2026-10-07]:
1. "Copies are gone, that worked as expected. The Delete > Remove step worked fine."
2. "Dragging worked."
3. A19: "there was only one slider visible, the 'Vibrance' slider."
4. A9: the Deck was not visible over Lightroom "in the full screen mode (shift-f 3rd time)."
5. A second Enter after 3 and Enter: "Yes."
6. F with two monitors: "moved LrC to second monitor, then pressed F, actual behaviour was: Deck stayed on monitor 1, then when I pressed F for full screen it disappeared behind the image. So the deck hides behind the F full screen image both when LrC is on the same monitor or the second monitor."

**What the logs show:**
- **A19.** E1 asked A19 after the converging passes, when the Deck's rows showed only the last pass's change, Vibrance. The rows are the shown pass's changes (spec 7; the whole edit is E5, deferred). This was the check's mistake: the question now comes right after pass 1.
- **A9, F.** F's window (`NonActivateWindow`) covered 0,0, 3840×2160 in every F press. That includes 02:59:36 UTC, when Lightroom's main window was on the second monitor (x = 3866) [handle: the Deck log's `windows` lines]. The Deck stayed on the first monitor, so it went under F's image, as rule 1 says (spec 2.7 A9). The step asked Jim to drag the Deck to the other monitor. It now says to move the Deck rather than Lightroom, to the monitor without F's image.
- **A9, Shift+F full screen.** No foreground change is logged while Jim pressed Shift+F (02:58:50-02:59:12 UTC), so the Deck's rule 1 was never applied again. Why Lightroom's full-screen window covered the Deck is [unverified]. Deck 0.3.2 re-applies rule 1 on every 250 ms tick while Lightroom's main window is in front, and logs `on_top` each time it has to take the top back (`hud\src-tauri\src\window.rs` `keep_on_top`).
- **A21.** The Deck got four new states while Jim had another photo selected (seq 83-86, 03:06:57-03:08:04 UTC). The check waited for a stage `target_changed` that the Deck never gets: it draws "Target changed" from the state's `selection` (`hud\ui\view.ts` `bandOf`). The Deck's own drawing code shows the line in the pick state (`P7\run1\render-pick-target-changed-1800.png`; headless Edge, the harness in `docs\reports\phase7\deck-ui\renders.txt` plus one state with `selection.in_edit: false`). Why Jim saw no line is [unverified]: run 1 did not log what selection the engine sent. Deck 0.3.2 logs `in_edit` with each state, and the check also reads Lightroom's selection itself.
- **A5 drag.** No move, resize or `saved` line in the Deck's log during E2. The spot stayed 1020, 2088, 1800 px wide at E3's start. The same Deck saved Jim's drags in row 4b (35 `saved` lines, `docs\reports\phase7\deck-shell\`). E2 and E3 are asked again.
- **E4's end.** The Deck sent `hud_pick` C at 03:10:21 UTC, then `hud_accept` at 03:10:25 from the keyboard. After the pick, Accept is the Deck's primary button. Jim confirmed the second Enter, so the edit was accepted on copy C. The step now says to press Enter once.
- **Copies.** Lightroom answered both lookups of the three copies (plugin log 20:10:58 and 20:11:33 local, the same as 03:10:58 and 03:11:33 UTC). By then E4's edit had been accepted on copy C. Jim removed the copies; when they went relative to the lookups is [unverified]. The check now looks for up to 10 s after each Enter, asks up to three times, and says how many are left.

**Budgets, run 1:** all measured and within target.

| Budget | Measured | n |
|---|---|---|
| Cold start | 502 ms | 1 |
| Warm show p95 | 15 ms | 3 |
| Update to paint p95 | 13 ms | 223 |
| Click to userAction p95 | 1 ms | 6 |
| Memory, hidden | 116 MiB | 1 |
| CPU, hidden | 0.42 % | 1 |
| CPU, visible | 0.42 % | 1 |

**Next** [stated: Jim, 2026-10-07, "Go", to the fix plan]: branch `fix/phase7-check-run1`, which makes Deck 0.3.2 and fixes the check. After it merges, Jim runs `npm run phase7:check -- --redo E1,E2,E3`. That asks E1-E3 again, then goes on from E4.

### Run 2 (2026-10-07 04:04-04:42 and 11:15-11:17 UTC): every step ran

Evidence: `docs\reports\phase7\P7\run2\`. It holds the state (`p7_state.json`, last written by the re-run below), the summary, the plugin's logs, the Deck's logs (`deck\`), the session logs (`sessions\`), the engine's tool logs and Claude Desktop's chat session logs (`chat_sessions\`, copied from the repo's gitignored `logs\`). User paths read `%USERPROFILE%`. Files the same as in `run1\` are not copied again. Photo: `20260907-_OZ80099.NEF` (uuid `CF12AF60-…`). Deck 0.3.2, plugin 0.18.0, engine 0.20.0. Jim ran `npm run phase7:check -- --redo E1,E2,E3`. The analysis of the logs is Claude Code's.

- **Steps:** E1-E4 ran 04:04-04:34 UTC, E5 at 04:35, C1 at 04:36-04:42. Jim rebooted, and C2, F1 and F2 ran at 11:15-11:17 UTC.
- **Lines:** every line A1-A24 (no A20) was YES, log checks and Jim's answers alike [handle: Jim's run, recorded in vault `LrC_AVG_STATE.md` 2026-10-07 "Jim's run 2 finished every step"; the re-run replaced the E5 and C1 answers in `p7_state.json`].
- **Run 1's NOs, answered again:** A19 asked after pass 1, A9 screen modes, A9 F with two monitors, A21 and the A5 drag were all YES (`p7_state.json` `A19.jim`, `A9.modes.jim`, `A9.f.jim`, `A9.f2.jim`, `A21.log`, `A21.jim`, `A5.drag.log`).
- **Headline:** FAILED, only on cleanup. `back.E5` and `back.C1` were NO: the snapshot apply after E5 and after C1 changed nothing while Lightroom was in Library [handle: `docs\reports\phase7\snapshot-library\timeline.txt`]. The photo was put back at the start of the next run, once Jim pressed D (`back.C2`, `back.F1`, `back.F2` YES).
- **Fix:** PR #93 (`aaa9808`), plugin 0.18.1. It switches Lightroom to Develop before every snapshot apply.

### Re-run of E5 and C1 (2026-10-07 11:57-12:02 UTC, plugin 0.18.1)

Jim followed "Steps for Jim: re-run of E5 and C1", starting in Library, and said "done".

- **The fix works in Lightroom:** `plugin-log_2026-10-07T11-57-13-828Z.txt` "04:57:58.998 INFO develop: switched from library to develop in 0 ms" (local time, 11:57:58 UTC). `back.E5` YES at 11:58:03 UTC and `back.C1` YES at 12:01:54 UTC (`p7_state.json`).
- **C1:** Claude's edit (session `20261007-c8443a`, `chat_sessions\20261007-c8443a.json`) began 11:58:46 UTC. The Deck showed 591.7 ms later with no classic window (`A1.chat.log`); it never took the foreground (`A3.log`, `deck_foreground` 0). Claude accepted at pass 1 of 8.
- **Headline:** `Phase 7 acceptance: FAILED (A8 NO)` (`p7_summary.json`). Every other line, cleanup included, is YES.

**A8, what the logs show** (Deck log `deck\hud_25528_1791374326853.jsonl`, times UTC):

| Time | Deck log |
|---|---|
| 11:58:46.971 | `show` `edit_start` |
| 12:00:52.901 | state `accepted` |
| 12:01:02.945 | `hide` `edit_end` (A12: the Deck hides about 10 s after the end, `A12.hid` 10 389 ms in E1) |
| 12:01:04.3-12:01:29.8 | four `foreground` lines: explorer, claude, Code, explorer, all `front:false`; none for Lightroom (pid 25260) |

- The A8 question came after `A3.jim` (12:01:13), so the Deck was already hidden for the whole step. Jim [stated: 2026-10-07]: "the hud closed automatically when Claude was done".
- `A8.log` looks for a `front:true` line after a `front:false` one (`hud\probe\check\chats.ts:105-108`). None came before it was recorded at 12:01:33.6. Why no Lightroom foreground was logged is [unverified]: the record was taken 3.7 s after the last line.
- **Run 2's A8 had the same timing.** Its YES came from a Lightroom `front:true` line at 04:42:29.3 while the Deck was hidden (hidden at 04:41:44.6 `edit_end`; `deck\hud_33968_1791347810008.jsonl`).
- **The rule while the Deck was shown:** during run 2's chat edit (session `20261006-96b19e`, 04:36:49-04:41:34), the Deck logged the foreground moving between Lightroom (`front:true`) and Claude Desktop (`front:false`) six times, 04:38:34-04:41:36 (`deck\hud_33968_…jsonl`). Nobody was asked what the screen showed then.
- **Rule 1 seen by Jim:** row 4b's line R1, "Another window in front covers the Deck", was YES (`docs\reports\phase7\deck-shell.md` "Numbers"). Rule 1 does not depend on which program is in front (`hud\src-tauri\src\window.rs` `topmost_for`), so R1 covers Claude Desktop [inference].
- **Decision** [stated: Jim, 2026-10-07, "Go with recommendations", option A]: A8 is accepted on R1, run 2's foreground lines while the Deck was shown, and Jim's YES in both runs. The check's flaw (A8 asked after the Deck hides) is carried below.

## Numbers

From `P7\run2\p7_summary.json` (runs 2 and 3 together) and `p7_state.json`.

| Line | Result | Checks |
|---|---|---|
| A1 | YES | `A1.e1.shown` 688 ms, `A1.e1.classic`, `A1.e1.jim`; chat: `A1.chat.log` 592 ms, `A1.chat.jim` |
| A2 | YES | `A2.log` (Deck foreground 0), `A2.jim` |
| A3 | YES | `A3.log` (Deck foreground 0), `A3.jim` |
| A4 | YES | `A4.log` (2 passes), `A4.jim` |
| A5 | YES | `A5.drag.log` (saved 3933, 1957, 1800), `A5.there.log`, `A5.there.jim`, `A5.fallback.log`, `A5.fallback.jim` |
| A6 | YES | `A6.log` (Deck shown, Desktop's engine gone), `A6.jim` |
| A7 | YES | `A7.move.jim`, `A7.min.log` (hide on minimise, show on restore), `A7.min.jim` |
| A8 | accepted by Jim (check NO) | `A8.log` NO (Deck hidden, see above), `A8.jim` YES |
| A9 | YES | `A9.modes.jim`, `A9.f.jim`, `A9.f2.jim` |
| A10 | YES | `A10.log` (Deck closed 126 ms after Lightroom quit), `A10.jim` |
| A11 | YES | `A11.jim`, `A11.enter.log` (keyboard) |
| A12 | YES | `A12.ended` (accept from the Deck), `A12.hid` 10 389 ms, `A12.jim`, `A12.hid.jim` |
| A13 | YES | `A13.back` (aborted, 0 differing), `A13.jim`, `A13.snapshot.jim` |
| A14 | YES | `A14.arm.jim`, `A14.abort.log`, `A14.abort.jim` |
| A15 | YES | `A15.open.log`, `A15.jim` |
| A16 | YES | `A16.log` (click to answer 6.5 ms), `A16.jim` |
| A17 | YES | `A17.cards.jim`, `A17.click.log`, `A17.click.jim`, `A17.keys.log` (C, keyboard), `A17.picked.log`, `A17.picked.jim` |
| A18 | YES | `A18.jim` |
| A19 | YES | `A19.jim` |
| A21 | YES | `A21.log` (Deck `in_edit` false after 15.2 s; Lightroom's selection not in the edit), `A21.jim` |
| A22 | YES | `A22.jim` |
| A23 | YES | `A23.jim` |
| A24 | YES | `A24.log`, `A24.abort.log`, `A24.jim` |
| cleanup | YES | `back.E1`-`back.F2`, `copies.removed`, `deck.restored` |

| Budget (spec 9) | Target | Measured | n |
|---|---|---|---|
| Cold start | ≤ 1500 ms | 590 ms (max) | 5 |
| Warm show | ≤ 150 ms p95 | 16 ms | 5 |
| Update to paint | ≤ 100 ms p95 | 13 ms | 595 |
| Click to userAction | ≤ 50 ms p95 | 8 ms | 11 |
| Idle memory, process tree | ≤ 150 MiB | 112 MiB | 1 |
| CPU hidden / visible | ≤ 0.5 % / ≤ 2 % | 0.23 % / 0.42 % | 1 / 1 |

## Verdict

**Go** [stated: Jim, 2026-10-07, "Go (Recommended)"]. Phase 7 is accepted on the Deck: every line A1-A24 (no A20) is YES or accepted (A8), cleanup is YES after the Library fix, and every spec 9 budget is measured within its target. The check's headline (`FAILED (A8 NO)`) was a suggestion; its cause is the check's timing, above.

## Consequences / open questions

- **Library put-backs:** fixed by PR #93 (plugin 0.18.1) and seen working in Lightroom in the re-run (above).
- **A8 in the check:** `chats.ts` asks A8 after Claude's edit has ended, when the Deck has hidden itself. If the check runs again, ask A8 while the edit is open. Carried, not fixed [stated: Jim, 2026-10-07, "Go with recommendations"].
- **A9 Shift+F (run 1):** YES in run 2 with Deck 0.3.2, which re-applies rule 1 every tick. Why Lightroom's full-screen window covered Deck 0.3.1 stays [unverified].
- **A21 (run 1):** YES in run 2. Why Jim saw no line in run 1 stays [unverified].
- Stays [unverified] after this check:
  - a Deck before 0.3.0 with plugin 0.18.0;
  - the Show menu item while the engine is away.
- F with the Deck on another monitor: Jim has two monitors and `A9.f2.jim` was YES in run 2.
- Q9 (hide outside Develop / Lights Out) stays open: no line in this check showed a need (PHASE7_PLAN "Deferred").
