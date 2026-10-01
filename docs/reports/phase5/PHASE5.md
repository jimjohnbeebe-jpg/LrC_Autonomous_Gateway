---
report: Phase 5 — HUD and Plugin Manager settings
phase: 5
status: template
authored_by: "Template, harness and pre-run findings: Claude Code (Opus 5.5), 2026-09-30 (PHASE5_PLAN row 7). Observed: Jim (to fill). Numbers, Consequences: Claude Code from the run's files (PHASE5_PLAN row 8). Verdict: Jim."
date: 2026-09-30 (template)
---

# Phase 5 — HUD and Plugin Manager settings

## Purpose

Does Phase 5 work in Lightroom and Claude Desktop? The settings page, the HUD with its buttons and menu items, Abort, Approve each pass, and AC-1's golden-hour chats with the HUD on all six fixtures.

PHASES.md Phase 5, quoted (vault `PHASES.md`, "Phase 5 — HUD and Plugin Manager settings"):
- "Settings page with every PRD §6.2 field, stored in `LrPrefs`, read by the engine via `get_settings`." (The bridge command became `get_prefs`: PHASE5_PLAN decision 2f.)
- "HUD per PRD §6.3 with Abort / Accept / Pick / Approve wired to events."
- "Acceptance: AC-2 via the HUD button; `approve_each_pass` mode blocks `lr_step` until the button is pressed."
- Inputs from Phase 3: "Acceptance adds AC-1's remaining parts: 'with the HUD tracking stages', and the golden-hour chat reproducible on all six fixtures (Phase 3 ran it on one)."
- Inputs from Phase 4: "Acceptance adds AC-3's HUD pick"; "A check that asks Jim to click in Lightroom reads back, right after the click, the original and every photo it knows, and names any that changed."

PRD section 10, quoted (vault `PRD.md`, "Acceptance criteria"):
- "AC-1 From Claude Desktop chat: 'tune the active photo for golden hour landscape' produces ≤ 4 passes, each visible as a History step, with the HUD tracking stages, and ends with settings visible on the Develop sliders. Reproducible on all six fixtures."
- "AC-2 Abort from the HUD mid-session restores the pre-session snapshot within 1 s."
- "AC-3 Variants mode creates three virtual copies with visibly different looks; picking one in the HUD continues convergence on it."
- "AC-4 No pass leaves highlight clip > 0.5 % or shadow crush > 1 % unless the intent overrides."

PHASES.md gives Phase 5 no go / conditional / no-go rule beyond its acceptance lines.

**PHASE5_PLAN row 7's inputs** (vault `PHASE5_PLAN.md`, "From row 3" to "From row 6"): a setting changed on the page reaching the engine; a Plug-in Manager visit during an open session (the 60 s allowance for a long pause is [unverified] in Lightroom after row 5's ~3 s pause); the HUD's lines in the plugin's log; AC-2 timed from the click; `approve_each_pass` blocking, a wait in vain and an Abort during a wait; how long a waiting `lr_step` held in Claude Desktop (its timeout is [unverified]).

**Jim's decisions on the row 7 plan (2026-09-30)** [stated: "Go with recommendations"]:
- **D1:** Part 1 runs on `20260907-_OZ80093.NEF`. Its pass 0 needed no baseline correction in Phase 3, where `20260907-_OZ80099.NEF` needed three [handle: `docs\reports\phase3\P3\p3_check_2026-09-27T14-00-37-507Z.json`, `fixtures[4]` and `fixtures[5]` `session_a.pass0.history_names`].
- **D2:** after each chat the check puts the photo back itself. It waits for Claude Desktop's engine to give the bridge back, which it does 60 s after its last tool call once no session is open [handle: `engine\src\mcp\main.ts` `IDLE_RELEASE_MS`; `engine\src\mcp\bridge-gate.ts` `endUse`/`armIdle`]; else it asks Jim to quit Claude Desktop.
- **D3:** the wait in vain is the real 60 s (`APPROVAL_WAIT_MS`), the value that ships.
- **D4:** an approve chat measures Claude Desktop's hold on a waiting call.

**How the check asks Jim:** y/n questions in the PowerShell window, as in Phases 1-4. The row 7 plan said so and Jim approved it [stated: Jim, 2026-09-30, "Go with recommendations"] (rule 04 lets Jim choose this per check).

## Harness

| Part | Files |
|---|---|
| The check | `engine\src\devtools\phase5-check.ts` (the parts, the summary), `phase5-check-cli.ts` (`npm run phase5:check`), `phase5-config.ts` (fixed values), `phase5-state.ts` (resume) |
| Part 1 | `phase5-part1.ts`, `phase5-session-a.ts` (HUD, stages, AC-2), `phase5-pause.ts` (Plug-in Manager), `phase5-session-b.ts` (approve), `phase5-session-c.ts` (AC-3, HUD Pick), `phase5-menu.ts`, `phase5-page.ts`, `phase5-ended.ts`, `phase5-readback.ts`, `phase5-trace.ts` |
| Part 2 | `phase5-chats.ts`, `phase5-chat-flow.ts`, `phase5-chat-eval.ts`; shared: `clip-check.ts` (AC-4), `phase2-collect.ts` (the chats' logs) |
| Tests | `engine\tests\phase5-check.test.ts`, `phase5-check-faults.test.ts`, `phase5-check-units.test.ts`, with `engine\tests\helpers\phase5-harness.ts` and `phase5-sim-jim.ts` |

**What `npm run phase5:check` is written to do.** This describes the code [handle: `engine\src\devtools\phase5-check.ts` header and `runPhase5Check`]. Before Jim's run it ran only against the simulated plugin (see "Pre-run findings").

The check's engine is wired as the MCP server's is [handle: `engine\src\devtools\phase5-check-cli.ts` `main`; `engine\src\mcp\main.ts`]: it reads the settings page (`PageSettings`), and while a session is open it allows 60 s of plugin silence (`SESSION_SILENCE_MS`).

*Part 1*, scripted through the same `Tools` class the MCP server uses, on `20260907-_OZ80093.NEF`. The check holds the bridge, and Jim clicks in the HUD and the menu when asked:
0. Jim clicks the photo. The settings page must read Mode "Autonomous" and 4 passes; if not, the check gives the steps to set it.
1. **Session A** (Autonomous):
   - The HUD should open by itself (the plugin's `hud: shown` line).
   - Pass 1.
   - **The Plug-in Manager visit.** Jim opens Plug-in Manager, sets Mode to "Approve each pass", counts to 20 and clicks Done. At the first unanswered ping the check sends pass 2, and pings until the plugin answers again. It records the silence, the bridge drops and whether pass 2 finished.
   - **AC-2:** Jim clicks Abort in the HUD. The time runs from the plugin's `hud: hud_abort <click_id> … sent` line to the photo back (the session log's `ended_by.received` plus `done_ms`). The photo is read back against its start.
   - The stages the check's engine sent are recorded (`phase5-trace.ts`). Questions 1-3: the HUD opened by itself; its Stage line followed the work; the "Aborted" note, then the HUD closed itself.
2. **Session B** (Approve each pass):
   - The begin's `session_settings` must give the mode with the source "page".
   - Pass 1 (never gated).
   - Pass 2's `lr_step` waits until Jim clicks "Approve pass 1"; the result's `approval` is by "hud", with how long it waited.
   - Pass 3, no click: after 60 s `AWAITING_APPROVAL`, recoverable, and the read-back finds nothing written.
   - Pass 3 again: Jim clicks Abort while it waits. `SESSION_ENDED` at once, the photo exactly back, `ended_by.interrupted` naming the wait.
   - Question 4.
3. **Session C** (Variants, still Approve each pass):
   - Three copies with pass 0 each, then a refined pass on each.
   - The check selects each copy for Jim to look at. Question 5: visibly different?
   - Jim clicks Pick in the HUD. The check's next pass goes to the pick with no Approve: the pick approves its pass (row 6, D1-A). The result's `hud_actions` names the HUD's pick.
   - Jim clicks Accept in the HUD.
   - Checked from the log and recipe: the pick, the passes on it, the recipe's photo, and the original unchanged.
4. **The menu items:**
   - Session D: Accept Session (outcome accept from the menu); then the check puts the photo back with the session's snapshot.
   - Show Vision Gateway HUD, after the HUD closed itself (a new `hud: shown` line).
   - Session E: Abort Session (aborted from the menu, the photo exactly back, the time recorded).
5. Jim removes session C's copies; the check looks each one up by uuid. The photo is compared with its start.

**After each of Jim's clicks** (Phase 4 input), the check reads back every photo it knows. A photo given an expected state must hold it; any other photo that changed is named and fails the check (`phase5-readback.ts`).

*Part 2*, the chats in Claude Desktop. The check hands Claude Desktop the bridge for each chat and takes it back after:
- **Before each chat:**
  - Jim clicks the chat's photo.
  - The check reads the photo's settings and takes its own snapshot of it, "AVG P5check before <chat>".
  - It saves both in the state file, so a run that stops mid-chat puts the photo back first on the next run.
- **After each chat**, the check:
  - reads the chat's tool log and session log;
  - waits for the bridge (up to 150 s, D2);
  - reads back every photo it knows;
  - puts the photo back with its snapshot, and reads it back against the start.
- **The approve chat** runs on `20260907-_OZ80093.NEF` with the page on "Approve each pass".
  - Jim lets pass 1's Approve wait run out, then approves, and approves each later pass.
  - Recorded, not an acceptance line: the longest waiting `lr_step` (engine side); Claude Desktop's error or time-out lines; questions about Claude saying it was waiting, and going on after the Approve.
- **Then the page goes back to "Autonomous"**, and the **six golden-hour chats** follow, one per fixture (`phase3-config.ts` `FIXTURES`). Each chat must show, from its logs:
  - a session on that photo with `landscape_golden_hour`;
  - 1-4 passes, accepted;
  - the HUD shown (the tool log's first-taken `hud_update`);
  - Autonomous mode;
  - this engine's version;
  - AC-4 on every pass.
- In each chat Jim answers four questions: History steps, the HUD, the sliders, the look.
- A chat that did not pass may be held once more, at Jim's choice.

**The check resumes.** After Part 1, the approve chat, the page and each chat, it saves what it found in `%TEMP%\LrC-AVG\P5\p5_state.json`. Run again, it continues where it stopped; `npm run phase5:check -- --new` starts over. A Part 1 that failed stops the check before the chats, and the next run repeats Part 1.

The headline `Phase 5 acceptance: WORKED / FAILED / NOT FINISHED` covers:
- the settings page reaching the engine;
- the session riding out Plug-in Manager;
- the HUD tracking stages (Part 1 and every chat);
- AC-2 via the HUD's Abort;
- `approve_each_pass` blocking until Approve;
- AC-3 with the HUD's Pick;
- the menu items;
- AC-1 (six chats);
- AC-4 on every pass of every session;
- no photo changed unexpectedly;
- every photo put back.

Recorded without deciding it: the approve chat (D4) and the timings.

Results go to `%TEMP%\LrC-AVG\P5\`:
- `p5_state.json`;
- `p5_check_<time>.json` (one per run);
- `p5_sessions_<time>\`;
- `p5_check_tools_<time>\`;
- `p5_desktop_mcp_log_<time>_<chat>.txt`, `p5_chat_tool_log_<time>_<chat>.jsonl`;
- `p5_bridge_log_<time>.txt`.

Claude Code collects them.

### Steps for Jim

Do these after Claude Code says the `phase-5/check` PR is merged. Allow about 50 minutes [inference: Part 1 about 15-20 minutes, including two 60 s waits; the approve chat about 5; each golden-hour chat about 4, including up to 2½ minutes while Claude Desktop gives the bridge back]. You can stop between chats (see "If something goes wrong").

1. Right-click the Claude icon in the Windows system tray → **Quit**.
2. In Lightroom Classic, in the **Library** module's **Folders** panel (left side), click the `fixtures` folder, so the six fixtures show in the Filmstrip. Press **D** to open the Develop module.
3. In VS Code's PowerShell terminal, at `D:\Developer\LrC_Autonomous_Gateway`, run:

   ```powershell
   npm run phase5:check
   ```

   You should see `Connected (… ms, plugin 0.6.1)`.
4. It asks you to click `20260907-_OZ80093.NEF`. Click it in the Filmstrip (the original, without a turned-page corner), then press Enter.
5. **Session A.** The HUD (the window titled "LrC-AVG - Vision Gateway") opens by itself. Watch its Stage line.
6. When it says `Now a visit to Plug-in Manager`:
   1. In Lightroom: **File > Plug-in Manager**.
   2. In the list on the left, click **LrC-AVG (Autonomous Vision Gateway)**.
   3. In the **Sessions** box, set **Mode** to **Approve each pass**.
   4. Count slowly to 20, then click **Done**.
   5. Press Enter in the terminal.
7. When it says `Now click Abort in the HUD`, click **Abort** in the HUD. A few seconds later it asks questions 1-3: type `y` or `n` and press Enter for each.
8. **Session B.** When it says `Wait about 10 seconds, then click "Approve pass 1"`, wait about 10 seconds, then click **Approve pass 1** in the HUD.
9. When it says `Now do NOT click anything in the HUD for 60 seconds`, keep your hands off the HUD for that minute.
10. When it says `This time click Abort in the HUD (not Approve)`, click **Abort** in the HUD. Then answer question 4.
11. **Session C.** It says `Lightroom now shows copy A …`: look at the photo, then press Enter. Do the same for copies B and C, then answer question 5.
12. When it says `"Pick A", "Pick B" and "Pick C" are now on`, click the **Pick** button for the copy you liked best. When it says `Now click Accept in the HUD`, click **Accept**.
13. **The menu items.** Each time it names one, choose it from Lightroom's menu:
    1. `File > Plug-in Extras > LrC-AVG - Accept Session`.
    2. When the HUD has closed by itself, `File > Plug-in Extras > LrC-AVG - Show Vision Gateway HUD`.
    3. `File > Plug-in Extras > LrC-AVG - Abort Session`.
14. It asks you to remove session C's three copies:
    1. Press **G** for the Library Grid.
    2. Click the first copy next to `20260907-_OZ80093.NEF` (each copy has a turned-page corner), then Ctrl-click the others. Do not select the original.
    3. Press **Delete** and click **Remove**.
    4. Press **D**, then Enter in the terminal.
15. **The approve chat.** It asks you to click `20260907-_OZ80093.NEF`: click it, then press Enter. Then:
    1. Start Claude Desktop (Start menu > Claude).
    2. Open a new chat, type `Tune the active photo for golden hour landscape.` and press Enter.
    3. If Claude Desktop asks whether Claude may use an lrc-avg tool, choose **Always allow**.
    4. After Claude's pass 1, the HUD's button reads **Approve pass 1**. Do **not** click it yet. Wait until Claude's answer says pass 1 is waiting for your approval (about one minute).
    5. Then click **Approve pass 1** in the HUD, and type in the chat: `Approved, go on.`
    6. For each later pass, click the HUD's Approve button when it lights up.
    7. When Claude says it has finished and ended the session, press Enter in the terminal and answer its two questions.
16. It says `Waiting for Claude Desktop to give the Lightroom bridge back`. Leave Claude Desktop open and wait (up to 2½ minutes).
17. It asks you to set the settings page back to **Autonomous**. Do the steps it prints (Plug-in Manager, **Mode: Autonomous**, Done), then press Enter.
18. **Six chats, one per photo.** For each, the terminal names the photo:
    1. Click that photo in the Filmstrip, then press Enter.
    2. In Claude Desktop, open a **new** chat, type `Tune the active photo for golden hour landscape.` and press Enter.
    3. Watch the HUD while Claude works.
    4. When Claude says it has finished and ended the session, press Enter in the terminal and answer the four questions.
    5. Wait while it takes the bridge back and puts the photo back (up to 2½ minutes).
19. The last lines say `Phase 5 acceptance: WORKED` or `FAILED` and `Results saved automatically`. Tell Claude Code "done".

The HUD's labels and the menu titles are the plugin's own [handle: `plugin\LrC-AVG.lrplugin\HudView.lua`, `Info.lua`]. The settings page's labels are `PluginInfoProvider.lua`'s. The Library dialogs' words are described from Lightroom's usual behaviour [unverified]; the check confirms each removal by uuid.

### If something goes wrong

- If the command prints `another LrC-AVG engine is using the Lightroom bridge`, Claude Desktop is still running: do step 1 again, then step 3.
- If it prints `could not connect to Lightroom`, check that Lightroom is open and that **File > Plug-in Manager** lists LrC-AVG as **Enabled**, then run step 3 again.
- If it prints `not 0.6.1 or later`, quit Lightroom, start it again, and run step 3 again.
- If it prints `The settings page reads …; this part needs …`, do the steps it prints, then press Enter.
- If you have to stop before the end, stop only at a `Come back to this window and press Enter` line. Close the terminal there. Later, run `npm run phase5:check` again: it puts that chat's photo back first and goes on with that chat.
- If it prints `Part 1 did not pass`, tell Claude Code; the next run repeats Part 1.
- If it says `Claude Desktop still holds the bridge`, quit Claude Desktop (tray icon > **Quit**) and press Enter. Start Claude Desktop again at the next chat.
- If a chat did not pass, it asks `Hold the chat on … once more?`. Type `y` to hold it again (a new chat in Claude Desktop), or `n` to go on.
- If it prints `FAILED: …`, let the command carry on and tell Claude Code what the line says. Each session is ended with revert when something fails, and each photo is put back [handle: `engine\tests\phase5-check-faults.test.ts`; in Lightroom [unverified]].
- If the Delete dialog in step 14 offers **Delete from Disk**, click **Cancel**: the original is selected too. Select only the copies and try again.
- If Claude says it has no Lightroom or lrc-avg tools, finish the chat's questions (answer `n`) and tell Claude Code.
- If Lightroom shows an error dialog, click OK and tell Claude Code.

## Pre-run findings (Claude Code)

Checks Claude Code ran on 2026-09-30, before Jim's run. None of them involves Lightroom or Claude Desktop.

- **Engine tests: 774 pass, 1 skipped** on the code of commit `afe4580` (branch `phase-5/check`) [handle: `npm test` in `engine\`, 2026-09-30 19:57-20:06 local: "Tests 775 passed | 1 skipped (776)", of which one is the scratch dry-run file below, since deleted]. `npm run build` and `npm run typecheck` pass too. The tests run against the fake plugin and the **simulated Lightroom** (`engine\tests\helpers\lightroom-sim.ts`, "tonal" model), with simulated Jim (`phase5-sim-jim.ts`): **Node numbers, not Lightroom's.**
  - `phase5-check.test.ts`:
    - the whole check: `Phase 5 acceptance: WORKED`, every line YES, the copies removed;
    - a run stopped at chat 3, run again: the stopped chat's photo put back first with the check's snapshot, Part 1 not repeated, then WORKED;
    - `--new` starts over and still puts back the photo of the chat it found under way.
  - `phase5-check-faults.test.ts`, each failure printed as FAILED:
    - no Abort from the HUD: AC-2 fails, the session is ended with revert, Part 1 fails, and the chats are not started;
    - the photo back after 1.5 s: AC-2 fails;
    - Mode left unchanged: session B is skipped;
    - Lightroom never pauses: the Plug-in Manager line fails;
    - no Approve: approve fails, and the photo is put back;
    - no Accept in session C: the check ends the session, and the menu items still run;
    - a Pick that also changed the original: the read-back names it;
    - a chat with no pass: AC-1 fails, and the other chats go on.
  - Also in `phase5-check-faults.test.ts`, without failing the check:
    - Claude Desktop keeps the bridge: you are asked to quit it, and the check goes on;
    - a chat held once more and counted on its second try;
    - an approve chat that did not go as planned, recorded only.
  - `phase5-check-units.test.ts`:
    - a chat judged from its tool log;
    - the state file (resume, `--new`, an unreadable file set aside);
    - the plugin log's times and click lines;
    - the stage trace.
- **Mutation check:** a scratch script broke nine guards one at a time, in `phase5-readback`, `-session-a`, `-chat-flow` (×2), `-state`, `-chat-eval`, `-session-c`, `-check` and `-page`. Each was caught by its named test, and every file was restored [handle: Claude Code, 2026-09-30, the scratchpad script `mutants.mts`: "9 of 9 killed"; `git status` clean afterwards].
- **Dry run of `npm run phase5:check` itself.** The built command ran against the simulated plugin on scratch ports with its own token file, so Jim's Lightroom was not touched. The real `engine\dist\mcp\main.js` played Claude Desktop: one process for all seven chats, as Desktop keeps its engine. Results [handle: `docs\reports\phase5\check-dryrun\dryrun.txt`, transcript and driver]:
  - `Phase 5 acceptance: WORKED`, exit code 0.
  - The plugin was silent 11.2 s during the Plug-in Manager visit, with 0 bridge drops: the session's 60 s allowance held in the command's own wiring.
  - The 60 s wait in vain came back `AWAITING_APPROVAL`, with nothing written.
  - The approve chat's waiting `lr_step` took 60.0 s.
  - After all seven chats, the check took the bridge back by the engine's own 60 s idle release.
  - Each chat's photo was put back exactly. `%TEMP%\LrC-AVG\P5` was not created (the dry run's folders pointed elsewhere).
- **Worth knowing before the run:**
  - The MCP TypeScript SDK's default request timeout is 60 s [handle: `node_modules\@modelcontextprotocol\sdk\dist\esm\shared\protocol.js:8`, SDK 1.30.1], equal to `APPROVAL_WAIT_MS`.
  - Claude Desktop completed a 73.6 s tool call in Phase 4 [handle: vault ARCHITECTURE.md section 6, "Phase 4"], so it likely does not cut calls at 60 s [inference]. The approve chat is what records it.
- **Not yet run inside Lightroom or Claude Desktop** [unverified until Jim's run]:
  - the HUD's buttons and menu items acting on the engine's sessions;
  - Plug-in Manager's pause during a session;
  - the page's mode reaching a session;
  - Approve with a real click;
  - Claude Desktop's engine giving the bridge back after a chat (D2);
  - Claude Desktop's hold on a waiting call (D4);
  - AC-1 on all six fixtures with the HUD.

## Observed (Jim)

(Jim's run: to fill.)

## Numbers

| Line | Value | Handle |
|---|---|---|
| Settings page reached the engine (session B `session_settings`) | | |
| Plug-in Manager pause: silence, drops, pass 2 | | |
| HUD opened by itself; stages (session A) | | |
| AC-2, HUD Abort: click → photo back, settings differing | | |
| AC-2, Abort while pass 3 waited | | |
| Approve: pass 2 waited, by | | |
| Wait in vain: code, waited, nothing written | | |
| AC-3, HUD Pick: pick, next pass, approval, Accept, original | | |
| Menu items: Accept, Show HUD, Abort (time) | | |
| Read-backs: count, unexpected changes | | |
| AC-4: every session | | |
| Approve chat: longest waiting call, Desktop errors, Jim | | |
| Six chats: passes, HUD shown, Jim, AC-4, put back | | |
| Bridge back after each chat (idle release, s) | | |

## Verdict

(Jim.)

## Consequences / open questions

(After the run. PHASE5_PLAN "Vault updates at the Phase 5 close (row 8)" lists the vault changes.)
