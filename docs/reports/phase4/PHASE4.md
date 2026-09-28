---
report: Phase 4 — Variants, series sync, presets
phase: 4
status: accepted
authored_by: "Template, harness and pre-run findings: Claude Code (Opus 5.5), 2026-09-27 (PHASE4_PLAN row 10). Observed: Jim ran npm run phase4:check on 2026-09-27 and answered its questions; Claude Code collected the files and wrote the analysis, Numbers and Consequences (2026-09-28, PHASE4_PLAN row 11). Verdict and decisions: Jim (Phase 4 accepted, go; a white-balance fix PR before Phase 5; all other proposals accepted; 2026-09-28)."
date: 2026-09-27 (run), 2026-09-28 (report)
---

# Phase 4 — Variants, series sync, presets

## Purpose

Does Phase 4 work in Lightroom? Variants mode (three virtual copies, a contact sheet, a pick), `lr_sync_series` with adaptive exposure, and `lr_create_preset_from_active`. The check also verifies the AC-4 fix on the photo where Phase 3 failed it.

PHASES.md, quoted (`PHASES.md:112-128`):
- "`createVirtualCopies` flow, A/B/C contact sheet, `awaiting_pick`, `lr_select_variant`."
- "`lr_sync_series` with adaptive exposure."
- "`lr_create_preset_from_active` (mechanism spike first)."
- "Acceptance: AC-3; sync onto a burst of three virtual copies matches mean luma within ±2/255; a preset appears in the Develop Presets panel after Lightroom restart at most."
- "P-10: the contact sheet is not inline in the Desktop answer; test its delivery and readability."
- Inputs from Phase 3: "The acceptance check counts AC-4 on every session." "Verify on `20260907-_OZ80099.NEF`." "**Acceptance adds AC-5's second half:** a session's recipe, replayed through `lr_sync_series` onto a virtual copy of the same photo, reproduces the final settings."

PRD section 10, quoted (`PRD.md:228-230`):
- "AC-3 Variants mode creates three virtual copies with visibly different looks; picking one in the HUD continues convergence on it."
- "AC-4 No pass leaves highlight clip > 0.5 % or shadow crush > 1 % unless the intent overrides."
- "AC-5 Session log JSON validates against the schema and reproduces the final settings when replayed through `lr_sync_series` onto a virtual copy of the same photo (round-trip test)."

In Phase 4 the pick is `lr_select_variant` in chat, not the HUD [stated: Jim, 2026-09-27, PHASE4_PLAN decision 3]. PHASES.md gives Phase 4 no go / conditional / no-go rule beyond its acceptance line.

**Jim's decisions on the row 10 plan (2026-09-28)** [stated: "Go", on the plan with five recommendations]:
1. **One photo for everything, the chat included:** `20260907-_OZ80099.NEF`.
2. **"The preset applies"** is checked by Jim's click and a read-back, with no plugin command.
3. **In the scripted Variants session Jim types the pick** (A, B or C).
4. **The cleanup includes Jim's two reference presets** ("AVG preset reference", "AVG preset reference 2"). Their files are kept in `engine\tests\fixtures\presets\`.
5. **Left [unverified] for row 11 / Phase 5:**
   - Claude Desktop's tool timeout for a 3-target adaptive sync (the chat covers Variants only; Part 1 records the sync's duration);
   - preset groups other than "LrC-AVG";
   - whether `findPhotoByUuid` yields (the check can only show that nothing deadlocked).

**How the check asks Jim:** y/n questions in PowerShell, as in Phases 1-3 (rule 04 lets Jim choose this per check).

## Harness

| Part | Files |
|---|---|
| The check | `engine\src\devtools\phase4-check.ts` (the steps, the summary), `phase4-check-cli.ts` (`npm run phase4:check`), `phase4-config.ts` (fixed values) |
| Its parts | `phase4-copies.ts` (the check's copies; are they gone), `phase4-converge.ts` (session A), `phase4-sync.ts` (burst, AC-5, the unselected write, put back), `phase4-variants.ts` (AC-3), `phase4-preset.ts` (preset, restart, apply), `phase4-chat.ts` (Part 2), `phase4-cleanup.ts`; shared: `clip-check.ts` (AC-4), `phase3-fixture.ts` `sessionA`, `phase2-collect.ts` (the chat's logs) |
| Tests | `engine\tests\phase4-check.test.ts`, `phase4-check-faults.test.ts`, `phase4-chat.test.ts`, with `engine\tests\helpers\phase4-harness.ts` |

**What `npm run phase4:check` is written to do.** This describes the code [handle: `engine\src\devtools\phase4-check.ts` header and `runPhase4Check`]. Before Jim's run it had run only against the simulated plugin (see "Pre-run findings"); Jim's run in Lightroom is in "Observed".

*Part 1*, scripted, through the same `Tools` class the MCP server uses, on `20260907-_OZ80099.NEF` (Jim clicks it once):
1. **Copies.** Four virtual copies in one `create_virtual_copies` command: "AVG P4check sync 1/2/3" and "AVG P4check replay". Each copy's settings are compared with the photo's (row 7 left "a new copy starts with the master's settings" [unverified]).
2. **Session A**, `landscape_golden_hour`, on the photo: pass 0, Phase 3's scripted passes, accept. AC-4 on every pass verifies the AC-4 fix on this photo. The log and recipe are checked against their schemas.
3. **The burst** (PHASE4_PLAN decision 5):
   - the three sync copies are set to exposure −1.0, +0.5 and +1.0 (History `AVG P4check exposure start`);
   - then `lr_sync_series` from session A with `adaptive_exposure: true`;
   - each copy and the photo are rendered again afterwards. Each copy must be within ±2/255 of the photo's mean luma, and the sync must report the goal met.
   - The sync's tries show how luma answers exposure in Lightroom (row 8 left that [unverified]).
4. **AC-5's second half.** `lr_sync_series` from session A onto the replay copy, without adaptive exposure. The copy's settings, read back, must equal the recipe's.
5. **A write to an original that is not selected** (row 8 left it [unverified]).
   - With the replay copy selected, a one-setting sync (vibrance +5) goes onto the photo and is read back.
   - The selection must be unchanged, and the sync's own snapshot `AVG pre-sync …` undoes it.
6. **The photo is put back** with session A's pre-session snapshot, compared with its settings before the check, and selected again.
7. **AC-3**: a Variants session on the photo (`landscape_golden_hour`, three copies "AVG landscape_golden_hour A/B/C", pass 0 each), then one scripted pass per copy (clarity +5).
   - The check selects each copy in turn, and Jim presses Enter after looking at it.
   - Question 1: visibly different?
   - Jim types the pick.
   - Then `lr_select_variant`, one pass on the pick (vibrance +5), accept.
   - Checked from the session log and the recipe: the pass after the pick went to the pick, the recipe is the pick's, and the photo is unchanged.
8. **The preset.**
   - The pick gets the photo's own profile back, Camera Neutral. The intent's pass 0 gave it Adobe Landscape, which a preset leaves out [handle: `engine\intents\landscape_golden_hour.json` `default_camera_profile`; `engine\src\presets\select.ts`].
   - It also gets a custom white balance (+300 K).
   - Then `lr_create_preset_from_active` saves "AVG P4check <time>" from the pick.
   - Row 9 left two items [unverified]: CameraProfile without its digest, and Temperature/Tint with a Custom white balance. The check records whether Lightroom reports "Custom" after the temperature write (`preset.source_prepared.white_balance_after`) and whether the preset carried the profile and the temperature.
9. **Lightroom restart.**
   - Jim quits Lightroom and starts it again. The check waits for a new connection from the plugin.
   - Question 2: is the preset listed?
   - The check gives "AVG P4check sync 1" another Nikon profile (Camera Landscape) and selects it. Jim clicks the preset once.
   - The check reads the copy back: every setting the preset carries must now match the pick's.

*Part 2*, Variants in a Claude Desktop chat on the same photo:
- Jim starts Claude Desktop and sends `Make three variants of the active photo for a golden hour landscape, give each one a refined pass, let me pick one, then refine the one I pick.` He picks in the chat.
- From the engine's tool log, the check needs:
  - a Variants session on the photo with three copies;
  - a refined pass on each copy before the pick (PRD 6.6 step 4, the way to `awaiting_pick`, which PHASES.md lists for Phase 4);
  - a pick;
  - at least one pass after the pick;
  - accept.
- When Claude began more than one Variants session, the one that ended with accept is judged, and the copies of every session join the cleanup.
- Questions 3-5: the contact sheet seen, its letters readable (P-10), the pick asked for and followed.

*Cleanup*, whatever happened before it:
- Jim quits Claude Desktop.
- He removes the virtual copies the check and the chat made. The check looks each one up by uuid.
  - A copy command that got no answer may still have made copies the check knows no uuid for. The check names them for Jim and reports them as not confirmable.
- He deletes the three presets. The check looks for their files. A preset Lightroom never listed is deleted by the check itself.
- The photo is compared with its settings before the check.
- If the check cannot take the bridge back from Claude Desktop, the presets are still cleaned up (they need only their files), and the copies and the photo are reported as not checked.

The headline `Phase 4 acceptance: WORKED / FAILED` covers:
- AC-3, scripted and in the chat;
- the burst within ±2/255;
- AC-5;
- AC-4 on every pass of session A, the Variants session and the chat's session (all three must have been counted);
- the preset listed after the restart, and applied;
- the unselected-original write;
- the photo put back.

Recorded without deciding it:
- whether new copies start with the photo's settings;
- whether the contact sheet's letters were readable;
- the white balance after the temperature write;
- the timings.

The cleanup has its own headline.

Results go to `%TEMP%\LrC-AVG\P4\`:
- `p4_check_<time>.json`;
- `p4_sessions_<time>\` (session A's and the Variants session's logs and recipes);
- `p4_check_tools_<time>\`;
- `p4_desktop_mcp_log_<time>.txt`, `p4_chat_tool_log_<time>.jsonl`;
- `p4_bridge_log_<time>.txt`.

Claude Code collects them. The check's preset goes into Lightroom's preset folder (`%APPDATA%\Adobe\CameraRaw\Settings\`), where Lightroom finds it after the restart [handle: `docs\reports\phase4\S7.md` Verdict 1; `engine\src\presets\folder.ts` `defaultPresetDir`]; the cleanup removes it.

### Steps for Jim

Do these after Claude Code says the `phase-4/check` PR is merged. Allow about 15 minutes [inference: the dry run made 41 exports on the one photo (`docs\reports\phase4\check-dryrun\dryrun.txt`, last line); at the ~2.6 s per export Phase 2 measured (`docs\reports\phase2\PHASE2.md` "Numbers") that is about 2 minutes of exports, plus the writes, the restart, the chat and the cleanup; Lightroom's time is unmeasured until this run].

1. Right-click the Claude icon in the Windows system tray → **Quit**.
2. In Lightroom Classic, in the **Library** module's **Folders** panel (left side), click the `fixtures` folder, so `20260907-_OZ80099.NEF` shows in the Filmstrip. Press **D** to open the Develop module.
3. In VS Code's PowerShell terminal, at `D:\Developer\LrC_Autonomous_Gateway`, run:

   ```powershell
   npm run phase4:check
   ```

   You should see `Connected (… ms, plugin 0.4.0)`.
4. The command asks you to click `20260907-_OZ80099.NEF`. Click it in the Filmstrip (the original, without a turned-page corner), then press Enter. Part 1 then runs by itself for a few minutes [inference, from the estimate above]; the photo and the new copies may change on screen while it works.
5. The command says `Lightroom now shows copy A …`. Look at the photo on screen, then press Enter. Do the same for copy B and copy C.
6. It asks question 1: did the three copies look visibly different? Type `y` or `n` and press Enter. Then it asks which copy to continue on: type `A`, `B` or `C` and press Enter.
7. It prints the restart steps. Do them:
   1. In Lightroom: **File > Exit**. Wait until Lightroom has closed.
   2. Start Lightroom again (Start menu > Adobe Lightroom Classic) and open the Develop module.
   3. Press Enter in the terminal. It says `Waiting for the LrC-AVG plugin to connect again`, then `Connected again`.
8. It asks question 2: in the Develop module's **Presets** panel (left side), open the group **LrC-AVG**. Is the preset `AVG P4check …` it names listed? Type `y` or `n` and press Enter.
9. It says `Lightroom now shows the copy "AVG P4check sync 1"`. In the **Presets** panel, click the preset `AVG P4check …` **once**, then press Enter.
10. It prints the Part 2 steps. Do them:
    1. Start Claude Desktop (Start menu > Claude).
    2. Open a new chat, type this sentence and press Enter:
       `Make three variants of the active photo for a golden hour landscape, give each one a refined pass, let me pick one, then refine the one I pick.`
    3. If Claude Desktop asks whether Claude may use an lrc-avg tool, choose **Always allow**.
    4. The contact sheet (the copies side by side) is inside Claude's tool step: click the step in Claude's answer to open it.
    5. When Claude asks which copy you want, answer with its letter.
    6. Wait until Claude says it has finished and has ended the session. Then go back to the terminal and press Enter.
11. It asks questions 3-5. Type `y` or `n` and press Enter for each:
    3. Did you see the contact sheet, the copies side by side?
    4. Could you tell on it which copy is A, B and C?
    5. Did Claude ask you to pick, and then carry on with the copy you picked?
12. Cleanup. The command asks, in turn:
    1. Quit Claude Desktop (tray icon > **Quit**), then press Enter.
    2. Remove the virtual copies:
       - press **G** for the Library Grid;
       - click the first copy next to `20260907-_OZ80099.NEF` (each copy has a turned-page corner), then Ctrl-click each of the others; do not select the original;
       - press **Delete**, click **Remove**, then press Enter.
       - If it lists copies that are still there, remove those the same way and press Enter.
       - If it says `Also remove any copies named …`, remove those too if you see them.
    3. Delete the three presets:
       - press **D**; in the **Presets** panel open **LrC-AVG**;
       - right-click each preset it names > **Delete** (if Lightroom asks to confirm, click **Delete**);
       - press Enter.

    The corner badge, the dialogs' words and the right-click menu are described from Lightroom's usual behaviour, not observed in this project [unverified]. The check confirms each removal itself: a copy by its uuid, a preset by its file.
13. The last lines say `Phase 4 acceptance: WORKED` or `FAILED`, `Also recorded: …`, `Cleanup: …` and `Results saved automatically`. Tell Claude Code "done".

### If something goes wrong

- If the command prints `another LrC-AVG engine is using the Lightroom bridge`, Claude Desktop is still running: do step 1 again, then step 3.
- If it prints `could not connect to Lightroom`, check that Lightroom is open and that **File > Plug-in Manager** lists LrC-AVG as **Enabled**, then run step 3 again.
- If it prints `plugin 0.3.0` (or older) `not 0.4.0 or later`, quit Lightroom, start it again, and run step 3 again.
- If it says `The selected photo is …, not 20260907-_OZ80099.NEF`, click the original photo it names (not a copy) and press Enter again.
- If the Delete dialog in step 12 offers **Delete from Disk**, click **Cancel**: the original is selected too. Select only the copies and try again.
- If Lightroom has not listed the preset after the restart, answer `n` to question 2; the check deletes its own preset file in the cleanup.
- If it prints `FAILED: …`, let the command carry on and tell Claude Code what the line says. It is written to put the photo back after Part 1 whatever failed (session A's snapshot), and to run the cleanup in every case [handle: `engine\tests\phase4-check-faults.test.ts` "puts the photo back when a write of the burst fails …"; in Lightroom [unverified]].
- If it prints `The photo put back as before the check: NO`, click the snapshot it names in the photo's **Snapshots** panel, and tell Claude Code.
- If in step 10 Claude says it has no Lightroom or lrc-avg tools, finish the steps (answer `n`) and tell Claude Code; it reads Claude Desktop's log itself.
- If Lightroom shows an error dialog, click OK and tell Claude Code.
- If a Windows Firewall window appears, click **Cancel** and tell Claude Code. The engine only uses connections inside this computer (127.0.0.1).

## Pre-run findings (Claude Code)

Checks Claude Code ran on 2026-09-27, before Jim's run. None of them involves Lightroom.

- **Engine tests: 538 pass, 1 skipped** on the `phase-4/check` branch [handle: `npm test`, "Tests 538 passed | 1 skipped (539)"]. `npm run build` and `npm run typecheck` pass too. The tests run against the fake plugin and the **simulated Lightroom** (`engine\tests\helpers\lightroom-sim.ts`, "tonal" model). The model is made up for testing the engine's rules: **Node numbers, not Lightroom's.**
  - `phase4-check.test.ts`: **the whole check**. It printed `Phase 4 acceptance: WORKED`, left the simulated photo as it started, and emptied the simulated catalog of copies and the preset folder.
  - `phase4-check-faults.test.ts`: each failure prints FAILED on its own line and is followed by the cleanup:
    - the copies judged not visibly different;
    - the preset not applied;
    - no reconnect after the restart (the check then deletes its own preset file);
    - a chat that accepted right after the pick;
    - a copy whose luma cannot be matched;
    - a failed write in the burst (the photo is still put back);
    - a Variants begin that makes two of three copies (the session is ended with revert, and the two copies join the cleanup);
    - a chat that picked before refining every copy;
    - a session A whose scripted passes were all refused (it does not count; the photo is still put back).
  - `phase4-check-cleanup.test.ts`: copies of a copy command that got no answer (named for Jim as not confirmable); two Variants sessions in the chat (the copies of both removed); Claude Desktop keeping the bridge (the presets still removed, the copies reported as not checked).
  - Also in `phase4-check-faults.test.ts`, recorded without failing: a copy left in the catalog, and a white balance that stays As Shot.
  - `phase4-chat.test.ts`: the chat's tool-log reader.
- **Mutation check:** with `presetApplies` made to ignore the read-back, and with `chatSessionOk` made to ignore the passes after the pick, 3 tests failed; the files were restored afterwards [handle: Claude Code, 2026-09-27, `npx vitest run tests/phase4-check-faults.test.ts tests/phase4-chat.test.ts`: "Tests 3 failed | 8 passed (11)"].
- **Dry run of `npm run phase4:check` itself.** The built CLI ran against the simulated plugin on scratch ports with its own token file, so Jim's Lightroom was not touched, and the real `engine\dist\mcp\main.js` played Claude Desktop in Part 2 (a Variants session over stdio MCP, contact sheet included). It printed `Phase 4 acceptance: WORKED` and exited 0: 10 of 10 copies removed, 3 of 3 presets removed [handle: `docs\reports\phase4\check-dryrun\dryrun.txt`, transcript and driver]. Its output folder was deleted afterwards so Jim's run starts clean.
- **Not yet run inside Lightroom** at the time [unverified until Jim's run; his run answered these, see "Observed", except those under "Still [unverified] after the run"]:
  - Variants mode: the copies, their pass 0, the selection of each copy, the time a Variants begin takes;
  - the burst sync: how luma answers exposure on this dark photo (Phase 3's golden JPEG: mean luma 29.1, shadow crush 16.24 % [handle: `docs\reports\phase3\PHASE3.md:214`]);
  - a write to an original that is not selected;
  - a preset file shown after a restart and applied, CameraProfile without its digest, the white balance after a temperature write;
  - whether a removed virtual copy is no longer found by uuid, and whether Lightroom's preset Delete removes the file;
  - Claude running Variants from the chat, and the contact sheet in Claude Desktop (P-10).

## Observed (Jim)

Jim ran the steps on 2026-09-27 and said "done" [stated]. The check saved its files to `%TEMP%\LrC-AVG\P4\`. Claude Code copied them to `docs\reports\phase4\P4\` with the user folder written as `%USERPROFILE%` [handle: Claude Code, 2026-09-28: `%TEMP%\LrC-AVG\P4\` held one run, `2026-09-28T04-18-17-511Z`. The copy replaced the user folder 11 times: 9 in the check's tool log and 1 in each of its two session logs. Afterwards no file held the user-folder name or the value in `%USERPROFILE%\.lrc-avg\bridge_token`, and each of the 20 strings of 40 or more hex digits is a `preview_hash`]. The copies are:
- the results, `p4_check_2026-09-28T04-18-17-511Z.json`;
- session A's and the Variants session's logs and recipes, in `p4_sessions_…\`;
- the check's tool log, in `p4_check_tools_…\`;
- the chat's tool log and Claude Desktop's MCP log excerpt;
- the bridge log;
- the chat's own session log and recipe (from the repo's `logs\`), in `p4_chat_session\`;
- the script Claude Code used to put the photo back after the run, its output and the plugin log's lines for it, in `putback_2026-09-28\` (see "The preset also reached the original").

The check keeps no images. Times are local (UTC−7) unless marked Z. "The run" is `P4\p4_check_2026-09-28T04-18-17-511Z.json`, and "the bridge log" is `P4\p4_bridge_log_2026-09-28T04-18-17-511Z.txt`.

### The run (21:18 → 21:40): WORKED

- **Connected** in 518 ms: plugin 0.4.0, protocol 1, LrC 15.5.1 [handle: the run `connect_ms`, `hello`].
- **Part 1** took 21:18:17 → 21:27:05, with no error line [handle: the run `started_at` 04:18:17Z, `errors` []; `P4\p4_check_tools_…\engine-20260927.jsonl`, last record 04:27:05Z].
  - **Copies:** one command made the four copies in 10.8 s. Each started with the photo's settings, 0 differing on all four [handle: the run `copies.ms`, `copies.start_as_master`]. Row 7 had left this [unverified].
  - **Session A, the AC-4 fix:** pass 0, four scripted passes, accept.
    - Pass 0 corrected the baseline 5 times. Shadow crush went from 16.24 % to 6.25, 2.59, 2.24, 1.60 and 0.80 % [handle: `P4\p4_sessions_…\20260927-cd6883.json` `passes[0].metrics_before.clip_low_pct`, `passes[0].guardrail_actions[*].metrics_after.clip_low_pct`].
    - In Phase 3 the same pass stopped at 2.23 % after three corrections [handle: `docs\reports\phase3\PHASE3.md`, the AC-4 table].
    - The begin took 62.1 s [handle: the check's tool log, `lr_begin_session` 04:20:17Z, `duration_ms` 62115.1].
  - **The burst:** three copies started at −1.0, +0.5 and +1.0 EV. The adaptive sync brought each within ±2/255 of the photo, and a fresh render confirmed it (see "Numbers"). The sync took 26.8 s and left the selection as it was [handle: the run `sync_burst`].
  - **AC-5's second half:** the recipe synced onto the replay copy read back with 0 settings differing [handle: the run `ac5_sync`].
  - **A write to the original while a copy was selected:** vibrance 20 → 25 was written and read back, the selection stayed on the copy, and the sync's own snapshot undid it exactly [handle: the run `unselected_original`; the 20 is session A's result, `P4\p4_sessions_…\20260927-cd6883.json` `final_settings.vibrance`]. Row 8 and S7 had left a write to an original [unverified].
  - **The photo was put back** with session A's snapshot, 0 settings differing [handle: the run `put_back`].
  - **Variants (AC-3):** the begin took 142.9 s (see "Numbers"). The check showed Jim each copy. He answered **y** to "visibly different" and typed **A** [stated, via the check's questions; the run `variants.jim`]. The pass after the pick went to A, the recipe is A's, and the photo was unchanged [handle: the run `variants.verified`].
  - **The preset** "AVG P4check 2026-09-28T04-18-17-511Z" was written from A in 23 ms, with 62 settings [handle: the check's tool log, `lr_create_preset_from_active`; the run `preset.written`].
    - Before that, the check wrote Camera Neutral and Temperature 4900 → 5200 onto A, and Lightroom still reported white balance **"As Shot"**.
    - So the preset carried no Temperature or Tint, as Lightroom's own As Shot presets carry none [handle: the run `preset.source_prepared.white_balance_after`, `preset.temperature_written` false, `preset.left_out`].
- **The restart:** the bridge closed at 21:27:52. After Lightroom started again, the plugin went from starting to listening in 12.25 s (21:28:11.233 → 21:28:23.485). The check reconnected 263 ms after Jim pressed Enter [handle: the bridge log, 21:27:52-21:28:25; the run `restart.wait_ms`].
- **The preset after the restart:** Jim answered **y**, listed in the group LrC-AVG [stated, via the check; the run `preset.listed_after_restart`].
  - The check had given "AVG P4check sync 1" another profile (Camera Landscape) and selected it.
  - After Jim's click, every setting the preset carries matched A's, the profile included [handle: the run `preset.apply`: `differed_before` camera_profile, exposure, shadows, vibrance; `differing` []].
  - The preset has `CameraProfile` without the `CameraProfileDigest` Lightroom writes, and it still applied. Row 9 had left this [unverified].
- **Part 2, the chat** (21:31:40 → 21:37:11) [handle: `P4\p4_chat_tool_log_…jsonl`, 10 calls; `P4\p4_chat_session\20260927-26ecc4.json` `picked`, `passes`, `outcome`]:
  - Claude read the context and the intent, then began a Variants session on `20260907-_OZ80099.NEF` with three copies (73.6 s).
  - It made a refined pass on A, B and C, then asked Jim to pick. Jim picked A.
  - Claude made two passes on A and accepted.
  - Jim answered **y** to all three questions: contact sheet seen, letters readable, pick asked for and followed [stated, via the check; the run `jim_chat`].
- **Cleanup:** Jim quit Claude Desktop and removed the copies and the presets.
  - All 10 copies were gone, each uuid then unknown to the catalog [handle: the run `cleanup.copies[*].state`; the bridge log, 21:39:26, ten `unknown_photo` lines].
  - The files of all 3 presets were gone [handle: the run `cleanup.presets[*].files`].
  - **The photo was not as before the check:** blacks, clarity, exposure, highlights, shadows and vibrance differed [handle: the run `cleanup.master_differing`].
- **The headline: `Phase 4 acceptance: WORKED`**, with every acceptance item YES [handle: the run `summary`].

### The preset also reached the original

- Jim confirmed that the preset's step is in the original's History [stated: Jim, 2026-09-28, "Yes, the preset is there"].
- When the chat began at 21:31:51, the original held A's recipe exactly, except for the profile, which was the preset's Camera Neutral: 64 of 65 settings equal [handle: `P4\p4_chat_session\20260927-26ecc4.json` `passes[0].settings_before`, copy A made from the original at 21:31:55 (copies start with the original's settings, see Part 1), against `P4\p4_sessions_…\20260927-a0a799.recipe.json`; compared by Claude Code, 2026-09-28].
- At 21:27:04 the check had found the original unchanged after the Variants session [handle: the run `variants.verified.master_differing` []].
- Before Jim's click the plugin selected sync 1 alone [handle: the bridge log, 21:28:42.625 `select_photo`]:
  - `select_photo` reads the selection back and fails unless exactly that photo is selected [handle: `plugin\LrC-AVG.lrplugin\Catalog.lua:111-118`];
  - a failed select would have stopped the step [handle: `engine\src\devtools\phase4-preset.ts:135`, `:145-147`], and the step went on.
- Between the restart and the chat, the engine wrote only to sync 1, by its uuid (the profile, 21:28:43.101) [handle: `phase4-preset.ts:169`; the bridge log, 21:28:25-21:31:40, one `apply_settings`]. It read sync 1 back at 21:30:01.562 and selected the original again at 21:30:01.581 [handle: the bridge log].
- Jim clicked the preset once [stated: Jim, 2026-09-28, "clicked once only"].
- **How one click also reached the original is [unverified].** Jim chose to leave it there rather than read the History times from a copy of his catalog [stated: "Go with A"].
- It changed the chat's starting point. The chat's copies began from the preset's values, so their pass 0 needed 0, 3 and 0 corrections, against 5, 8 and 4 in the scripted Variants session [handle: `P4\p4_chat_session\20260927-26ecc4.json` and `P4\p4_sessions_…\20260927-a0a799.json`, `passes[n=0].guardrail_actions`]. That is why the chat's begin took 73.6 s against 142.9 s [inference].
- Claude Code put the photo back with session A's pre-session snapshot, at Jim's request [stated: Jim, 2026-09-28, "Claude Code does it"]. `PUT BACK: YES`, nothing differing from the start [handle: `P4\putback_2026-09-28\putback-m-output.txt` and `putback-m.mjs`; `P4\putback_2026-09-28\bridge-log-excerpt.txt`, `apply_snapshot` 2026-09-28 04:11:22].

## Numbers

Filled by Claude Code from the run's files. "Source" names a field of the run unless it names a file in `P4\`. Luma is on the 0-255 scale; clipping is the share of pixels.

| Field | Value | Source |
|---|---|---|
| Plugin version, connect time | 0.4.0 (protocol 1, LrC 15.5.1); 518 ms | `hello`, `connect_ms` |
| New copies start with the photo's settings | **YES**: 4 of 4 copies, 0 settings differing; the four made by one command in 10.8 s | `copies.start_as_master`, `copies.ms` |
| AC-4, session A (every pass within 0.5 % / 1.0 %) | **YES**: passes 0-4, highest clip 0.15 % (pass 4), highest crush 0.80 % (pass 0, after 5 baseline corrections from 16.24 %); the begin 62.1 s | `converge.ac4`; `P4\p4_sessions_…\20260927-cd6883.json` `passes[0]`; the check's tool log |
| Burst: per copy exposure start → final, luma start → final, renders; source luma; measured again | sync 1: −1.00 → +0.93 EV, luma 31.37 → 72.73, 4 renders; sync 2: +0.50 → +0.94 EV, 61.50 → 73.01, 3 renders; sync 3: +1.00 → +1.00 EV, 74.68 (within at the start), 1 render. Source 73.29. Measured again: −0.56, −0.28, +1.39: **all within ±2** | `sync_burst.targets[*].exposure`, `.luma`; `sync_burst.source_luma`; `sync_burst.measured` |
| Burst: how luma answered exposure | about 24-30 luma per EV between −1.0 and +1.7 EV on this photo (from the tries: +2.69 EV gave +64.3, −0.94 EV gave −27.7, +0.56 EV gave +14.9) [computed by Claude Code from the tries] | `sync_burst.targets[*].luma.tries` |
| Burst: the sync's duration (for Claude Desktop's tool timeout, [unverified]) | 26.8 s for three targets and 8 renders; selection kept | `sync_burst.total_ms`, `sync_burst.selection_kept` |
| AC-5: settings differing after the sync onto the replay copy | **0** | `ac5_sync.differing` |
| Write to the unselected original: written, selection kept, undone | **YES, YES, YES** (vibrance 20 → 25; the snapshot "AVG pre-sync e112" put it back with 0 differing) | `unselected_original` |
| Photo put back after Part 1 | **YES**, 0 differing (snapshot "AVG pre-session 2026-09-28T04:20:17.408Z") | `put_back` |
| Variants: begin time, copies' metrics, refined passes | Begin **142.9 s**: one copy command (the first select 8.0 s after it), 3 selects, 20 writes, 21 exports; pass-0 baseline corrections A 5, B 8 (the cap), C 4. After pass 0: A "natural" luma 56.2, clip 0.05 %, crush 0.80 %; B "dramatic" 72.8, 0.21 %, 0.76 %; C "soft" 41.5, 0.00 %, 0.91 %. Refined pass (clarity +5) on A, B and C, none undone; `awaiting_pick` after C | `variants.begin`, `variants.refined`; the check's tool log `lr_begin_session` 04:22:30Z; the bridge log 21:22:30.9-21:24:53.8; `P4\p4_sessions_…\20260927-a0a799.json` `passes[n=0].guardrail_actions` |
| Jim: visibly different; pick | **y**; **A** | `variants.jim` |
| Variants: the pass after the pick on the pick; recipe's photo; master unchanged | **YES** (2 steps on A, the last one on A); A's uuid; **YES**, 0 differing | `variants.verified` |
| AC-4, Variants session (every copy's passes) | **YES**: 7 passes, highest clip 0.22 % (B, pass 1), highest crush 0.99 % (C, pass 1) | `variants.ac4` |
| Preset: settings written, left out; profile and temperature carried; white balance after the temperature write | 62 written; left out: temperature and tint (As Shot), `lens.corrections_enable` (not in Lightroom's own presets). Profile carried **YES** (Camera Neutral, without the digest); temperature carried **NO**. White balance after 4900 → 5200: **"As Shot"** | `preset.written`, `preset.left_out`, `preset.camera_profile_written`, `preset.temperature_written`, `preset.source_prepared` |
| Restart: time to reconnect | 263 ms after Jim pressed Enter; the plugin started listening 12.25 s after it started | `restart.wait_ms`; the bridge log 21:28:11.233 → 21:28:23.485 |
| Preset listed after the restart (Jim); applied (read-back) | **y**; **YES**: 4 settings differed before the click (the profile included), 0 after | `preset.listed_after_restart`, `preset.apply` |
| Chat: Variants session, copies, pick, passes after the pick, end | **YES**: Variants on `20260907-_OZ80099.NEF`, 3 copies, refined A, B and C before the pick, pick A, 2 passes after it, accept. 10 tool calls, 21:31:40-21:37:11; the begin 73.6 s (pass-0 corrections 0, 3, 0) | `chat`; `P4\p4_chat_tool_log_…jsonl`; `P4\p4_chat_session\20260927-26ecc4.json` |
| Chat: contact sheet seen, letters readable, pick followed (Jim) | **y, y, y** | `jim_chat` |
| AC-4, chat session | **YES**: 8 passes, highest clip 0.06 % (B, pass 1), highest crush 0.94 % (B, pass 0) | `chat.ac4` |
| Cleanup: copies gone, presets gone, photo as before | **10 of 10**; **3 of 3**; **NO**: 6 settings differed (the preset had reached the original, see "Observed"); put back by Claude Code on 2026-09-28: **YES** | `cleanup`; `P4\putback_2026-09-28\` |
| The whole run | 21:18:17 → 21:39:55 (21.6 min); no error line; the engine's bridge client counted 15 refused connection attempts and 1 dropped connection, all before the chat (the drop is the restart) | `started_at`, `finished_at`, `errors`, `bridge_stats` |

## Verdict

**Phase 4 accepted: go** (Jim, 2026-09-28, the option Claude Code recommended) [stated: "Go (Recommended)"]. The check's suggestion was **WORKED** (see "Observed").

The acceptance line (`PHASES.md:112-128`, quoted in "Purpose") against the run. Each item's handles are in "Observed" and "Numbers":
- **AC-3:** met in Phase 4's scope (decision 3: the pick in chat, the HUD pick in Phase 5). Three copies from one command, visibly different (Jim: y), picked, and convergence continued on the pick, scripted and in the chat.
- **The burst:** met. Three copies within ±2/255 of the photo's mean luma, measured on a fresh render: −0.56, −0.28, +1.39.
- **The preset:** met. Listed in the Develop Presets panel after one restart (Jim: y), and it applied.
- **P-10:** the contact sheet was seen in Claude Desktop's tool step, with readable letters (Jim: y, y).
- **Inputs from Phase 3:** AC-4 was counted on all three sessions and held on every pass. On `20260907-_OZ80099.NEF`, pass 0 now ends at 0.80 % crush, where Phase 3 ended at 2.23 %. AC-5's second half was exact.
- **Not an acceptance line:** the cleanup found the photo changed, because the preset had also reached the original. It is put back exactly.

## Consequences / open questions

Proposed by Claude Code; **Jim decided all five on 2026-09-28**, each as recommended [stated]: 1 "Go (Recommended)", 2 "Fix PR before Phase 5 (Recommended)", 3-5 "Accept all (Recommended)". Each item follows from the handles above; the recommendations were [inference].

**Decisions for Jim:**
1. **The verdict.** Recommended: **go**. Every acceptance line is met with a handle. The stray preset came from Lightroom's own apply after Jim's click: the engine wrote nothing to the original then ("The preset also reached the original"). The cleanup found it, and it is put back exactly.
2. **White balance after a Temperature write.** Lightroom kept `WhiteBalance` "As Shot" after the engine wrote Temperature 4900 → 5200. So a preset made from an edited photo leaves its white balance out.
   - The render does follow the written temperature [inference: in the chat's passes that raised Temperature, the red/blue ratio rose each time, 0.48-0.51 → 0.67-0.69 on pass 1 and 0.69 → 0.79 on A's pass 2; other sliders moved in the same passes; `P4\p4_chat_session\20260927-26ecc4.json` `passes[*].metrics_before/after.rb_ratio`].
   - What Lightroom's panel shows beside the moved Temp slider is [unverified].
   - **Recommended:** a small `fix/white-balance-custom` PR before Phase 5. Whenever the engine writes Temperature or Tint, the canonical map also writes `WhiteBalance = "Custom"` (a key pinned in `engine\src\params\sdk-keys.lrc15.json`), read back like every write. Whether Lightroom accepts "Custom" through `applyDevelopSettings` is [unverified]: that PR's plan says how to check it in Lightroom.
   - Or: record it only, and presets keep leaving out an edited white balance.
3. **The preset that reached the original.** The cause stays [unverified] (Jim's choice, "Go with A").
   - **Recommended:** any later check that asks Jim to click in Lightroom (Phase 5's included) reads the original and every photo it knows right after the click, and names any that changed. Record it as a Phase 5 input; no fix now, since no engine write was involved.
4. **Phase 5 inputs from the timings.** Record only, no change now:
   - A Variants begin took 142.9 s scripted and 73.6 s in the chat. Most of it is pass 0: 20 writes and 21 exports in the scripted one, about 6 s per write and export (the bridge log, 21:22:46-21:24:53) [inference]. Phase 2 measured an export at ~2.6 s (`docs\reports\phase2\PHASE2.md:225`); why this cycle took longer is [unverified].
   - Claude Desktop did not time out on the 73.6 s call [handle: `P4\p4_chat_tool_log_…jsonl`, every call `ok`; `P4\p4_desktop_mcp_log_…txt` holds no error line].
   - The pass-0 cap held on this photo with no margin. Copy B needed all 8 baseline corrections, and copy C's refined pass ended at 0.99 % crush against the 1 % limit [handle: `P4\p4_sessions_…\20260927-a0a799.json`; the run `variants.ac4`].
5. **The vault updates** at the Phase 4 close. These are the items listed in PHASE4_PLAN "Vault updates at the Phase 4 close" (the vault; from rows 1-10), plus from this run:
   - **PHASES:** Phase 4 status. Phase 5 inputs: the HUD pick (decision 3), items 3 and 4 above, and the [unverified] list below. Before Phase 5: the `fix/white-balance-custom` PR (item 2).
   - **ARCHITECTURE section 6 / PRD NFR-2:** a Variants begin took ~2.4 min on this dark photo, one write and one export per pass-0 correction.
   - **LR_SDK_NOTES "Recorded in Phase 4":** the text below, for Jim's approval.

**Draft for LR_SDK_NOTES "Recorded in Phase 4"** (LrC 15.5.1, Windows 11). It has three parts:
- **S7's draft**, as written in `docs\reports\phase4\S7.md` "Consequences".
- **From rows 8-9:**
  - `getTargetPhotos` returns the filmstrip when nothing is selected, and `findPhotoByUuid` must run in a task [handle: https://lrc.mcor.dev/modules/LrCatalog.html].
  - The preset-file facts from Lightroom's two reference files [handle: `engine\tests\fixtures\presets\`]. A new group's file sits at `CameraRaw\Settings\<name>.xmp`, with the group only in `crs:Group`. Numbers are written as `+0.33` / `-21` / unsigned `25`. A Nikon profile is written as `CameraProfile` plus `CameraProfileDigest`. As Shot writes no Temperature/Tint. `FilterList` entries are marked `IsSignalForDelete`. The first reference lacks keys the second has, and why is [unverified].
- **From this run (2026-09-27):**
  - `createVirtualCopies`, four in one command: 10.8 s. Each copy starts with the master's develop settings [handle: the run `copies`].
  - `applyDevelopSettings` on an **original** found by `findPhotoByUuid` and not selected: written, read back, the selection unchanged [handle: the run `unselected_original`]. This answers S7's "tested on virtual copies only".
  - After Lightroom's Remove, a virtual copy's uuid is no longer found by `findPhotoByUuid` (10 of 10) [handle: the bridge log, 21:39:26, ten `unknown_photo`].
  - Deleting a user preset from the Develop Presets panel removes its `.xmp` file (3 of 3). The check deletes its own preset only when Lightroom did not list it [handle: the run `cleanup.presets[*].files` 0 and `preset.listed_after_restart` y; `engine\src\devtools\phase4-cleanup.ts:119-121`].
  - A preset `.xmp` with `CameraProfile` and no `CameraProfileDigest` is listed after a restart and sets its profile when applied [handle: the run `preset.apply`].
  - `applyDevelopSettings { Temperature }` leaves `WhiteBalance` "As Shot" [handle: the run `preset.source_prepared`]. The render follows the temperature [inference, item 2].
  - On `20260907-_OZ80099.NEF`, mean luma moved about 24-30 per EV between −1.0 and +1.7 EV [handle: the run `sync_burst.targets[*].luma.tries`].
  - After a Lightroom restart, the plugin went from starting to listening in 12.25 s [handle: the bridge log, 21:28:11.233 → 21:28:23.485].
  - One click on a preset in the Develop Presets panel, with one virtual copy selected (read back by the plugin), also applied the preset to that copy's original. The cause is [unverified] ("Observed", "The preset also reached the original").

**Still [unverified] after the run:**
- From Jim's decision 5:
  - Claude Desktop's tool timeout for a 3-target adaptive sync. The chat ran no sync; its longest call, 73.6 s, did not time out [handle: `P4\p4_chat_tool_log_…jsonl`, `lr_begin_session` `duration_ms` 73649.5, `ok` true].
  - Preset groups other than "LrC-AVG".
  - Whether `findPhotoByUuid` yields. Nothing deadlocked [handle: the run finished, `finished_at` 04:39:54Z, with `errors` []].
- How the preset reached the original.
- What Lightroom's panel shows after a Temperature write that leaves "As Shot".
- Why a write and export cycle took ~6 s here.
- Presets with an Adobe profile (Phase 5 or later, PHASE4_PLAN "From row 9").
