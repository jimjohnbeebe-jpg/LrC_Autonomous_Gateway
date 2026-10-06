---
report: AVG-P7-4c the Deck's states probe
phase: 7
status: template
authored_by: "Template, harness and pre-run findings: Claude Code (Opus 5.5), 2026-10-05, branch phase-7/deck-ui (vault PHASE7_PLAN row 4c). Observed and verdict: Jim."
date: 2026-10-05
---

# AVG-P7-4c: the Deck's states probe

## Purpose

Row 4c draws the Deck's states, its copy cards, its keyboard and its clicks (spec `docs\hud\lrc-avg-hud-spec-v2.md` 5.2, 5.3, 6, 7, 4.6; Option C `docs\hud\option-c\NOTES.md` sections 2-3) on row 4b's shell. This probe checks on Jim's machine that the Deck:
- opens at full height at each edit;
- sends the right click for each button and key;
- hands the keyboard back to Lightroom after a click;
- shows the pick with cards;
- shows the way back when Claude is gone.

It covers acceptance lines A1, A6, A11, A13-A18 as spec 2.7 amends them. Row 6 checks the whole of 11.1 in real edits.

PHASES.md gives no go/no-go rule for a row probe. The plan's rule: every line YES. The plan's decisions [stated: Jim, 2026-10-05]:
1. "Opened by default. It needs to be intuitive, meaning the user doesn't have to guess what is going on." Every new edit opens the Deck at 144 px. Within an edit, the size the user picks holds.
2. "Go with recommended." Copy cards show the thumbnail, letter and label, and the guardrail line; the copy's name shows on hover. They do not show each copy's changes beyond the baseline (that needs Option C's field 3, an engine change: a later item).
3. "Go with recommended." Notes are shown as the engine sends them; the engine drops none for the Deck (Option C field 12 stays open).
4. "Yes." The Deck stays installed after the probe, so real edits use it. The classic window stays the fallback. Until row 5, the File > Plug-in Extras items still open the classic window too.
5. "Go with recommendation." As in 4b: a stand-in engine, y/n answers in PowerShell.

**When the Deck is uninstalled again:** if any line is not YES. A Deck that failed here never replaces the classic HUD in a real edit (`hud\probe\states.ts` header).

## Harness

- `hud\probe\states.ts` (run by `npm run deck:states`) and `hud\probe\kit.ts`. A stand-in engine, the engine's own `HudChannel` and `HudLauncher` from `engine\dist`, sends made-up states for three short edits of a photo named `deck-probe.NEF`. It answers each click as the engine does: an `answer`, then the next state. No photo is edited and nothing is written to the catalog.
- The probe installs the Deck (per user, no admin rights), waits for Jim's clicks and keys (up to 3 min each), and checks what the Deck sent:
  - the `event` for each click, with its name and pass or copy letter;
  - `show` for a chosen card (E12);
  - the Deck's own log line `focus_lightroom` after a pointer click.
- Results: `%TEMP%\LrC-AVG\deck-probe\states_<run>.json` and a copy of the Deck's log. Claude Code collects them into `docs\reports\phase7\deck-ui\`.

### Steps for Jim

1. Open Lightroom Classic and go to the Develop module (any photo).
2. Quit Claude Desktop: File > Exit. (The probe stops if Claude Desktop's engine is running.)
3. In PowerShell at the repo root, run:
   ```powershell
   npm run deck:states
   ```
4. Follow the window. It asks you to click a button on the Deck, click the Deck's sentence and press keys, then asks a y/n question each time. Answer y when what it describes happened.
5. The last line reads `Deck states probe: WORKED` or `Deck states probe: FAILED (…)`, and says whether the Deck stays installed. Tell Claude Code "probe done".

### If something goes wrong

- If the probe says Lightroom is not running, open Lightroom and run the command again.
- If it says Claude Desktop's engine is running, quit Claude Desktop from its tray icon (right-click > Quit) and run the command again.
- If it says the installer is not built yet, tell Claude Code; it runs `npm run deck:build`.
- If a click or key seems to do nothing, the probe waits 3 minutes for it, records NO and goes on. Answer the questions that follow and finish the run.

## Pre-run findings (Claude Code)

1. **Build.** `npm run deck:build` built `hud\src-tauri\target\release\bundle\nsis\LrC-AVG HUD_0.2.0_x64-setup.exe` (1.35 MiB) [handle: tauri-cli output "Finished 1 bundle at: …\LrC-AVG HUD_0.2.0_x64-setup.exe (1.35 MiB)", 2026-10-05]. The probe now picks the installer of the hud version in `hud\package.json`, since older ones stay in that folder (`kit.ts` `installer`).
2. **Tests.**
   - `npm test -w hud`: vitest 37 of 37 and cargo 5 of 5.
   - `hud\ui\view.test.ts` drives spec 5.2's rows in order, with states the engine's `hudChannelStateSchema` accepts. It also checks the overlays and the one-primary rule, and scans the wording for the words spec 10 bans.
   - The other test files: `clicks.test.ts` (the 10 s click wait, the 3 s arming, the chosen card), `keys.test.ts` (the key map) and `rows.test.ts` (Lightroom's number format, the track).
   - Engine: `npm test` 1057 passed, 1 skipped (no engine change).

   [handle: the vitest and cargo summaries "Tests 37 passed (37)", "test result: ok. 5 passed", "Tests 1057 passed | 1 skipped (1058)", 2026-10-05]
3. **Headless renders** of the Deck's own `view()` and `html()` for 15 made-up states, in headless Edge, so no window opened on the desktop: `docs\reports\phase7\deck-ui\renders\` (driver verbatim in `renders.txt`).
   - **Fixed from them:**
     - the opened deck's class `x` also matched the hide button's `.x` rule, so it drew 28 px wide (now `open` and `hidebtn`);
     - right-column lines and the "Target changed" line were cut short (they now wrap to two lines; the left column's tooltip has the whole text);
     - the Enter keycap showed while Abort was armed.
   - **Found reading the code after the PR opened:** a click on a Deck that did not have the keyboard (the usual case, since the Deck hands it back to Lightroom after each click) activates the window. The `focus` event then redrew the Deck between mouse-down and mouse-up, and a click whose two halves land on different elements is dropped [inference: the browser's click rule, not tried in the Deck]. Now key hints are shown and hidden by a CSS class, with no redraw on focus, and a pointer press counts when mouse-down and mouse-up are on the same control by its `data-act`/`data-card` (`hud\ui\deck.ts` `keyOf`), so a state arriving mid-click no longer loses it either.
   - **At the default 1200 px width:** one column of four slider rows, then "+n more"; cards with the thumbnail on top and the guardrail mark beside the name, the sentence in the card's tooltip. **At 1800 px:** two columns of rows, full cards with the sentence. **At 960 px**, the Deck's minimum since Greptile's review (it was 640 px, too narrow for the opened deck: `hud\src-tauri\src\place.rs` `MIN_W`), the rows and three cards still fit (`renders\*-960.png`).
4. **Dry run of the probe's start with Notepad standing in for Lightroom** (`LRC_AVG_HUD_LR_EXE=notepad.exe`, stopped after S1). The installer put hud 0.2.0 where the engine looks. C1, S1a and S1b were YES (the S1b answer was scripted, so it means nothing here). The Deck's log: `"version":"0.2.0"`; placed at `[1020,1872,1800,216]`, the opened height (144 CSS px at scale 1.5); shown with `fg_pid` 11896, not the Deck's 23136. So it opened without taking the foreground [handle: `%TEMP%\LrC-AVG\hud\hud_23136_1791256268150.jsonl` lines "start", "place", "show", 2026-10-05]. Claude Code then uninstalled the Deck by hand (`uninstall.exe /S`; the folder was gone) and deleted the stale `hud_endpoint.json` the stopped run left (its pid 22608 was dead) [handle: `ls` "No such file or directory", 2026-10-05].
5. **[unverified] until the probe:**
   - that a click on the Deck's sentence (a drag region) gives the Deck the keyboard (S3, S5);
   - that `SetForegroundWindow` hands the keyboard back to Lightroom after a pointer click (S2b; `hud\src-tauri\src\window.rs` `focus_lightroom`);
   - that thumbnails show under the page's CSP, now `img-src 'self' data:` (`tauri.conf.json`).

## Observed (Jim)

*(Jim fills this in: the run's time, the probe's headline, and any n answers.)*

## Numbers

| Line | What | Result |
|---|---|---|
| C1 | the Deck connected within 3 s | |
| S1a, S1b | opened at the edit's start, working, rows, keyboard stayed with Lightroom | |
| S2a-c | Approve pass 1 sent; keyboard back to Lightroom; click line and grey buttons | |
| S3a-d | Ctrl+Backspace arms, Esc disarms, nothing aborted; Enter sends Accept; Done | |
| S4a, S4b | one click sends Abort; Done, photo back | |
| S5a-e | three cards, no Accept; card click shows copy B; 3 then Enter picks C; Picked | |
| S6 | the triangle closes and opens the deck | |
| S7, S7b | not connected: undo and Put back paths, grey buttons; reconnects | |
| C2 | the Deck stays installed (all YES) or was uninstalled | |

## Verdict

*(Jim: go, or what to change.)*

## Consequences / open questions

- Row 5 (`phase-7/plugin-menu`): until it lands, a File > Plug-in Extras item opens the classic window beside the Deck (spec D1 "Known conflict"). Q4 (a keyboard way into the Deck) and Q17 are asked there.
- Later items (FEEDBACK, decision 2 and 3): each copy's changes on its card (Option C field 3); notes that repeat the headline left out for the Deck (field 12).
- Not drawn: the timeline above 8 passes shows only its words. Option C's track form for long edits is left out (a `ponytail:` note in `hud\ui\glyphs.ts`).
