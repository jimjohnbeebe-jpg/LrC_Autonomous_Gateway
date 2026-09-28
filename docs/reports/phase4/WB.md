---
report: WB — does Lightroom take WhiteBalance "Custom"?
phase: 4 (fix before Phase 5)
status: accepted
authored_by: "Template, harness, pre-run findings, analysis, Numbers and Consequences: Claude Code (Opus 5.5), 2026-09-28 (fix/white-balance-custom). Observed: Jim ran npm run wb:check on 2026-09-28 and answered its questions. Verdict: Jim (go, 2026-09-28)."
date: 2026-09-28
---

# WB — does Lightroom take WhiteBalance "Custom"?

## Purpose

When the engine writes Temperature, does Lightroom Classic take `WhiteBalance = "Custom"` written with it through `applyDevelopSettings`? And what does the Basic panel show?

**Why it matters.** In the Phase 4 check the engine wrote Temperature 4900 → 5200 alone, and Lightroom kept white balance "As Shot" [handle: `docs\reports\phase4\P4\p4_check_2026-09-28T04-18-17-511Z.json` `preset.source_prepared.white_balance_after`]. A preset made from that photo then carries no Temperature or Tint (`engine\src\presets\select.ts` `leaveOut`, as Lightroom's own As Shot presets carry none). Jim chose a fix PR before Phase 5 [stated: Jim, 2026-09-28, "Fix PR before Phase 5 (Recommended)"; `docs\reports\phase4\PHASE4.md` "Consequences" item 2]. The fix: every Temperature/Tint write also writes `WhiteBalance = "Custom"`, read back like every write.

**Why a check comes first.** The value "Custom" is [unverified]: the pinned key dump shows only "As Shot" [handle: `engine\src\params\sdk-keys.lrc15.json` `WhiteBalance` sample]. Every session and sync write is read back, and a value Lightroom did not take stops the step with `WRITE_NOT_TAKEN` [handle: `engine\src\session\io.ts:49-55`, `engine\src\sync\target.ts:68-71`]. If Lightroom refused "Custom", the fix would break every temperature step. So the engine change waits for this check [stated: Jim, 2026-09-28, "go with recommendations" on the plan: check first; Jim runs it; "Custom" with every Temperature/Tint write].

**Rule.** PHASES.md gives this fix no go / no-go rule. Proposed [inference]:
- **go** (make the engine change) when steps 2 and 3 read back "Custom" and PUT BACK is YES;
- **no-go** (record only; presets keep leaving an edited white balance out) when Lightroom does not take "Custom". The value Jim's slider sets (step 2's fallback) then goes into the options for Jim.

**How the check asks Jim:** y/n questions in PowerShell, as in the phase checks (rule 04 lets Jim choose this per check).

## Harness

| Part | Files |
|---|---|
| The check | `engine\src\devtools\wb-check.ts` (the steps, the summary), `wb-check-cli.ts` (`npm run wb:check`) |
| Tests | `engine\tests\wb-check.test.ts`, against the simulated plugin (`engine\tests\helpers\lightroom-sim.ts`) |
| Dry run | `docs\reports\phase4\wb-dryrun\dryrun.txt` (the built CLI against a scratch plugin; the driver verbatim in its appendix) |

**What `npm run wb:check` is written to do** [handle: `engine\src\devtools\wb-check.ts` header and `runWbCheck`]. It works on `20260907-_OZ80099.NEF`, the Phase 4 check's photo, which Jim clicks once. From then on it writes by the photo's uuid, and the selection is not touched (plugin 0.4.0).
0. It checks that the photo's white balance is "As Shot", then takes a snapshot, `AVG WBcheck before <time>`. The snapshot puts the photo back at the end, also after an error.
1. **Temperature +300 K alone** (History `AVG WBcheck 1/3 temperature`), as the Phase 4 check wrote it. It reads back the white balance and asks Jim whether the Basic panel's WB reads "As Shot" (and, if not, "Custom"), and whether the Temp slider moved to the new value. The panel side is [unverified] (`PHASE4.md` "Still [unverified]").
2. **Temperature +300 K more with `WhiteBalance = "Custom"`** (`AVG WBcheck 2/3 temperature + Custom`). It reads back both and asks Jim whether WB reads "Custom". If "Custom" was not taken, it asks Jim to drag the Temp slider a little and reads the white balance Lightroom sets then.
3. **Back to the start with the snapshot, then Tint +5 with "Custom"** (`AVG WBcheck 3/3 tint + Custom`). It reads back the white balance and the tint, and whether Temperature stayed at the photo's As Shot value.
   - Added after Jim's run (Greptile, PR #39): all settings are compared with the start after the reset. If any differs, the check fails and the tint is not written [handle: `engine\tests\wb-check.test.ts` "fails step 3 when the reset restores the white balance but not every other setting"]. In Jim's run the reset put white balance back to "As Shot" [handle: the run `tint_custom.reset_to_as_shot`], and the final put-back, the same snapshot, matched all 177 settings (`put_back`). The run did not record the full comparison after the reset itself.
4. **The preset selection** (`presets\select.ts`, the white balance group) of step 1's and step 2's settings: is the temperature carried? No preset file is written.
5. **Put back:** the snapshot is applied and every setting is compared with the start. The last lines say `White balance check: WORKED` or `FAILED` and `PUT BACK: YES` or `NO`.

The key names come from the params module only (`.claude\rules\03-lightroom.md`). The check leaves three History steps and the snapshot on the photo, as the phase checks did.

Results, under `%TEMP%\LrC-AVG\WB\`: `wb_check_<time>.json` and `wb_bridge_log_<time>.txt` (a copy of the plugin's log, user folder redacted). Claude Code collects them.

### Steps for Jim

Do these when Claude Code asks for the run; the branch `fix/white-balance-custom` is checked out in the repo folder. It takes about 2 minutes [inference: three writes and three questions].

1. Right-click the Claude icon in the Windows system tray → **Quit**.
2. In Lightroom Classic, in the **Library** module's **Folders** panel (left side), click the `fixtures` folder, so `20260907-_OZ80099.NEF` shows in the Filmstrip. Press **D** to open the Develop module.
3. In VS Code's PowerShell terminal, at `D:\Developer\LrC_Autonomous_Gateway`, run:

   ```powershell
   npm run wb:check
   ```

   You should see `Connected (plugin 0.4.0)`.
4. It asks you to click `20260907-_OZ80099.NEF`. Click it in the Filmstrip (the original, not a virtual copy), then press Enter.
5. It writes the temperature, then asks two questions about the **Basic** panel (right side). Type `y` or `n` and press Enter for each:
   1. Does **WB** (the menu above the Temp slider) read `As Shot`? If you answer `n`, it also asks whether it reads `Custom`.
   2. Does the **Temp** slider read the number it names?
6. It writes the temperature again, now with "Custom", and asks: does **WB** read `Custom` now? Type `y` or `n` and press Enter.
7. It may say `Lightroom did not take "Custom" from the plugin`. Only then: drag the **Temp** slider a little to the right, then press Enter.
8. The last lines say `White balance check: WORKED` or `FAILED`, then `PUT BACK: YES` or `NO`, then `Results saved automatically`. Tell Claude Code "done".

The panel's layout (WB menu above the Temp slider) is described from Lightroom's usual layout, not observed in this project [unverified].

### If something goes wrong

- If it prints `another LrC-AVG engine is using the Lightroom bridge`, Claude Desktop is still running: do step 1 again, then step 3.
- If it prints `could not connect to Lightroom`, check that Lightroom is open and that **File > Plug-in Manager** lists LrC-AVG as **Enabled**, then run step 3 again.
- If it prints `not 0.4.0 or later`, quit Lightroom, start it again, and run step 3 again.
- If it says `The selected photo is …, not 20260907-_OZ80099.NEF`, click the original photo it names and press Enter again.
- If it prints `the photo's white balance is "…", not "As Shot"`, nothing was written. In the Basic panel, open the **WB** menu, choose **As Shot**, then run step 3 again.
- If it prints `PUT BACK: NO`, click the snapshot `AVG WBcheck before …` in the photo's **Snapshots** panel (left side), and tell Claude Code.
- If it prints any other `FAILED: …` line, let it finish and tell Claude Code what the line says.
- If Lightroom shows an error dialog, click OK and tell Claude Code.

## Pre-run findings (Claude Code)

Checks Claude Code ran on 2026-09-28 on the branch, before Jim's run. None of them involves Lightroom.

- **Engine tests: 547 pass, 1 skipped**; `npm run build` and `npm run typecheck` pass [handle: `npm test`, "Tests 547 passed | 1 skipped (548)"]. `engine\tests\wb-check.test.ts` runs the whole check against the simulated plugin, whose white balance model is made up to test the check, **not Lightroom's**:
  - "Custom" taken: WORKED, three History steps, each write by uuid, step 1 writing Temperature alone; the preset carries the temperature after step 2, not after step 1; the photo put back exactly;
  - "Custom" refused (the sim drops WhiteBalance): the check still WORKED, reporting NO, the mismatch, and the white balance after Jim's drag;
  - Jim answering `n` to "As Shot" (then asked about "Custom");
  - nothing written when the photo's white balance is not "As Shot", or when another photo stays selected;
  - a write that fails (the photo is still put back); a snapshot that does not put it back (PUT BACK: NO, naming the settings); another engine holding the bridge;
  - a shift that would pass a slider's maximum goes the other way.
- **Mutation check:** with both temperature steps made to report "Custom" taken whatever the read-back, 1 test failed; with the put-back made to ignore differences, 1 test failed. The file was restored byte-identical afterwards [handle: Claude Code, 2026-09-28, `npx vitest run tests/wb-check.test.ts`: "Tests 1 failed | 8 passed (9)" for each; then "Tests 9 passed (9)"].
- **Dry run of the built CLI** against a scratch plugin (Jim's Lightroom not touched): once taking every key, once dropping WhiteBalance. Both printed `White balance check: WORKED` and `PUT BACK: YES` and exited 0. The first reported "Custom" taken YES and the preset carrying the temperature YES; the second reported NO for both [handle: `docs\reports\phase4\wb-dryrun\dryrun.txt`, sections 1 and 2].
- **Not yet run inside Lightroom** at the time [unverified until Jim's run; his run answered them, see "Observed"]: every Lightroom answer above.

## Observed (Jim)

Jim ran the steps on 2026-09-28 and said "done" [stated]. The check saved its files to `%TEMP%\LrC-AVG\WB\`, which held one run, `2026-09-28T12-19-08-508Z`. Claude Code copied them to `docs\reports\phase4\WB\`:
- the results, `wb_check_2026-09-28T12-19-08-508Z.json`, verbatim;
- the plugin log's lines for the check, `wb_bridge_log_2026-09-28T12-19-08-508Z_excerpt.txt`: lines 889-903 of the check's own copy of the log (903 lines, user folder already written as `%USERPROFILE%`), from the plugin's start to the check's last command.

Neither file holds the user-folder name or the bridge token [handle: Claude Code, 2026-09-28, `grep -rl` for both over `docs\reports\phase4\WB\`: no match].

Times are local (UTC−7) unless marked Z. "The run" is the results file; "the log" is the excerpt.

### The run (05:19 → 05:20): WORKED

- **The plugin** started at 05:18:18.209 and was listening 11.5 s later (05:18:29.749); the check connected at 05:19:08.563 with plugin 0.4.0 on LrC 15.5.1 [handle: the log; the run `hello`].
- **The photo**, `20260907-_OZ80099.NEF` (process version 15.4), started at white balance **"As Shot"**, Temperature **4900**, Tint **11** [handle: the run `photo`]. Jim's click and Enter came at 05:20:09 (`get_context`), and the snapshot `AVG WBcheck before 2026-09-28T12-19-08-508Z` followed [handle: the log, 05:20:09.397-05:20:09.476; the run `snapshot`].
- **Step 1, Temperature alone** (4900 → 5200, 05:20:09.564): Lightroom took the temperature and kept white balance **"As Shot"**, as in the Phase 4 check [handle: the run `temperature_alone`]. Jim: the Basic panel's WB read **"As Shot"** (y), and the Temp slider read **5200** (y) [stated, via the check; the run `temperature_alone.jim`]. So the panel showed "As Shot" beside a moved Temp slider.
- **Step 2, Temperature with "Custom"** (5200 → 5500, 05:20:33.106): Lightroom took both. It read back white balance **"Custom"** and Temperature 5500, with no mismatch [handle: the run `temperature_custom`]. Jim: WB read **"Custom"** (y) [stated, via the check; the run `temperature_custom.jim`]. The fallback (Jim's slider drag) was not needed.
- **Step 3, Tint with "Custom"** from the start again: the snapshot put white balance back to "As Shot" (05:20:43.634). Then Tint 11 → 16 with "Custom" (05:20:44.272) read back white balance **"Custom"** and Tint 16, with Temperature still **4900**, the As Shot value. No mismatch [handle: the run `tint_custom`; the log].
- **Step 4, the preset selection** (white balance group, no file): after step 2 a preset carries **temperature and tint**, with `WhiteBalance = "Custom"`; after step 1 it carries neither, both left out as "As Shot" [handle: the run `preset`].
- **Put back** (05:20:44.758): 177 settings compared with the start, **0 differing** [handle: the run `put_back`; the log].
- **The headline: `White balance check: WORKED`**, `PUT BACK: YES`, no error [handle: the run `summary`, `errors`].

## Numbers

| Field | Value | Source |
|---|---|---|
| Photo, white balance at the start, Temperature, Tint | `20260907-_OZ80099.NEF`, PV 15.4; **"As Shot"**, 4900, 11 | `photo` |
| Step 1: white balance after Temperature alone; temperature as written | 4900 → 5200: **"As Shot"**; **YES** | `temperature_alone` |
| Step 1: the panel reads As Shot / Custom; the Temp slider moved (Jim) | **y** / not asked; **y** (5200) | `temperature_alone.jim` |
| Step 2: "Custom" taken; temperature as written; mismatches | 5200 → 5500: **YES**; **YES**; none | `temperature_custom` |
| Step 2: the panel reads Custom (Jim) | **y** | `temperature_custom.jim` |
| Step 2 fallback: white balance after Jim's drag (only if "Custom" was not taken) | not needed | `temperature_custom` (no `by_hand`) |
| Step 3: back to As Shot; "Custom" taken with Tint; tint as written; Temperature kept | **YES**; **YES** (11 → 16); **YES**; **YES** (4900) | `tint_custom` |
| Step 4: a preset carries the temperature, after step 2 / after step 1 | **YES** (and the tint) / **NO** (both left out, As Shot) | `preset` |
| Put back: settings compared, differing | 177; **0** | `put_back` |
| Headline | **WORKED**, PUT BACK: YES; the run 12:19:08Z → 12:20:45Z | `summary`, `started_at`, `finished_at` |

## Verdict

**Go** (Jim, 2026-09-28, the option Claude Code recommended) [stated: "Go (Recommended)"]: make the engine change in this PR. The check's suggestion was **WORKED**, and the proposed rule in "Purpose" is met: steps 2 and 3 read back "Custom", and PUT BACK is YES.

## Consequences / open questions

**The engine change, in this PR (engine 0.6.1)** [handle: `engine\src\params\map.ts` `CUSTOM_WHITE_BALANCE_PARAMS` and `toSdk`]:
- Whenever `toSdk` writes `temperature` or `tint`, it also writes `WhiteBalance = "Custom"`, which is read back like every other key. The map refuses to build over a key file without `WhiteBalance`.
- Every engine write goes through `toSdk`: session steps, pass 0, syncs and recipe replays.
- The plan's decision 3 [stated: "go with recommendations"]: "Custom" goes with every temperature or tint write. A sync or recipe replay that writes an As Shot photo's own temperature therefore sets "Custom" at the same values [handle: `engine\tests\params-map.test.ts` "round-trips through toSdk, the white balance mode then \"Custom\" at the same values"].
- Tests against the simulated plugin, which now changes WhiteBalance only when it is written (`engine\tests\helpers\lightroom-sim.ts`, from step 1 of this run):
  - the map: "Custom" with a temperature or a tint and not otherwise; the key required; a read-back of "As Shot" reported (`params-map.test.ts`);
  - a session's temperature step writes "Custom", and a preset then carries the temperature and tint (`presets-tool.test.ts`);
  - a sync of the white balance group writes "Custom", and the target reads it back (`sync.test.ts`);
  - a Lightroom that refused "Custom" would now fail the syncs loudly with the preset step recording "As Shot" (`phase4-check-faults.test.ts`; this replaces the Phase 4 test in which As Shot passed silently).
  - With the one line in `toSdk` removed, 7 of these tests failed; the file was restored byte-identical afterwards [handle: Claude Code, 2026-09-28, `npx vitest run tests/params-map.test.ts tests/presets-tool.test.ts tests/sync.test.ts tests/phase4-check.test.ts tests/phase4-check-faults.test.ts`: "Tests 7 failed | 71 passed | 1 skipped (79)"].
- All engine tests: 553 pass, 1 skipped; `npm run build` and `npm run typecheck` pass [handle: `npm test`, "Tests 553 passed | 1 skipped (554)", 2026-09-28, after Greptile's round 1].
- `lr_create_preset_from_active`'s description now says every temperature or tint the engine writes sets the white balance to Custom (`engine\src\mcp\defs-propagation.ts`).
- **For Jim after the merge:** restart Claude Desktop so it loads engine 0.6.1. Claude Desktop runs the engine from `engine\dist\mcp\main.js`, started when Claude Desktop starts [handle: `engine\src\devtools\desktop-config.ts:33`; Phase 4's engine updates each needed a Claude Desktop restart, vault `LrC_AVG_STATE.md` sessions 8-9]. Lightroom needs no restart: this PR changes no plugin file [handle: `git diff main --stat -- plugin` on the branch prints nothing, 2026-09-28], and a Lightroom restart only loads a changed plugin [inference].

**Proposed for LR_SDK_NOTES "Recorded in Phase 4"** (LrC 15.5.1, Windows 11), each from this run [handle: `WB\wb_check_2026-09-28T12-19-08-508Z.json`]:
- `applyDevelopSettings { Temperature }` alone keeps `WhiteBalance` "As Shot" (step 1, as in the Phase 4 check). The Basic panel's WB menu then reads "As Shot" while the Temp slider shows the new value [stated: Jim, via the check]. This answers PHASE4.md's "What Lightroom's panel shows after a Temperature write that leaves As Shot".
- `applyDevelopSettings { Temperature, WhiteBalance = "Custom" }` is taken: both read back, and the panel's WB reads "Custom" [stated: Jim, via the check].
- `applyDevelopSettings { Tint, WhiteBalance = "Custom" }` is taken too, and Temperature keeps the As Shot value (4900 on this photo).
- `applyDevelopSnapshot` puts `WhiteBalance` back to "As Shot" (step 3's reset and the put-back).

**Still [unverified]:**
- the other white balance modes (Auto, Daylight, …) and their strings;
- whether the render differs between "As Shot" and "Custom" at the same Temperature/Tint (not measured);
- a preset written by the tool that carries Temperature/Tint, applied in Lightroom: the Phase 4 preset carried neither (`PHASE4.md` "Numbers");
- a Tint write alone, without "Custom" (not written).

**At the merge** (vault, per rule 04): mirror this report to `Reports\Phase4\WB.md`; add the LR_SDK_NOTES lines above; mark PHASES Phase 5's "Before Phase 5" input done; STATE "Next action" → the Phase 5 plan, on Jim's go.
