---
report: Phase 1 — Bridge and Develop write path
phase: 1
status: template
authored_by: "Template, harness and pre-run findings: Claude Code (Opus 5.5), 2026-09-26. Observed: Jim (pending). Numbers, Consequences: Claude Code after Jim's run. Verdict: Jim."
date: 2026-09-26 (template)
---

# Phase 1 — Bridge and Develop write path

## Purpose

Can the engine drive Lightroom's Develop settings through the plugin bridge: write a change, read it back, name the History step, and undo everything with a snapshot?

PHASES.md, quoted (`PHASES.md:34`): "Acceptance: from a Node test script, apply `exposure +0.5` to the active photo and read it back; History shows the named step; snapshot revert works; both confirmed by Jim with a screenshot path in the report."

PHASES.md gives Phase 1 no go / conditional / no-go rule beyond this acceptance line. **Jim's choice for the confirmation (2026-09-26):** the check asks him two y/n questions in PowerShell instead of a screenshot path [stated: "y/n in PowerShell", chosen from the options Claude Code offered]. He also chose to **probe the value ranges in the same run** [stated: "Probe in the same run"].

## Harness

| Part | Files |
|---|---|
| Lightroom plugin | `plugin\LrC-AVG.lrplugin\`: `Info.lua`, `PluginInit.lua` (starts the bridge when the plugin loads), `Bridge.lua` (receive 8765 / send 8766, JSON lines, bridge token, monitor loop, status file), `Develop.lua` (`get_context`, `get_settings`, `apply_settings`, `create_snapshot`, `apply_snapshot`), `Json.lua`, `Log.lua`, `MenuStatus.lua` (File > Plug-in Extras > "LrC-AVG - Bridge status") |
| Engine bridge | `engine\src\bridge\`: `protocol.ts` (zod schemas for every line), `lines.ts` (framing, P-14), `client.ts` (connect, hello, 2 s heartbeat, reconnect, request/response by id) |
| Params map | `engine\src\params\` (PR #13): canonical names → SDK keys, camera-profile pairs, read-back comparison |
| The check | `engine\src\devtools\phase1-check.ts` (the steps) and `phase1-check-cli.ts`; run with `npm run phase1:check` |

What the check does, all on the selected photo and under one Develop snapshot (`engine\src\devtools\phase1-check.ts` header):

1. Reads the bridge token the plugin wrote to `%USERPROFILE%\.lrc-avg\bridge_token`, connects and exchanges `hello`. Pings with a non-ASCII text, five messages in flight at once, and 20 in a row for timing.
2. Reads the photo's context and settings. It stops before any write unless the photo is raw, on process version 15.4, and has room for exposure +0.5 (below +4.5).
3. Makes the snapshot `AVG P1 check <time>`.
4. **Acceptance write:** exposure +0.5 with History name `AVG P1check pass 1/9`, read back. The nine writes of steps 4–7 are named `AVG P1check pass 1/9` to `pass 9/9` (the FR-4.4 form, rule 03-lightroom).
5. Writes two camera-profile pairs through the params map (Adobe Landscape, then Camera Landscape with `Look = {}`), each read back (P-07, P-12, P-17).
6. Turns both lens switches off, then on (P-16; writing "on" was unverified after S5).
7. **Range probe:** all 57 numeric parameters at their minimum, at their maximum, then 1 % of the range below the minimum and above the maximum. Four writes, each read back.
8. **Acceptance revert:** applies the snapshot and compares every setting with step 2.
9. Asks Jim two y/n questions.

Results go to `%TEMP%\LrC-AVG\P1\p1_check_<time>.json`, with a copy of the plugin's log `bridge.log`. Claude Code collects them.

### Steps for Jim

Do these after Claude Code says PR B is merged.

1. If Lightroom Classic is open, close it with **File > Exit**. Then start Lightroom Classic.
2. Choose **File > Plug-in Manager…**. If the list on the left already shows **LrC-AVG (Autonomous Vision Gateway)**, click **Done** and go to step 3. Otherwise click **Add** (bottom left), go to `D:\Developer\LrC_Autonomous_Gateway\plugin\`, click the folder **LrC-AVG.lrplugin**, click **Select Folder**, and then **Done**.
3. In the Library module, click **20260907-_OZ80093.NEF** so it is selected, then press **D** to open it in Develop.
4. In VS Code's PowerShell terminal, at `D:\Developer\LrC_Autonomous_Gateway`, run:

   ```powershell
   npm run phase1:check
   ```

   You should see `Connected`, then lines starting with `OK` or `DONE`, then `Photo put back to how it was: YES`. The photo in Lightroom changes several times while this runs and ends as it started.
5. The command asks two questions. Look at Lightroom's Develop module, then type `y` or `n` and press Enter for each:
   1. Is there a step named `AVG P1check pass 1/9` in the **History** panel (left side)?
   2. Does the photo look the same as before the check?
6. The last lines say `Phase 1 acceptance: WORKED` or `FAILED`, and `Results saved automatically`. Tell Claude Code "done".

### If something goes wrong

- If the command prints `Reason: no bridge token`, the plugin is not running: restart Lightroom (**File > Exit**, then start it) and run the command again.
- If the command prints `FAILED: could not connect to Lightroom` with any other reason, choose **File > Plug-in Extras > LrC-AVG - Bridge status** in Lightroom.
  - If the dialog title says **NOT RUNNING**, restart Lightroom (**File > Exit**, then start it) and run the command again.
  - If it says **RUNNING, engine NOT connected**, run the command once more. If it fails again, tell Claude Code.
- If **File > Plug-in Extras** has no "LrC-AVG - Bridge status" item, open **File > Plug-in Manager**, click LrC-AVG, and tell Claude Code what the status box on the right says.
- If the command prints `not a raw file`, do step 3 again, then step 4.
- If the command prints `+0.5 would pass +5`, tell Claude Code (the NEF's exposure was +0.33 in Phase 0, so this is not expected).
- If the command prints `Photo put back to how it was: NO`, don't change the photo, and tell Claude Code. The snapshot `AVG P1 check …` is in the **Snapshots** panel (left side of Develop).
- If Lightroom shows an error dialog, click OK and tell Claude Code.
- If a Windows Firewall window appears, click **Cancel** and tell Claude Code. The bridge only uses connections inside this computer (127.0.0.1).

## Pre-run findings (Claude Code)

Checks Claude Code ran on 2026-09-26, before Jim's run. None of them involve Lightroom.

- **Engine tests pass: 145 of 145** [handle: `npm test` on branch `phase-1/bridge` after the Greptile round-1 fixes, output "Test Files 8 passed (8), Tests 145 passed (145)"]. `npm run build` and `npm run typecheck` pass too. The new tests are:
  - `engine\tests\bridge-client.test.ts` (18 tests): the client against a fake plugin, a Node stand-in for `Bridge.lua` that speaks the same line protocol and checks the token. It covers the handshake, requests matched by id when answers come back out of order, five in flight at once, non-ASCII text, structured errors, timeouts and late answers, malformed lines, a reply split inside a UTF-8 character, events, a drop after three missed heartbeats with a reconnect, the event socket being closed, a protocol-version mismatch, a stale token (refused, then reconnected with the new one), no token file, and quiet retries while nothing listens. The client and check tests passed 6 runs out of 6 [handle: `npx -w engine vitest run tests/bridge-client.test.ts tests/phase1-check.test.ts` ×6].
  - `engine\tests\bridge-lines.test.ts` (9 tests): the line framing, including the length limit on unfinished and on completed lines.
  - `engine\tests\phase1-check.test.ts` (7 tests): the check itself against a **simulated plugin**. The simulation starts from the live S5 NEF dump (`docs\reports\phase0\S5\s5_20260907-_OZ80093.NEF.json`) and imitates snapshots, `Look = {}` clearing the Look, and `[]` for empty tables. Clamping one key and ignoring another are made up there to exercise the probe's categories. These are **Node numbers, not Lightroom's**.
  - `engine\tests\lua-plugin.test.ts`: every `.lua` file under `plugin\` parses as Lua 5.1 with `luaparse` 0.3.1. It also checks that no file uses the `utf8` library, that `LrC-AVG.lrplugin` requires only its own files, that `Info.lua` names files that exist, and that every `applyDevelopSettings` call passes a History name. `luaparse` in 5.1 mode rejects `//`, `goto` and labels [handle: a scratch probe run by Claude Code on 2026-09-26: `7 // 2`, `goto done` and `::label::` each raised a parse error].
- **Dry runs of the command against a scratch simulated plugin** on ports 8765/8766 found three harness bugs, all fixed before this PR:
  - the summary was cut off because the script called `process.exit()` right after printing;
  - two y/n answers given at once lost the second;
  - a below-minimum value that was ignored was reported as "clamped".
  The failure paths print a plain FAILED headline and exit with code 1: no connection (after 20 s), and an answer of `n`.
- **The Lua has not run inside Lightroom yet.** Its SDK calls follow patterns that ran in Phase 0: sockets in `plugin\spikes\S2.lrplugin\S2Server.lua`; `applyDevelopSettings`, snapshots and read-back in `plugin\spikes\S5.lrplugin\S5WriteTests.lua`. Everything Lightroom-side is [unverified] until Jim's run, including these:
  - the `getRawMetadata` / `getFormattedMetadata` keys in `get_context` (a key that fails is listed in `metadata_errors`);
  - that `LrPathUtils.getStandardFilePath("home")` and Node's `os.homedir()` are the same folder, so both find `.lrc-avg\bridge_token` (Automaat relies on the same [upstream claim: `vendor\automaat\plugin\LightroomMCP.lrplugin\PluginInfoProvider.lua:87-93`, `vendor\automaat\server\src\token.ts:5-26`]);
  - that Lightroom's temp folder is `%TEMP%` (the check copies `bridge.log` from `%TEMP%\LrC-AVG\` if it is there);
  - the `LrForceInitPlugin` start-up.

## Observed (Jim)

<!-- Nothing to paste. The check saves everything to %TEMP%\LrC-AVG\P1\ (p1_check_<time>.json with Jim's two answers, p1_bridge_log_<time>.txt). Jim says "done"; Claude Code copies the files to docs\reports\phase1\P1\ and fills this section and Numbers from them. -->

## Numbers

<!-- Filled by Claude Code from the collected results file. -->

| Field | Value | Source field in `p1_check_*.json` |
|---|---|---|
| Connected, time to connect | | `connect_ms`, `hello` |
| Non-ASCII round trip / 5 in flight | | `pings.utf8.ok`, `pings.in_flight.ok` |
| Round trip, 20 pings (median, min, max) | | `pings.rtt_ms` |
| Exposure start → target → read back | | `exposure` |
| `applyDevelopSettings` time, exposure write | | `steps[0].apply_ms` |
| Other keys changed by the exposure write | | `steps[0].changed_keys` |
| Profile pairs read back and identified | | `steps[1..2]` |
| Lens off / on read back | | `steps[3..4]` |
| Range probe: limits taken as written (min, max) | | `range_probe.min_accepted`, `max_accepted` |
| Range probe: one step beyond (below, above) | | `range_probe.below_min`, `above_max` |
| Snapshot revert: settings that differ | | `revert.differing_keys` |
| Jim: History step seen / photo looks restored | | `jim` |
| Metadata keys the SDK refused | | `photo.metadata_errors` |
| Plugin log found under `%TEMP%\LrC-AVG\` | | `plugin_log_copied` |

## Verdict

<!-- Jim: is Phase 1 accepted? The check prints a suggestion ("WORKED" / "FAILED"); the verdict is Jim's. -->

## Consequences / open questions

**Protocol details PR B settled that ARCHITECTURE §3 does not state.** Claude Code proposes them for Jim to accept in PR C [inference: each follows from the Phase 0 inputs or the design rule named].

| # | Detail | Why |
|---|---|---|
| C-1 | A response carries `ok`; on failure it has `error: {code, message, recoverable}` instead of `payload` | PRD NFR-7 structured errors |
| C-2 | Every photo command takes an optional `target_uuid`; the plugin refuses with `target_mismatch` if the selected photo differs | A change of selection can never redirect a write (ARCHITECTURE §1 design rule: the plugin holds the target identity) |
| C-3 | `apply_snapshot {snapshot_id}` instead of `{id}`; `create_snapshot` returns `snapshot_id` and `id_global` | P-05; keeps `id` for the envelope |
| C-4 | `hello` is a command with `protocol: 1` (the engine's handshake), and the plugin also sends a `hello` event when the send socket connects | FR-1.2; lets both sides refuse a protocol mismatch |
| C-5 | The engine connects 8765, waits 500 ms, then connects 8766 | P-13: the plugin rebinds its send socket for a new client first |
| C-6 | The plugin shows the engine as disconnected after 6 s without a message (three 2 s heartbeats, FR-1.3), and rebinds both sockets after 20 s | Windows may not report a vanished client [upstream claim: `vendor\automaat\plugin\LightroomMCP.lrplugin\PluginInfoProvider.lua:558-560`]; the 20 s figure is [inference] |
| C-7 | The plugin refuses an `apply_settings` whose History name does not start with `AVG ` | FR-4.4; rule 03-lightroom |
| C-8 | Every command carries `token`: the plugin writes a random token to `%USERPROFILE%\.lrc-avg\bridge_token` at start and refuses other commands with `unauthorized`; the engine reads the file before each connection and reconnects on `unauthorized` | Without it any local program, or a web page posting to 127.0.0.1:8765, could send Develop commands (Greptile P1 on PR #14). Jim chose the token file on 2026-09-26 [stated]; pattern from Automaat [upstream claim: `PluginInfoProvider.lua:87-127, 313-319`] |

**Open until Jim's run:** everything under "Pre-run findings" marked [unverified]; the real range limits (they replace the [unverified] slider limits in `engine\src\params\canonical.ts`); whether writing lens "on" works.

**Not tested in Phase 1:** round trips while Lightroom is busy exporting (Phase 2); behaviour across a plugin reload; partial Look tables; Look identity; `grading.shadows/highlights` hue and saturation mapping to `SplitToning*` keys (written by the range probe but not checked against the Color Grading panel) [inference].
