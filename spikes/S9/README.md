# AVG-S9: the Tauri HUD shell (Phase 7 row 1)

**Question (spec `docs\hud\lrc-avg-hud-spec-v2.md`, D2 "Spike S9"):** does a Tauri 2.12 window meet the HUD's budgets and window rules next to Lightroom Classic on Jim's machine? There are twelve rows, S9-1 to S9-12: cold start, warm show, update to paint, idle memory, CPU, showing without taking the keyboard, topmost only while Lightroom is in front, following Lightroom's window, surviving the engine, exiting with Lightroom, Lightroom's responsiveness, and size. **A failed gated row is a STOP for Jim; there is no fallback runtime** (spec D2).

Report: [`docs\reports\phase7\S9.md`](../../docs/reports/phase7/S9.md).

## What the harness is

| File | What it does |
|---|---|
| `measure.ts` | **The one command Jim runs.** Starts the stub engine, which starts the HUD; measures; asks y/n in the PowerShell window; saves `%TEMP%\LrC-AVG\S9\s9_<run>.json` |
| `stub-engine.ts` | A stand-in for the engine's HUD channel (spec 3.3), on 127.0.0.1 only. It writes `%USERPROFILE%\.lrc-avg\hud_endpoint.json` (port, token, pid), checks the HUD's token, and sends the scripted states W (working), V (pick a copy) and C (converged). No Claude, and no connection to Lightroom |
| `channel.ts` | The channel's messages as zod schemas, used by both the stub and the HUD's UI. WebSocket on 127.0.0.1 with one JSON message per frame, in place of 3.3's raw TCP [stated: Jim, 2026-10-04, "Use recommendations for websocket"] |
| `tauri\` | The HUD: a minimal Tauri 2.12.1 app. `ui\` is the TypeScript UI: the channel client and the collapsed Deck bar, adapted from `docs\hud\option-c\option-c.html`. `src-tauri\` is Rust, which owns only the window: it shows and hides through Win32 (`ShowWindow` with `SW_SHOWNA` / `SW_HIDE`, never Tauri's `show()`/`hide()`), is topmost only while Lightroom or the HUD is in front, follows Lightroom's window, and exits when Lightroom exits (`src\win.rs`). It logs to `%TEMP%\LrC-AVG\S9\hud_<pid>_<start ms>.jsonl` |
| `win32.ts` | The Win32 reads `measure.ts` needs, through koffi: foreground window, window rectangles, visibility, z-order, and memory and CPU over the HUD's process tree |
| `harness.ts`, `auto.ts`, `jim.ts`, `summary.ts` | The stub as a child process and the prompts; the hands-off measurements; Jim's steps; each gate against its target (a suggestion only) |
| `prereqs.ps1` | Checks Rust (MSVC), the Microsoft C++ Build Tools, WebView2 and Node, and prints the install step for anything missing |

**It changes nothing in Lightroom.** It never talks to the LrC-AVG plugin or its ports. The only change to a photo is the Exposure drag Jim makes in S9-11, which he undoes. The deck sits 144 px above the bottom of Lightroom's window, the filmstrip band's height on the mockup stage. Lightroom's real filmstrip height is [unverified] (spec 13.2, item 26), and S9-8 asks Jim where the bar landed.

That is what the harness is written to do. What Lightroom and Windows actually do is [unverified] until Jim's run.

## Building (Claude Code)

```powershell
powershell -ExecutionPolicy Bypass -File spikes\S9\prereqs.ps1
npm run s9:build -w spikes
```

`s9:build` writes `spikes\S9\tauri\ui-dist\` and then runs `tauri build --bundles nsis`. That produces `spikes\S9\tauri\src-tauri\target\release\lrc-avg-s9-hud.exe` and the NSIS installer under `target\release\bundle\nsis\`; S9-12 reports both sizes. All three paths are gitignored. Claude Code builds the HUD on Jim's machine before the run, so Jim installs nothing.

## Steps for Jim

The y/n questions are asked in the PowerShell window [stated: Jim, 2026-10-04, "S9, powershell"]. The run takes about 15 minutes, and its last step quits Lightroom.

1. Start **Lightroom Classic**. Click a photo and press **D** to open it in Develop.
2. Start **Claude Desktop**. Leave it open, not minimised.
3. In the PowerShell window in VS Code, run:

   ```powershell
   node spikes\S9\measure.ts
   ```

4. Do what the window says:
   - **Part 1 (hands-off, about 4 minutes):** press Enter, click once on the photo in Lightroom, then leave the mouse and keyboard alone until the window beeps. A dark bar keeps appearing and disappearing at the bottom of Lightroom: that is the test.
   - **Part 2 (six short steps):** each step says what to do in Lightroom, then asks one to four y/n questions. Answer with `y` or `n` and press Enter.
   - **The last step** asks you to quit Lightroom (**File > Exit**).
5. The window ends with a summary that starts `S9 SUGGESTED:` and a `Results:` line. Tell Claude Code: **"S9 done."**

## S9b re-run (after the first run)

**Why.** The first run (2026-10-05 03:22 UTC) failed S9-4 (memory 158.9 MiB) and S9-5 (CPU 0.55 % hidden, 2.11 % visible) narrowly. The harness also recorded no S9-8 episode: you pressed Enter before the moves, as every other step had asked. And the bar visibly trailed Lightroom's window during drags [stated: Jim, 2026-10-04, "there was a very large amount of latency with the bar when moving the Lightroom main window"]. You chose a follow-up [stated: "S9b follow-up (Recommended)"; "Hide, reappear in place (Recommended)"].

**What changed:**
- **The bar hides while you drag or resize Lightroom** and comes back in place when you let go (`tauri\src-tauri\src\drag.rs`).
- **WebView2 runs without its GPU process** (`--disable-gpu` in `tauri.conf.json`), which in Claude Code's checks cut memory to about 105-111 MiB.
- **S9-8 asks for Enter first, then again when you are done.** It measures how long the bar was visible out of place, and asks two more questions.
- The other gates stand from the first run. Evidence: `docs\reports\phase7\S9b-prerun\prerun.txt`.

### Steps for Jim (S9b)

About 6 minutes. Claude Desktop is not needed, and Lightroom stays open.

1. Start **Lightroom Classic**. Click a photo and press **D** to open it in Develop.
2. In the PowerShell window in VS Code, run:

   ```powershell
   node spikes\S9\measure.ts --s9b
   ```

3. **Part 1 (hands-off, about 4 minutes):** press Enter, click once on the photo in Lightroom, then leave the mouse and keyboard alone until the window beeps.
4. **Part 2 (S9-8):** the window lists five things to do. **Press Enter first**, then do the five things in Lightroom, then come back and press **Enter again**. Answer the six questions with `y` or `n`.
5. Tell Claude Code: **"S9b done."**

## If something goes wrong

- **The window says "Lightroom Classic is not open" or "Claude Desktop is not open":** start it, then press Enter in the window. It tries three times.
- **The window says "FAILED: the HUD is not built":** stop and tell Claude Code.
- **No bar appears in Part 1 within 20 seconds:** wait for the beep anyway. The results record it.
- **You touched the mouse during Part 1:** carry on. The results record whether Lightroom stayed in front.
- **You answered a question wrongly:** carry on, and tell Claude Code which one when you say "S9 done".
- **You want to stop:** press **Ctrl+C** in the window. The bar closes, and what was measured so far is saved.
- **The bar is still there after the window has ended:** tell Claude Code.
