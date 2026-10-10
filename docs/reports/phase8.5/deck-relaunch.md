---
report: deck-relaunch
phase: "8.5"
status: template
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

- `npm run deck:idle-probe` (`hud\probe\idle.ts`, mouse helper `hud\probe\input.ts`). It needs Lightroom open and Claude Desktop quit, and runs four runs, about 25 minutes. Each run:
  - starts the Deck with `LRC_AVG_DECK_IDLE` set (both, no_memory, no_visible; `hud\src-tauri\src\webview.rs`);
  - shows the Deck for a stand-in edit, ends it, and closes the channel as the engine's idle release does;
  - waits 30 s or 420 s;
  - opens the channel again and launches the Deck a second time, as the engine does at the next begin, which now wakes the running Deck (`hud\src-tauri\src\wake.rs`);
  - moves the mouse onto Accept and clicks.

  It records whether the page saw the pointer (`pointer_in`), whether the Deck sent the click and the stand-in engine got it, which process's window was under the point, and how long the Deck took to connect again. Results: `%TEMP%\LrC-AVG\deck-idle\idle_<stamp>.json`, plus a copy of each Deck log.
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
   - While hidden, the Deck sets WebView2 `IsVisible` false and its memory target Low (`hud\src-tauri\src\webview.rs`). Which of the two stops input after minutes is [unverified]: the probe measures it.

Built on this branch before the probe (Deck 0.3.3, engine 0.25.1):
- `wake.rs`: a second launch sets the event `Local\LrC-AVG-HUD-wake` and exits; the running Deck waits on it in a Rust thread and asks its page to connect now (`window.deckWake`, `hud\ui\deck.ts`). Test: `wake::tests` (cargo).
- `sinks.ts`: when the classic HUD opens because a started Deck did not connect, or was lost, the next session tool result says so in `hud_actions` (`deck_fallback`). A Deck that is not installed is no fallback. Test: `engine\tests\hud-fallback.test.ts`.
- Diagnostics in the Deck's log: `accept_at` at each show, and `pointer_in` on the first pointer move after it.

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

Claude Code writes these steps when the fix from Part A is in.

### If something goes wrong

- If it prints "FAILED: Lightroom is not running", open Lightroom and run step 3 again.
- If it prints "FAILED: Claude Desktop's engine is running", quit Claude Desktop (step 1) and run step 3 again.
- If a run says COVERED, a window was over the Deck's Accept. Tell Claude Code "done" anyway: the results name the window.

## Observed (Jim)

*(Part A: the probe's results, collected by Claude Code from `%TEMP%\LrC-AVG\deck-idle\`.)*

*(Part B: the Lightroom check.)*

## Numbers

| Run | Hidden | Verdict | Pointer seen | Click sent | Engine got it | Connected again after |
|---|---|---|---|---|---|---|
| both | 30 s | | | | | |
| both | 420 s | | | | | |
| no_memory | 420 s | | | | | |
| no_visible | 420 s | | | | | |

## Verdict

*(Jim.)*

## Consequences / open questions

- The input fix follows from the probe's runs, in this PR.
- That WebView2's timer throttling slowed the hidden Deck's reconnect is [inference]. The wake makes the reconnect independent of it.
