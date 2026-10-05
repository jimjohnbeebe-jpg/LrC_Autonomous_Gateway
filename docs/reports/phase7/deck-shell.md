---
report: AVG-P7-4b the Deck shell probe
phase: 7
status: template
authored_by: "Template, harness and pre-run findings: Claude Code (Opus 5.5), 2026-10-05, branch phase-7/deck-shell (vault PHASE7_PLAN row 4b). Observed and Verdict: Jim."
date: 2026-10-05
---

# AVG-P7-4b: the Deck shell probe

## Purpose

Row 4b builds the Deck's Tauri shell (`hud\`): the five window rules of spec section 2.7, the remembered spot in `%LOCALAPPDATA%\LrC-AVG\hud\window.json`, the channel client, and a log of Lightroom's windows that shows what F opens. This probe checks the shell on Jim's machine before row 4c draws the Deck's states, cards and keyboard. It covers acceptance lines A1, A5, A7, A9 and A12 as spec 2.7 amends them, plus rule 1 (topmost only with Lightroom's main window or the Deck in front).

PHASES.md gives no go/no-go rule for a row probe. The plan's rule [stated: Jim, 2026-10-05, "Go with recommendations", to the row 4b plan]: the probe answers yes on every line, and the window-list log shows how F's window differs from the main window. If F's window is taken for the main window, the rule in `hud\src-tauri\src\lightroom.rs` is fixed from the log in this PR before it merges.

**How Jim answers:** y/n questions in the PowerShell window that runs the probe, as in S9 [stated: Jim, 2026-10-05, "Go with recommendations", plan decision 2].

## Harness

- `hud\probe\probe.ts` (run by `npm run deck:probe`) and `hud\probe\kit.ts`. A stand-in engine, the engine's own `HudChannel` and `HudLauncher` from `engine\dist`, sends made-up states for three short edits of a photo named `deck-probe.NEF`. No photo is edited and nothing is written to the catalog (plan decision 1).
- The probe installs the Deck with its per-user installer (`/S`, no admin rights). It checks that the Deck lands where the engine looks for it (`%LOCALAPPDATA%\LrC-AVG HUD\LrC-AVG HUD.exe`, `engine\src\hud\launch.ts`), and uninstalls it at the end. Until row 4c gives the Deck its buttons, an installed Deck would take the classic HUD's place in real edits (`engine\src\hud\sinks.ts`).
- It deletes `window.json` first, so the first-run spot is checked.
- Results: `%TEMP%\LrC-AVG\deck-probe\probe_<run>.json` and a copy of the Deck's log (`%TEMP%\LrC-AVG\hud\hud_<pid>_<start>.jsonl`). Claude Code collects them into `docs\reports\phase7\deck-shell\`.

### Steps for Jim

1. Open Lightroom Classic and go to the Develop module (any photo).
2. Quit Claude Desktop: File > Exit. (The probe stops if Claude Desktop's engine is running.)
3. In PowerShell at the repo root, run:
   ```powershell
   npm run deck:probe
   ```
4. Follow the window: it asks you to click, drag or press keys, then asks a y/n question each time. Answer y when what it describes happened.
5. The last line reads `Deck shell probe: WORKED` or `Deck shell probe: FAILED (…)`. Tell Claude Code "probe done".

### If something goes wrong

- If the probe says Lightroom is not running, open Lightroom and run the command again.
- If it says Claude Desktop's engine is running, quit Claude Desktop from its tray icon (right-click > Quit) and run the command again.
- If it says the installer is not built yet, tell Claude Code; it runs `npm run deck:build`.
- If the Deck never appears, answer n to the questions that follow and finish the run; the log says why.

## Pre-run findings (Claude Code)

1. **Build.** `npm run build -w hud` built `hud\src-tauri\target\release\LrC-AVG HUD.exe` (3,463,168 bytes) and `bundle\nsis\LrC-AVG HUD_0.1.0_x64-setup.exe` (1.33 MiB) [handle: the tauri-cli output "Finished 1 bundle at: …\LrC-AVG HUD_0.1.0_x64-setup.exe (1.33 MiB)", 2026-10-05]. The installer takes the executable's name from `mainBinaryName` in `tauri.conf.json` (same output: "Patching …\LrC-AVG HUD.exe with bundle type information: nsis").
2. **Placement maths.** `cargo test` in `hud\src-tauri` passes 5 of 5 (`place.rs`): first run at bottom centre at both scales, a remembered spot kept, a spot on no monitor falls back, opening grows upward inside the work area, width clamped [handle: `cargo test` output "test result: ok. 5 passed", 2026-10-05].
3. **Dry run with Notepad standing in for Lightroom** (`LRC_AVG_HUD_LR_EXE=notepad.exe`, the built exe through `LRC_AVG_HUD_EXE`, the probe's stand-in engine; scratch driver in this session's scratchpad, not committed). The Deck's log, `%TEMP%\LrC-AVG\hud\hud_27588_1791231156843.jsonl`, showed:
   - connected 391 ms after its start; shown 449 ms after it, without taking the foreground (`fg_pid` 28348, not the Deck's 27588);
   - first spot bottom centre of Notepad's monitor, `[4860, 2022, 1800, 66]`: 1200 x 44 CSS px at scale 1.5, placed exactly (`target` = `got`);
   - hid 10,349 ms after the end state (`close_after` 10);
   - the next edit opened at the remembered spot (`"remembered": true`);
   - Notepad minimised: `hide` `lightroom_minimised`; restored: `show` `lightroom_restored`.
4. **Not dry-run:** Open/Close, dragging, resizing, the topmost rule and F. The machine's screen was locked during the dry run: the window under every point was `LockScreenInputOcclusionFrame` (explorer), so simulated clicks never reached the Deck [handle: scratch `where.ps1` output "window 204312 pid 12320 class LockScreenInputOcclusionFrame proc explorer", 2026-10-05]. The probe asks Jim about each of them.
5. **The probe itself, end to end, with Notepad standing in for Lightroom** (`LRC_AVG_HUD_LR_EXE=notepad.exe`, every answer a scripted y, so the lines that need Jim's clicks mean nothing here). C1 YES: the per-user installer put the Deck at `%LOCALAPPDATA%\LrC-AVG HUD\LrC-AVG HUD.exe`, where the engine looks. C2 YES: `uninstall.exe` beside it removed it, and the folder was gone afterwards. A1a-d, A5b, A5d, A12a and A12b YES. A7c and W1 NO, as expected with nothing minimised and no F pressed [handle: `npm run deck:probe` console output and `ls "$LOCALAPPDATA/LrC-AVG HUD"` "No such file or directory", 2026-10-05].
6. **The probe removes the Deck however it ends** (Greptile, PR #87). Input closed after two answers: the probe used them (C1, A1a-e, D1), stopped at the third question with "Input ended: the probe stops.", and printed "The Deck was uninstalled." Afterwards the install folder was gone, no `LrC-AVG HUD.exe` was running, and `%USERPROFILE%\.lrc-avg\hud_endpoint.json` was deleted [handle: the same console output, `tasklist` "No tasks are running", `ls ~/.lrc-avg/`, 2026-10-05]. Ctrl+C takes the same exit path (`process.once("SIGINT")`, `hud\probe\probe.ts`); it was not tried [unverified].
7. **[unverified] until the probe:** how F's window differs from Lightroom's main window (line W1 and the logged window lists).

## Observed (Jim)

*(Filled from Jim's run.)*

## Numbers

*(Filled from the saved results.)*

| Line | What | Result |
|---|---|---|
| C1 | Installed where the engine looks | |
| A1a-e | Connected ≤ 3 s, shown ≤ 2 s without focus, default spot, Jim: bottom centre | |
| D1 | Open grows upward, Close shrinks back | |
| A5a-e | Spot and width saved and reopened there; off-monitor spot falls back | |
| A7a-c | Lightroom moved: Deck stays; minimised: hidden, restored: back | |
| R1 | Another window in front covers the Deck | |
| A9a-b | F: not over the image; Shift+F: visible over Lightroom in each mode | |
| W1 | Window list logged while F was on | |
| A12a-b | Hidden about 10 s after each end | |
| C2 | Uninstalled again | |

## Verdict

*(Jim.)*

## Consequences / open questions

- The main-window rule (`lightroom.rs`, title holds "Adobe Photoshop Lightroom Classic", ownerless; else the largest) stays [unverified] until W1's window lists are read.
- Not in this probe: the Deck's own states, copy cards, clicks and keyboard (row 4c), and the budgets of spec section 9 (row 6).
