---
report: Phase 4 — Variants, series sync, presets
phase: 4
status: template
authored_by: "Template, harness and pre-run findings: Claude Code (Opus 5.5), 2026-09-27 (PHASE4_PLAN row 10). Observed: Jim (to fill). Numbers, Consequences: Claude Code from Jim's run. Verdict: Jim."
date: 2026-09-27 (template)
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

**What `npm run phase4:check` is written to do.** This describes the code [handle: `engine\src\devtools\phase4-check.ts` header and `runPhase4Check`]. It has run only against the simulated plugin (see "Pre-run findings"). Against Lightroom it is [unverified] until Jim's run.

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
- Jim starts Claude Desktop and sends `Make three variants of the active photo for a golden hour landscape, let me pick one, then refine the one I pick.` He picks in the chat.
- From the engine's tool log, the check needs:
  - a Variants session on the photo with three copies;
  - a pick;
  - at least one pass after the pick;
  - accept.
- Questions 3-5: the contact sheet seen, its letters readable (P-10), the pick asked for and followed.

*Cleanup*, whatever happened before it:
- Jim quits Claude Desktop.
- He removes the virtual copies the check and the chat made. The check looks each one up by uuid.
- He deletes the three presets. The check looks for their files. A preset Lightroom never listed is deleted by the check itself.
- The photo is compared with its settings before the check.

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
       `Make three variants of the active photo for a golden hour landscape, let me pick one, then refine the one I pick.`
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

- **Engine tests: 531 pass, 1 skipped** on the `phase-4/check` branch [handle: `npm test`, "Tests 531 passed | 1 skipped (532)"]. `npm run build` and `npm run typecheck` pass too. The tests run against the fake plugin and the **simulated Lightroom** (`engine\tests\helpers\lightroom-sim.ts`, "tonal" model). The model is made up for testing the engine's rules: **Node numbers, not Lightroom's.**
  - `phase4-check.test.ts`: **the whole check**. It printed `Phase 4 acceptance: WORKED`, left the simulated photo as it started, and emptied the simulated catalog of copies and the preset folder.
  - `phase4-check-faults.test.ts`: each failure prints FAILED on its own line and is followed by the cleanup:
    - the copies judged not visibly different;
    - the preset not applied;
    - no reconnect after the restart (the check then deletes its own preset file);
    - a chat that accepted right after the pick;
    - a copy whose luma cannot be matched;
    - a failed write in the burst (the photo is still put back);
    - a Variants begin that makes two of three copies (the session is ended with revert, and the two copies join the cleanup).
  - Also in `phase4-check-faults.test.ts`, recorded without failing: a copy left in the catalog, and a white balance that stays As Shot.
  - `phase4-chat.test.ts`: the chat's tool-log reader.
- **Mutation check:** with `presetApplies` made to ignore the read-back, and with `chatSessionOk` made to ignore the passes after the pick, 3 tests failed; the files were restored afterwards [handle: Claude Code, 2026-09-27, `npx vitest run tests/phase4-check-faults.test.ts tests/phase4-chat.test.ts`: "Tests 3 failed | 8 passed (11)"].
- **Dry run of `npm run phase4:check` itself.** The built CLI ran against the simulated plugin on scratch ports with its own token file, so Jim's Lightroom was not touched, and the real `engine\dist\mcp\main.js` played Claude Desktop in Part 2 (a Variants session over stdio MCP, contact sheet included). It printed `Phase 4 acceptance: WORKED` and exited 0: 10 of 10 copies removed, 3 of 3 presets removed [handle: `docs\reports\phase4\check-dryrun\dryrun.txt`, transcript and driver]. Its output folder was deleted afterwards so Jim's run starts clean.
- **Not yet run inside Lightroom** [unverified until Jim's run]:
  - Variants mode: the copies, their pass 0, the selection of each copy, the time a Variants begin takes;
  - the burst sync: how luma answers exposure on this dark photo (Phase 3's golden JPEG: mean luma 29.1, shadow crush 16.24 % [handle: `docs\reports\phase3\PHASE3.md:214`]);
  - a write to an original that is not selected;
  - a preset file shown after a restart and applied, CameraProfile without its digest, the white balance after a temperature write;
  - whether a removed virtual copy is no longer found by uuid, and whether Lightroom's preset Delete removes the file;
  - Claude running Variants from the chat, and the contact sheet in Claude Desktop (P-10).

## Observed (Jim)

*To be filled from Jim's run.*

## Numbers

*Filled by Claude Code from the run's files.*

| Field | Value | Source |
|---|---|---|
| Plugin version, connect time | | `hello`, `connect_ms` |
| New copies start with the photo's settings | | `copies.start_as_master` |
| AC-4, session A (every pass within 0.5 % / 1.0 %) | | `converge.ac4` |
| Burst: per copy exposure start → final, luma start → final, renders; source luma; measured again | | `sync_burst.targets`, `sync_burst.measured` |
| Burst: the sync's duration (for Claude Desktop's tool timeout, [unverified]) | | `sync_burst.total_ms` |
| AC-5: settings differing after the sync onto the replay copy | | `ac5_sync.differing` |
| Write to the unselected original: written, selection kept, undone | | `unselected_original` |
| Photo put back after Part 1 | | `put_back` |
| Variants: begin time, copies' metrics, refined passes | | `variants.begin`, `variants.refined` |
| Jim: visibly different; pick | | `variants.jim` |
| Variants: the pass after the pick on the pick; recipe's photo; master unchanged | | `variants.verified` |
| AC-4, Variants session (every copy's passes) | | `variants.ac4` |
| Preset: settings written, left out; profile and temperature carried; white balance after the temperature write | | `preset` |
| Restart: time to reconnect | | `restart.wait_ms` |
| Preset listed after the restart (Jim); applied (read-back) | | `preset.listed_after_restart`, `preset.apply` |
| Chat: Variants session, copies, pick, passes after the pick, end | | `chat` |
| Chat: contact sheet seen, letters readable, pick followed (Jim) | | `jim_chat` |
| AC-4, chat session | | `chat.ac4` |
| Cleanup: copies gone, presets gone, photo as before | | `cleanup` |

## Verdict

*Jim decides: go / conditional / no-go. The check's headline is a suggestion.*

## Consequences / open questions

*Filled after the run. Already known:*
- Row 11 carries the vault updates listed in PHASE4_PLAN "Vault updates at the Phase 4 close", with what this run observes.
- Left [unverified] by Jim's decision 5: Claude Desktop's tool timeout for a 3-target adaptive sync, preset groups other than "LrC-AVG", whether `findPhotoByUuid` yields.
- Presets with an Adobe profile stay open for Phase 5 or later (PHASE4_PLAN "From row 9").
