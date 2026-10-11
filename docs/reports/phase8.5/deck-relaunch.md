---
report: deck-relaunch
phase: "8.5"
status: observed
authored_by: "Claude Code (purpose, harness, pre-run findings, steps); Jim (observed, verdict)"
date: 2026-10-10
---

# The classic HUD opening beside the Deck, and the Deck's dead Accept (fix/deck-relaunch)

## Purpose

Jim, 2026-10-10, after PR #120: "on the last pass the deck appeared AND the classic LUA HUD came up … the Accept button did not activate, I had to click the Accept button on the LUA hud … all subsequent passes opened the original LUA hud, then a few seconds later the new Deck … DO NOT HACK THIS FIX. DO NOT JUST APPLY SOME KIND OF TIMER OR BLOCK, FIGURE OUT THE ACTUAL ISSUE." His rule for the outcome: "if the new Deck HUD is enabled then the classic HUD should never appear" [stated: Jim, 2026-10-10]. The classic HUD stays only as the fallback for a Deck that truly fails, with a note to the chat [stated: "Go with your recommendation … feedback to the chat indicating the fallback"].

Questions:
1. Why did the classic HUD open when the Deck was installed and running?
2. Why did the Deck take no hover and no click?

Go when both causes are found with handles, fixed at the cause, and Jim's Lightroom check shows only the Deck after an idle of more than 5 minutes, with a working Accept.

## Harness

- `npm run deck:idle-probe` (`hud\probe\idle.ts`, mouse helper `hud\probe\input.ts`, stand-in engine `hud\probe\kit.ts`). It needs Lightroom open and Claude Desktop quit. Without arguments it runs four runs, about 25 minutes. Each run:
  - starts the Deck with `LRC_AVG_DECK_IDLE` set (both, no_memory, no_visible; `hud\src-tauri\src\webview.rs`);
  - shows the Deck for a stand-in edit, ends it, and closes the channel as the engine's idle release does;
  - waits 30 s or 420 s;
  - opens the channel again and launches the Deck a second time, as the engine does at the next begin, which now wakes the running Deck (`hud\src-tauri\src\wake.rs`);
  - moves the mouse onto Accept and clicks.

  It records whether the page saw the pointer (`pointer_in`), whether the Deck sent the click and the stand-in engine got it, which process's window was under the point, and how long the Deck took to connect again. Results: `%TEMP%\LrC-AVG\deck-idle\idle_<stamp>.json`, plus a copy of each Deck log.

  Three variants, added after the first run, each closer to the session of 2026-10-10:
  - `-- --timer`: no second launch. The next edit begins while the Deck is disconnected, and the Deck finds the engine through its page's 2 s timer and joins mid-edit. The stand-in sends a Deck that connects the open edit's state, as the engine does (`engine\src\hud\deck.ts` `clientChanged`).
  - `-- --front`: a 30 s wake run and a 420 s timer run, with the app the probe was started from (VS Code) put in front by a click on it while the Deck is hidden. Each run records the app in front at the show (`in_front`).
  - `-- --classic`: the `--front` runs with Lightroom's classic HUD open as well. The edit begins, the probe opens the classic window through the bridge command `hud_update` (`open: true`), as `engine\src\hud\publisher.ts` sends it, and 3 s later puts VS Code in front; then the Deck connects and shows. The classic window closes itself 10 s after the edit ends.
- The Lightroom check: one Claude Desktop chat after an idle of more than 5 minutes (steps below). Claude Code reads the engine's tool log and the Deck's log.

## Pre-run findings (Claude Code)

Evidence in `docs\reports\phase8.5\deck-relaunch\`, copied from Jim's PC on 2026-10-10 (user folder redacted):
- `deck-11744-excerpt.jsonl`: the Deck that ran 19:42-20:08Z, without window lists or per-state lines;
- `second-launches.jsonl`;
- `engine-tools-excerpt.jsonl`;
- `desktop-engine-stderr.txt`: the engine's lines in Claude Desktop's log, which carry no timestamps.

1. **The engine's idle release closes the Deck's channel, by design.** After 60 s with no tool call the engine gives the bridge back and closes the HUD channel [handle: `desktop-engine-stderr.txt`, "no tool call for 60 s; gave the Lightroom bridge back" then "HUD channel: client dropped, the listener closed"; `engine\src\mcp\main.ts:74-77`]. The HUD spec decided it this way, so that only the engine holding the lock hosts the channel (`docs\hud\lrc-avg-hud-spec-v2.md` section 3.2, lines 262 and 510). The Deck then stays running, hidden (`hud\ui\visibility.ts`).
2. **The engine's start of the Deck at the next begin did nothing.** The Deck from 19:42Z was still running. The launches at the 19:57:24Z and 20:04:11Z begins hit the one-Deck mutex and exited at once [handle: `second-launches.jsonl`, `second_instance_exit`; `hud\src-tauri\src\main.rs` `first_instance`]. `HudLauncher.start` returns true once it has spawned the process (`engine\src\hud\launch.ts:57-73`), so the engine waited its 3 s and opened the classic HUD (`engine\src\hud\sinks.ts` `startDeck`).
3. **The hidden Deck found the engine late.** Its page reads the endpoint every 2 s (`hud\ui\deck.ts`, the 2 s `setInterval`), but it connected again 20 s and 33 s after the begins [handle: `engine-tools-excerpt.jsonl`, `hud_channel` `connected: true` at 19:57:44.7Z and 20:04:44.7Z against `lr_begin_session` at 19:57:24.0Z and 20:04:11.5Z]. After the short idles of the first sessions it connected within about a second (19:45:35.7Z, 19:50:01.7Z). That WebView2 throttles a hidden page's timers is [inference].
4. **No owner per session: both HUDs stayed up.** Every stage goes to both HUDs (`sinks.ts` `stage`), and nothing closes the classic window when a Deck connects mid-edit. Jim's rule above ends this: with findings 2 and 3 fixed, the classic HUD opens only when a started Deck does not connect.
5. **After minutes hidden, the Deck took no input.**
   - From 19:57:44Z to 19:59:56Z the Deck was connected and painting. Its Accept was enabled in that state (`hud\ui\view.ts` `stageActions`, `kind: "quiet", on: true`).
   - Its log has no `click`, no `focus_lightroom` and no foreground change to its process [handle: `deck-11744-excerpt.jsonl`]. Jim saw no hover change, and nothing covered the Deck: VS Code was on the other monitor [stated: Jim, 2026-10-10].
   - The pattern follows how long the Deck had been hidden before it was shown:

     | Hidden before the show | Clicks after the show |
     |---|---|
     | 33 s | worked (19:49:07Z) |
     | 55 s | worked (19:51:11Z) |
     | 383 s | none: Accept came from the classic HUD at 19:59:56Z, `via: "bridge"` |

     [handle: `deck-11744-excerpt.jsonl` `hide`/`show`/`click` lines; `engine-tools-excerpt.jsonl` `hud_event`]
   - While hidden, the Deck sets WebView2 `IsVisible` false and its memory target Low (`hud\src-tauri\src\webview.rs`). Whether either stops input after minutes was [unverified] before the probe. The probe found neither does (Observed, Part A).
   - The app in front at each show [handle: `deck-11744-excerpt.jsonl`, `show` lines, `fg_pid`]: the three shows that took input (19:42:25Z, 19:45:41Z, 19:50:13Z) came while Claude Desktop (pid 29508) was in front; the two that did not (19:57:44Z, 20:04:44Z) came while VS Code Insiders (pid 29256) was. That pid 29256 is VS Code Insiders, running since 2026-10-08, is [handle: `Get-Process -Id 29256` on 2026-10-10: `Code - Insiders`, StartTime 10/8/2026 9:08:48 PM]. Its window (hwnd 401152) is on the right monitor, x 3994 to 7619, so it could not cover the Deck, which was at x 1790 to 3632 on the left monitor [handle: GetWindowRect of hwnd 401152 and `System.Windows.Forms.Screen.AllScreens` on 2026-10-10; the `place` lines].

Built on this branch before the probe (Deck 0.3.3, engine 0.25.1):
- `wake.rs`: a second launch sets the event `Local\LrC-AVG-HUD-wake` and exits; the running Deck waits on it in a Rust thread and asks its page to connect now (`window.deckWake`, `hud\ui\deck.ts`). Test: `wake::tests` (cargo).
- `sinks.ts`: when the classic HUD opens because a started Deck did not connect, or was lost, the next session tool result says so in `hud_actions` (`deck_fallback`). A Deck that is not installed is no fallback. Test: `engine\tests\hud-fallback.test.ts`.
- Diagnostics in the Deck's log: `accept_at` at each show, and `pointer_in` on the first pointer move after it.
- Added after Part A, since no run reproduced the dead input (Jim's choice, 2026-10-10 [stated: "Go with your recommendations"]): `over.rs`. While the Deck is shown, each 250 ms tick samples a 5 x 3 grid over its window with WindowFromPoint and logs an `over` line at each show and whenever the set of other windows found there changes, with their pid, class, title and number of points. If the dead input comes back, the log names any window over the Deck.

## Steps for Jim

### Part A: the probe (about 25 minutes, unattended)

1. Quit Claude Desktop: **File > Exit** in Claude Desktop.
2. Open Lightroom Classic if it is not open, and leave it in **Develop**.
3. In PowerShell in VS Code, run:
   ```powershell
   cd D:\Developer\LrC_Autonomous_Gateway
   npm run deck:idle-probe
   ```
4. When it prints "Deck idle probe: 4 runs", click once on Lightroom's title bar, then leave the mouse alone. The probe moves the mouse onto the Deck once per run.
5. When it prints DONE or INCOMPLETE, tell Claude Code "done".

### Part B: the Lightroom check (after the fix is built)

About 20 minutes, most of it waiting. It recreates the evening of 2026-10-10: an edit, an idle of more than 5 minutes with VS Code in front, then the next edit.

1. Quit Claude Desktop: **File > Exit** in Claude Desktop.
2. In PowerShell in VS Code, install the new Deck:
   ```powershell
   Stop-Process -Name "LrC-AVG HUD" -ErrorAction SilentlyContinue
   & "D:\Developer\LrC_Autonomous_Gateway\hud\src-tauri\target\release\bundle\nsis\LrC-AVG HUD_0.3.3_x64-setup.exe" /S
   ```
3. Start Claude Desktop. In Lightroom, in **Develop**, select one raw photo.
4. In a new Claude Desktop chat, ask for an edit of the selected photo. When the Deck shows it, click **Accept** on the Deck.
5. Click VS Code, so it is in front, and leave everything alone for at least 6 minutes.
6. In the same chat, ask for another edit of the photo. Watch the Deck and Lightroom: you should see the Deck within a second or two of the edit starting, and no classic HUD window. Move the mouse over the Deck's **Accept**: it should light up. Click it.
7. Do steps 5 and 6 once more.
8. Tell Claude Code "done", and answer three questions: Did the classic HUD window appear at any time (yes/no)? Did the Deck's Accept light up and work each time (yes/no)? Did Claude say anything about a fallback to the classic HUD (yes/no)?

Claude Code then collects the engine's tool log and the Deck's log.

### If something goes wrong

- If it prints "FAILED: Lightroom is not running", open Lightroom and run step 3 again.
- If it prints "FAILED: Claude Desktop's engine is running", quit Claude Desktop (step 1) and run step 3 again.
- If a run says COVERED, a window was over the Deck's Accept. Tell Claude Code "done" anyway: the results name the window.

## Observed (Jim)

**Part A: the probe**, run by Jim on 2026-10-10 and 2026-10-11 UTC, results collected by Claude Code from `%TEMP%\LrC-AVG\deck-idle\` [handle: `docs\reports\phase8.5\deck-relaunch\probe\idle_<stamp>.json`, all seven files]:
- `idle_2026-10-10T22-02-40-796Z.json` (four wake runs): all INPUT OK. The Deck connected again 63 to 67 ms after the second launch.
- `idle_2026-10-10T22-39-05-003Z.json` and `idle_2026-10-11T00-50-05-083Z.json` (`--timer`): FAILED, "no place or accept_at line after the show". The Deck connected 35.6 s and 38.2 s after the edit began, but never showed: the stand-in did not send the open edit's state to a Deck that connects (fixed in `kit.ts`, as the engine does). The probe also did not exit after a failed run, since the stand-in's channel stayed open (fixed: `idle.ts` closes it after the runs) [stated: Jim, "run is not exiting, I have to CTRL-C"].
- `idle_2026-10-11T01-34-56-640Z.json` (`--timer`, fixed stand-in): INPUT OK; connected after 30.3 s.
- `idle_2026-10-11T01-58-56-615Z.json` (`--front`, first version): INPUT OK twice, but Lightroom was in front at both shows (`in_front`), since the Deck's Accept hands the foreground to Lightroom (`focus_lightroom`). It did not test what it was meant to; the probe now clicks VS Code itself.
- `idle_2026-10-11T04-36-56-612Z.json` (`--front`): INPUT OK twice, VS Code Insiders in front at both shows.
- `idle_2026-10-11T05-00-56-925Z.json` (`--classic`): INPUT OK twice, VS Code Insiders in front and the classic HUD open (`classic_opened: true`). Jim saw the classic window appear near the end of the run [stated: Jim, 2026-10-11], which is the probe's own (its second run).

In every run that reached the click, the window under the Accept point was the Deck's WebView2 (`under_point` `msedgewebview2.exe`).

One test of Windows notifications, run by Claude Code on 2026-10-11 (`scratchpad\toast.ps1`, not kept): with Lightroom maximised on the left monitor, WindowFromPoint at the Accept point of 2026-10-10, (3378, 1878), returned Lightroom's main window before, during and after a test notification. Whether the notification showed at all is [unverified]: Jim did not see it [stated: Jim, "I don't know"]. Jim does not see Claude Desktop notifications when a reply finishes [stated: Jim, 2026-10-11, "No, not as far as I can tell"].

**Part B: the Lightroom check**, Jim, 2026-10-11 05:04Z to 05:53Z, one Claude Desktop chat with four edits of one photo (the photo was a throwaway [stated: Jim]). Jim: "The first two edits went OK, but I crashed something on the final edit. LrC actually hung and I had to force it closed. Claude Desktop also stopped responding. This began when an 'unexpected error' dialogue popped up in LrC toward the beginning of the edit" [stated: Jim, 2026-10-11]. Collected by Claude Code:
- The classic HUD never opened: no `hud: shown` line in the plugin's log from the first edit on [handle: `%TEMP%\LrC-AVG\bridge.log` from line 12877, Jim's PC].
- After each idle, the engine's launch woke the hidden Deck (`second_instance_exit` with `woke: true`, then `wake` and `show` 35 to 36 ms later), and the plugin saw the Deck connect 0.04 to 0.6 s after each edit began [handle: Deck logs `%TEMP%\LrC-AVG\hud\hud_13228_1791696536151.jsonl`, `hud_37288_…`, `hud_5732_…`; `bridge.log` "hud: session" then "hud: Deck connected"].
- The Deck's Accept took the pointer and the click in both edits that reached it after an idle (`pointer_in`, then `click` `hud_accept` at 05:30:49Z and 05:41:23Z; the engine ended both sessions from the HUD) [handle: the Deck log above; `logs\engine-20261010.jsonl` `SESSION_ENDED` "ended … from the HUD at 2026-10-11T05:30:49.676Z" and "05:41:23.431Z"].
- No `deck_fallback` note was sent; none was due [handle: `logs\engine-20261010.jsonl`, no `deck_fallback`].
- The hang: the last edit's AI Vegetation mask (`lr_create_mask` `landscape_vegetation`, 05:49:48Z) brought up Lightroom's error dialog; the engine waited for the result (by design, up to 5 minutes) until Lightroom was force-closed 168.5 s later (`BRIDGE_DISCONNECTED`, `read ECONNRESET`). Not in this PR's code; tracked in GitHub issue #123.
- The Deck that ran was the 14:23 build without `over.rs`: the installed `LrC-AVG HUD.exe` was dated 2026-10-10 14:23:48, 3489792 bytes, against the 22:09 build's 3492864 bytes [handle: `Get-Item` on both, 2026-10-11]. Step 2's command does replace it: run by Claude Code afterwards, the file became the 22:08:58 build within 8 s [handle: the same `Get-Item` before and after]. Whether step 2 ran in Part B is unknown. So the `over` lines are [unverified] in use; the wake and the classic-HUD rule are in both builds.

## Numbers

Part A, every run that reached the click (results files named by their stamp):

| Results | Run | Hidden | Path | In front at the show | Classic HUD open | Verdict | Pointer seen | Click sent | Engine got it | Connected again after |
|---|---|---|---|---|---|---|---|---|---|---|
| 22-02-40 | both | 30 s | wake | (not recorded) | no | INPUT OK | yes | yes | yes | 63 ms |
| 22-02-40 | both | 420 s | wake | (not recorded) | no | INPUT OK | yes | yes | yes | 64 ms |
| 22-02-40 | no_memory | 420 s | wake | (not recorded) | no | INPUT OK | yes | yes | yes | 64 ms |
| 22-02-40 | no_visible | 420 s | wake | (not recorded) | no | INPUT OK | yes | yes | yes | 67 ms |
| 01-34-56 | both | 420 s | timer | (not recorded) | no | INPUT OK | yes | yes | yes | 30.3 s |
| 04-36-56 | both | 30 s | wake | VS Code Insiders | no | INPUT OK | yes | yes | yes | 63 ms |
| 04-36-56 | both | 420 s | timer | VS Code Insiders | no | INPUT OK | yes | yes | yes | 4.6 s |
| 05-00-56 | both | 30 s | wake | VS Code Insiders | yes | INPUT OK | yes | yes | yes | 65 ms |
| 05-00-56 | both | 420 s | timer | VS Code Insiders | yes | INPUT OK | yes | yes | yes | 16.8 s |

The timer path's reconnect ranged from 4.6 s to 38.2 s across the five timer runs (including the two FAILED ones); the wake's from 63 to 67 ms across six runs.

Part B (from the logs above; Jim's answers to the three questions were not given separately):

| Question | Answer |
|---|---|
| Classic HUD window appeared | no (no `hud: shown`) |
| Deck's Accept lit up and worked each time | yes, 2 of 2 after an idle (`pointer_in`, `click`); the fourth edit ended in the mask hang before Accept |
| Claude mentioned a fallback | no note was sent; none was due |

## Verdict

Go, as Claude Code suggests from Parts A and B: question 1 fixed and seen fixed in Lightroom; question 2 not reproduced, and not seen again in Part B. Jim asked for the merge [stated: Jim, 2026-10-11, "squash, merge and close the session"].

## Consequences / open questions

- **Question 1 is answered and fixed at its cause:** findings 1 to 4. The engine's start of the Deck now wakes a running Deck (`wake.rs`), which connects in 63 to 67 ms (Part A), well inside the engine's 3 s wait, so the classic HUD no longer opens beside an installed Deck. It opens only when a started Deck does not connect or is lost, and the chat is told (`deck_fallback`).
- **Question 2 is not answered.** No probe run reproduced the dead input. Measured and ruled out: minutes hidden, each WebView2 hide setting, the late reconnect through the page timer, VS Code in front at the show, and the classic HUD open. Not recreated: a real chat's engine and Deck content, a Deck running for many edits, and the Deck at its position of 2026-10-10 (x 1790, y 1836; the probe's Deck was at x 1476, y 1764, from the position saved in between). The `over` lines (`over.rs`) record any window over the Deck while it is shown, for the next time.
- The fix removes the conditions of 2026-10-10 that came before the dead input: the late reconnect and the classic HUD opening first. Whether the dead input needed them is [unverified]; Part B checks the whole path.
- Part B ran the Deck without `over.rs` (Observed): its first use in a real chat is still to come.
- That WebView2's timer throttling slowed the hidden Deck's reconnect is [inference]. The wake makes the reconnect independent of it.
