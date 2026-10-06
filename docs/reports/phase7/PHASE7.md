---
report: AVG-P7 Phase 7 acceptance on the Deck
phase: 7
status: template
authored_by: "Template, harness and pre-run findings: Claude Code (Opus 5.5), 2026-10-06, branch phase-7/check (vault PHASE7_PLAN row 6). Observed: Jim's run and answers. Verdict: Jim."
date: 2026-10-06
---

# AVG-P7: Phase 7 acceptance on the Deck

## Purpose

Phase 7 built the Deck, a free-floating HUD window for Lightroom (spec `docs\hud\lrc-avg-hud-spec-v2.md` section 2.7). This check is Jim's acceptance of it in real edits on his machine:
- the lines of spec 11.1 as 2.7 amends them, A1-A24 without A20 (Whole edit, deferred with E5);
- the section 9 budgets, measured on the built Deck.

The phase rule, PHASES.md "Phase 7", quoted: "Acceptance (spec section 11): the S9 gates S9-1 to S9-11 pass; A1-A24 checked by Jim in full on C, and on placement, forms and keyboard focus for A and B; the spec 11.2 simulator tests pass; the section 9 budgets are measured." The re-plan narrows it to the Deck (layout C) [stated: Jim, 2026-10-05, "Defer development of all of the HUDs except for the detached deck"]: vault PHASE7_PLAN.md "Acceptance".

The plan for this row [stated: Jim, 2026-10-06, "go", to the recommendations]:
- D1 A: scripted edits for most lines, plus two Claude Desktop chats for the lines that name Claude Desktop (A1, A3, A6, A8).
- D2 A: the Deck logs `got` and `painted` for each state (hud 0.3.1), so all six budgets are measured.
- D3 A: for A24 the check renames the Deck's program and gives it its name back.
- D4: Jim answers y/n in PowerShell.

**How a line passes.** Each line passes only when Jim answers y. Where the logs can show the same thing, a log check sits beside his answer, and the line needs both. "Acceptance: WORKED" needs every line YES, the photo put back after every step, and every budget measured. A budget over its target is named in the headline. Whether that blocks Phase 7 is Jim's verdict.

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
  - The check resumes where it stopped: finished steps are skipped. `npm run phase7:check -- --new` starts over, and `npm run phase7:check -- --redo E3` runs one step again.
  - F2 runs only when every other step has finished, because nothing can be put back after Lightroom quits.
  - A run stopped with Ctrl+C, or killed, puts back the photo, the Deck's program name and its `window.json` first: at its end, or else at the next start.
- **The Deck.** The check installs Deck 0.3.1 at its start. The Deck stays installed.
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

   It builds, installs the Deck 0.3.1 and says `The check's photo: 20260907-_OZ80093.NEF.`
4. Follow the window, step by step. Each instruction ends with `Press Enter when done.` or `Type y or n, then Enter:`, or says `(The check sees it; nothing to type here.)`. Answer y only when what the question describes happened.
5. **Chat 1.** When the window says `Chat 1`, do the five numbered steps it prints in Claude Desktop. The chat sentence is `Tune the active photo for golden hour landscape.`. Afterwards, leave Claude Desktop open while the check waits for the bridge (up to 2½ minutes).
6. **Chat 2.** Open a new chat with the same sentence. As soon as the Deck appears, quit Claude Desktop from its tray icon (right-click > Quit), then answer the question.
7. **Last step.** When the window says `Now quit Lightroom`, choose File > Exit in Lightroom. If Lightroom asks to back up its catalog, answer as you usually do. Then answer the last question.
8. The last lines say `Phase 7 acceptance: WORKED` or `FAILED (…)`, then `Every step has run.` and `Results saved automatically`. Tell Claude Code "done".

### If something goes wrong

- If it says Lightroom is not running, open Lightroom in Develop and run the command again.
- If it says Claude Desktop's engine is running, or another engine holds the bridge, quit Claude Desktop from its tray icon, wait a minute, and run the command again.
- If it says to select exactly one photo, do step 2 and run the command again.
- If it says the settings page's Mode is not Autonomous, set it (File > Plug-in Manager > LrC-AVG > Sessions > Mode: Autonomous > Done) and run the command again. It goes on from the step that stopped.
- If it says `ERROR in <step>`, the run stops there and puts the photo back. Tell Claude Code the error line before you run it again.
- If you need to stop, press Ctrl+C: the check puts things back and saves what it has. Run the command again later to go on.
- If the last lines say `put_back` in an error, tell Claude Code before you edit that photo.

## Pre-run findings (Claude Code)

1. **Tests and builds** (2026-10-06, branch `phase-7/check`):
   - `npm test`: 83 files, 1069 passed, 1 skipped.
   - `npm test -w hud`: 7 files, 51 passed (the 12 new ones in `hud\probe\check\summary.test.ts` and `budgets.test.ts`), plus cargo test, 5 passed.
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
4. **Not run by Claude Code:** anything on the real Deck in Lightroom. That is Jim's run (rule: "Lightroom-side results are Jim's observations").

## Observed (Jim)

*(Jim's run: the check's output and answers, collected by Claude Code into `docs\reports\phase7\P7\`.)*

## Numbers

| Line | Result | Checks |
|---|---|---|
| A1-A24 (no A20) | | |

| Budget (spec 9) | Target | Measured | n |
|---|---|---|---|
| Cold start | ≤ 1500 ms | | |
| Warm show | ≤ 150 ms p95 | | |
| Update to paint | ≤ 100 ms p95 | | |
| Click to userAction | ≤ 50 ms p95 | | |
| Idle memory, process tree | ≤ 150 MiB | | |
| CPU hidden / visible | ≤ 0.5 % / ≤ 2 % | | |

## Verdict

*(Jim's: go / conditional / no-go. The check's headline is a suggestion.)*

## Consequences / open questions

- Stays [unverified] after this check unless a line shows it:
  - a Deck before 0.3.0 with plugin 0.18.0;
  - the Show menu item while the engine is away;
  - F with the Deck on another monitor, if only one monitor is connected (vault PHASE7_PLAN "From row 4b", "From row 5").
- Q9 (hide outside Develop / Lights Out) stays open unless this run shows a need (PHASE7_PLAN "Deferred").
