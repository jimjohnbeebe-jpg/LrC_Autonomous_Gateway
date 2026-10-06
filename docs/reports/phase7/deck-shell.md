---
report: AVG-P7-4b the Deck shell probe
phase: 7
status: accepted
authored_by: "Template, harness and pre-run findings: Claude Code (Opus 5.5), 2026-10-05, branch phase-7/deck-shell (vault PHASE7_PLAN row 4b). Observed: Jim's answers and runs (run 1 2026-10-06 01:41 UTC, run 2 02:23 UTC); the analysis of the Deck's logs: Claude Code. Verdict: Jim, 2026-10-05 local."
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

**Run 1: 2026-10-06 01:41 UTC (2026-10-05 18:41 local)**, `npm run deck:probe` on branch `phase-7/deck-shell` at `12e9bea` [handle: `docs\reports\phase7\deck-shell\probe_2026-10-06T01-41-29-632Z.json`; the Deck's log beside it, `probe_2026-10-06T01-41-29-632Z_hud_6764_1791250890666.jsonl`, 225 s, redacted to `%USERPROFILE%`]. Jim said "probe done". The probe's headline: `Deck shell probe: FAILED (A9a)`.

Jim's answers: y to A1e, D1, A5c, A5e, A7a, A7b, R1 and A9b; **n to A9a** ("in F's full-screen preview the Deck is not over the image").

**Why A9a failed (Claude Code, from the Deck's log; seconds from the Deck's start):**
- 178.5 s: F opened a separate Lightroom window: class `NonActivateWindow`, title "Lightroom", owned by the main window (`AgWinMainFrame`, hwnd 852946), at `0,0,3840,2160`, the whole monitor. It became the foreground window, and the Deck went below it (`front: false`).
- 178.6 s, 0.1 s later: the main window took the foreground back while F's window stayed visible. The rule "topmost while the main window is in front" made the Deck topmost again, over F's image.
- 187.8 s: while F was on, the main window's title read just "Lightroom Classic". The title rule found no main window, so the "largest" fallback took F's window as the main one until 188.1 s.
- So F's window never keeps the foreground, and the title is not a stable mark. The answer to spec 2.7's open point ("how to tell the main window from F's window") is: by class, and F's window by filling its monitor [inference: from this one run].

**Fix (Claude Code, on this branch, for run 2):** the main window is the ownerless window of class `AgWinMainFrame` (title as fallback). While another visible Lightroom window fills its whole monitor, the Deck is not topmost and sits just below that window. This is checked at each foreground change and every 250 ms (`hud\src-tauri\src\lightroom.rs` `cover`, `window.rs` `topmost_for`). Jim runs the probe again.

**Also seen:** the Deck stays opened across edits once opened. Run 1 ended with the 216 px (144 CSS px) deck at both later spots (the log's `place` lines). Row 4c decides whether a new edit starts with the bar.

**Run 2: 2026-10-06 02:23 UTC (2026-10-05 19:23 local)**, after the fix, on branch `phase-7/deck-shell` at `3a83cf1` [handle: `docs\reports\phase7\deck-shell\probe_2026-10-06T02-23-03-895Z.json`; the Deck's log beside it, `probe_2026-10-06T02-23-03-895Z_hud_24984_1791253385736.jsonl`]. Jim said "probe done". The probe's headline: `Deck shell probe: WORKED`. Jim answered y to every question, A9a included.

**What the log shows during F (Claude Code; seconds from the Deck's start):**
- 107.0 s: `cover` found F's window (hwnd 597260, `0,0,3840,2160`).
- 107.4 s: the main window took the foreground back as in run 1, and the Deck stayed not topmost (`front: false`, `cover: 597260`).
- 110.5 s: `cover` 0, after F was closed.
- The main window was the `AgWinMainFrame` window in every logged list. (The log's `main_by` value "title" names the class-or-title test, `lightroom.rs` `is_main`.)

## Numbers

Run 2, after the fix: every line YES [handle: the run 2 results file above]. Connected 725 ms after start, shown at 792 ms, without taking the foreground. Spot and width saved (`[3873, 938, 2394]`) and reopened there. Hidden 10,342 ms and 10,423 ms after the two ends. Minimise hide and restore show logged 2.0 s apart. W1: 4 window lists while F was on. C2: uninstalled.

Run 1 (from the results file):

| Line | What | Result |
|---|---|---|
| C1 | Installed where the engine looks | YES, `%USERPROFILE%AppDataLocalLrC-AVG HUDLrC-AVG HUD.exe` |
| A1a-e | Connected ≤ 3 s, shown ≤ 2 s without focus, default spot, Jim: bottom centre | YES: connected 526 ms, shown 604 ms, foreground stayed with pid 8564, default spot, Jim y |
| D1 | Open grows upward, Close shrinks back | YES (Jim); log: `1020,2022,1800,66` then `1022,1861,1800,216`, bottom edge 2077 (Jim had moved it 11 px between) |
| A5a-e | Spot and width saved and reopened there; off-monitor spot falls back | YES: saved, reopened at `[4145, 1242, 2480]` (Jim y), off-monitor `[-100000, -100000, 900]` fell back (Jim y) |
| A7a-c | Lightroom moved: Deck stays; minimised: hidden, restored: back | YES: Jim y twice; hide and show logged 2.5 s apart |
| R1 | Another window in front covers the Deck | YES (Jim) |
| A9a-b | F: not over the image; Shift+F: visible over Lightroom in each mode | **A9a NO**; A9b YES |
| W1 | Window list logged while F was on | YES, 9 lists |
| A12a-b | Hidden about 10 s after each end | YES: 10,205 ms and 10,364 ms |
| C2 | Uninstalled again | YES |

Every placement landed where it was aimed (`target` = `got` in all 4 `place` lines).

## Verdict

**Go** [stated: Jim, 2026-10-05, "Go (Recommended)", after run 2]. Row 4b is accepted; row 4c (the Deck's states, cards and keyboard) is next.

## Consequences / open questions

- Run 1 answered the open point of spec 2.7: F opens a separate, owned window that fills its monitor and never keeps the foreground. The main window is found by class `AgWinMainFrame`. Run 2 checks the fix.
- Not in this probe: the Deck's own states, copy cards, clicks and keyboard (row 4c), and the budgets of spec section 9 (row 6).
