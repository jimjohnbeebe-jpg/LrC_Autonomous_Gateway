---
report: AVG-P7-5 the menu items with the Deck
phase: 7
status: template
authored_by: "Template, harness and pre-run findings: Claude Code (Opus 5.5), 2026-10-05, branch phase-7/plugin-menu (vault PHASE7_PLAN row 5). Observed: Jim. Verdict: Jim."
date: 2026-10-05
---

# AVG-P7-5: the menu items with the Deck

## Purpose

Until row 5, every File > Plug-in Extras item opened the classic window, which takes the keyboard, even with the Deck showing (spec `docs\hud\lrc-avg-hud-spec-v2.md` D1, "Known conflict"). Row 5 is the plugin release (0.18.0) that fixes it, with engine 0.20.0 and Deck 0.3.0. This probe checks on Jim's machine, in real edits, that:
- while a Deck is connected, a menu item that was sent leaves the classic window closed, and the Deck shows what follows;
- "LrC-AVG - Show Vision Gateway HUD" brings up the Deck opened, and Lightroom keeps the keyboard (Q4);
- a refused menu item still opens the classic window, which says why (plan decision D1 A);
- with no Deck, the menu works as before: the classic window opens by itself at an edit's start, and from the Show item.

PHASES.md gives no go/no-go rule for a row probe. The plan's rule: every line YES.

Answers and decisions [stated: Jim, 2026-10-05]:
- Q4: "Show Deck, keep keys (Recommended)". With a Deck connected and an edit open, the Show item asks the engine to show the Deck opened, without the keyboard.
- Q17: "No, Deck shows path (Recommended)". The plugin does not open its classic window by itself when Claude has been away 10 s. While the engine is away, the plugin cannot know of a Deck, so the Show item opens the classic window and its Put back, as the Deck's hint says (`hud\ui\text.ts` `PUT_BACK_PATH`).
- Plan: "Go with recommendations". D1 A: a refused item still opens the classic window. D2 A: this probe, with real edits and the photo put back.

**When the Deck is uninstalled again:** if any line is not YES, as in row 4c (`hud\probe\menu.ts` header).

## Harness

- `hud\probe\menu.ts` (run by `npm run deck:menu`) and `hud\probe\menu-kit.ts`. Unlike rows 4b and 4c, it runs the real engine from `engine\dist` against Lightroom, as Claude Desktop's engine does, but without the chat. The plugin's menu items are what is checked, and they talk to the engine over the bridge.
- It installs the Deck 0.3.0, then makes two edits on the photo selected in Lightroom (intent `neutral_technical_correction`, one exposure step of +0.1 in the first). Each edit ends with "revert". At the end the photo is compared with its settings before the probe, and the first edit's snapshot is applied again if anything differs. The result is line P.
- The plugin's own log (`%TEMP%\LrC-AVG\bridge.log`, read from where the probe started) shows whether the classic window opened (`hud: shown`) and what each menu item did. The Deck's log shows its `show` with reason `menu`.
- Results: `%TEMP%\LrC-AVG\deck-probe\menu_<run>.json`, and the folder `menu_<run>\` with the Deck's log, the plugin's log lines, the tool log and the session logs. Claude Code collects them into `docs\reports\phase7\plugin-menu\`.

### Steps for Jim

1. In Lightroom: File > Plug-in Manager > LrC-AVG (Autonomous Vision Gateway) > Reload Plug-in, then Done. (This loads plugin 0.18.0.)
2. Quit Claude Desktop: File > Exit.
3. In Lightroom, go to Develop and select one photo (a raw file). The probe edits it twice and puts it back.
4. In PowerShell at the repo root, run:
   ```powershell
   npm run deck:menu
   ```
5. Follow the window. It asks you to click on the Deck or choose File > Plug-in Extras items, then asks a y/n question each time. Answer y when what it describes happened.
6. The last line reads `Menu probe: WORKED` or `Menu probe: FAILED (…)`, then `PUT BACK: YES` or `NO`, and says whether the Deck stays installed. Tell Claude Code "probe done".

### If something goes wrong

- If the probe says Lightroom runs a plugin other than 0.18.0, do step 1 and run the command again.
- If it says Claude Desktop's engine is running or another engine holds the bridge, quit Claude Desktop from its tray icon (right-click > Quit), wait a minute, and run the command again.
- If it says to select exactly one photo, select one photo in Lightroom's filmstrip and run the command again.
- If a menu item seems to do nothing, the probe waits 3 minutes for it, records NO and goes on. Answer the questions that follow and finish the run.
- If the last line says `PUT BACK: NO`, tell Claude Code before you edit that photo.

## Pre-run findings (Claude Code)

1. **Engine tests.** `npm test`: 83 files, 1066 passed, 1 skipped. The new `engine\tests\hud-deck-menu.test.ts` has 9 tests:
   - hud_deck at each Deck connect and loss, again after a bridge reconnect, the newest value after one in flight, a failed one tried again, none to a plugin before 0.18.0;
   - `reveal` for the open edit only, only to a Deck from 0.3.0;
   - the plugin's menu code read as text.

   [handle: `npm test` output, 2026-10-05.] One earlier full run failed `hud-selection-poll` once. It passed alone 3 of 3 times and in the next full run; it is the load-timing test the row 4b report names.
2. **Mutants.** 6 of 6 mutants of `engine\src\hud\deck-menu.ts` were killed by `hud-deck-menu.test.ts`: the plugin version gate, the resend at reconnect, the open-edit check, the Deck version gate, the retry, and the follow-up after an answer [handle: this session's scratchpad `mutants.mts` output, 2026-10-05].
3. **Deck tests.** `npm test -w hud`: 38 passed (vitest, including the new `onReveal` case in `hud\ui\visibility.test.ts`); cargo 5 passed [handle: output, 2026-10-05].
4. **Lua.** `engine\tests\lua-plugin.test.ts` parses every plugin file as Lua 5.1 and checks that `Dispatch.lua` handles exactly the engine's commands, `hud_deck` included [handle: `npx vitest run tests/lua-plugin.test.ts`, 2026-10-05]. Whether the menu items behave so in Lightroom is [unverified] until this probe.
5. **Not dry-run.** The probe makes real edits through the real bridge, so it was not run against a stand-in plugin. Its first live run is Jim's.

## Observed (Jim)

*To be filled from the run.*

## Numbers

| Line | What | Result |
|---|---|---|
| M1a | the Deck connected and the plugin heard it | |
| M1b | no classic window at the edit's start | |
| M1c | Jim: the Deck opened by itself, no classic window | |
| M2a | Show asked the engine for the Deck, and the Deck showed itself | |
| M2b | no classic window | |
| M2c | Jim: the Deck came back opened; Lightroom kept the keyboard | |
| M3a | the refused Pick A opened the classic window | |
| M3b | Jim: it says why | |
| M4a | the menu's Abort was sent, the Deck took the outcome | |
| M4b | the edit ended as aborted | |
| M4c | no classic window | |
| M4d | Jim: Done, the photo is back | |
| M5a | the plugin heard the Deck went away | |
| M5b | with no Deck, the classic window opened by itself | |
| M5c | with no Deck, Show opened the classic window | |
| M5d | Jim: the classic window opened from the menu | |
| P | the photo as before the probe | |

## Verdict

*Jim's.*

## Consequences / open questions

- [inference] A Deck that has just died, but that the engine has not yet dropped (3 missed pings, about 6 s), still counts as connected. A menu item in that window leaves the classic window closed. The event still reaches the engine, whose Deck-lost path starts the Deck again or opens the classic window (`engine\src\hud\sinks.ts`).
- Q17 stays as decided: no classic window opens by itself while Claude is away.
