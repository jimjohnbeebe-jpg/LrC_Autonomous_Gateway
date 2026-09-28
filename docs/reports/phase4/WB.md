---
report: WB — does Lightroom take WhiteBalance "Custom"?
phase: 4 (fix before Phase 5)
status: template
authored_by: "Template, harness and pre-run findings: Claude Code (Opus 5.5), 2026-09-28 (fix/white-balance-custom). Observed: Jim (to come). Verdict: Jim (to come)."
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
- **Not yet run inside Lightroom** [unverified until Jim's run]: every Lightroom answer above.

## Observed (Jim)

*To be filled after Jim's run: the results file's fields, Jim's y/n answers, the plugin log's lines for the check.*

## Numbers

| Field | Value | Source |
|---|---|---|
| Photo, white balance at the start, Temperature, Tint | | `photo` |
| Step 1: white balance after Temperature alone; temperature as written | | `temperature_alone` |
| Step 1: the panel reads As Shot / Custom; the Temp slider moved (Jim) | | `temperature_alone.jim` |
| Step 2: "Custom" taken; temperature as written; mismatches | | `temperature_custom` |
| Step 2: the panel reads Custom (Jim) | | `temperature_custom.jim` |
| Step 2 fallback: white balance after Jim's drag (only if "Custom" was not taken) | | `temperature_custom.by_hand` |
| Step 3: back to As Shot; "Custom" taken with Tint; tint as written; Temperature kept | | `tint_custom` |
| Step 4: a preset carries the temperature, after step 2 / after step 1 | | `preset` |
| Put back: settings compared, differing | | `put_back` |
| Headline | | `summary` |

## Verdict

*Jim's, after the run. The check's line is a suggestion.*

## Consequences / open questions

*After the run: on go, the engine change in this PR (`ParamMap.toSdk` writes `WhiteBalance = "Custom"` with Temperature/Tint; engine 0.6.1), and LR_SDK_NOTES "Recorded in Phase 4". On no-go, options for Jim.*
