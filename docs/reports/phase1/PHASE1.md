---
report: Phase 1 — Bridge and Develop write path
phase: 1
status: accepted
authored_by: "Template, harness and pre-run findings: Claude Code (Opus 5.5), 2026-09-26. Observed: Jim ran the check three times on 2026-09-26 (runs 1-2 FAILED before any write; run 3 WORKED after PR #15) and answered its questions; Claude Code collected the files and wrote the analysis, Numbers and Consequences. Verdict and decisions: Jim (Phase 1 accepted, C-1 … C-8 accepted, LR_SDK_NOTES entries approved, rule 04 amended; 2026-09-26)."
date: 2026-09-26 (runs 1-3)
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

What the check is written to do, all on the selected photo and under one Develop snapshot. This list describes the code [handle: `engine\src\devtools\phase1-check.ts` header and `runPhase1Check`; `plugin\LrC-AVG.lrplugin\Bridge.lua` `newToken` and `handleLine`], and it has run only against a simulated plugin (see "Pre-run findings"). Whether each step works against Lightroom is [unverified] until Jim's run.

1. Reads the bridge token the plugin is written to put in `%USERPROFILE%\.lrc-avg\bridge_token` at start [unverified in Lightroom], connects and exchanges `hello`. Pings with a non-ASCII text, five messages in flight at once, and 20 in a row for timing.
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

### Runs 1 and 2 (2026-09-26): FAILED before any write

Jim ran the steps after PR #14 merged and reported "done (failed)" [stated]. The check ran twice: at 20:25:11Z, then at 20:28:20Z after a Lightroom restart. The plugin log shows a new start at 13:27:32 local time [handle: `P1\p1_bridge_log_2026-09-26T20-28-20-636Z.txt`]. Claude Code copied the files from `%TEMP%\LrC-AVG\` into `docs\reports\phase1\P1\`, replacing the Windows user folder with `%USERPROFILE%` in the three files that contained it (both bridge logs and the status file):

| File | Written by | Content |
|---|---|---|
| `p1_check_2026-09-26T20-25-11-309Z.json` | the check, run 1 | results up to the failure |
| `p1_bridge_log_2026-09-26T20-25-11-309Z.txt` | `Bridge.lua` (copied by the check) | plugin log for run 1 |
| `p1_check_2026-09-26T20-28-20-636Z.json` | the check, run 2 | results up to the failure |
| `p1_bridge_log_2026-09-26T20-28-20-636Z.txt` | `Bridge.lua` | plugin log, runs 1 and 2 |
| `bridge_status_after_run2.json` | `Bridge.lua` status file, as copied (its `updated_at` is 20:31:43Z) | bridge state about 3 minutes after run 2 |

**What worked in Lightroom** (same in both runs; figures from run 2, `p1_check_2026-09-26T20-28-20-636Z.json`):
- The plugin started with Lightroom, wrote its token, and listened on 8765/8766 (`bridge: token written …`, `bridge: listening` in the log).
- The engine found the token and connected in 511 ms. The plugin's `hello` reported protocol 1, plugin 0.1.0, Lightroom 15.5.1 (`hello`, `connect_ms`).
- The non-ASCII nonce `AVG P1 é漢字 ✓` came back identical, and five requests in flight all came back correctly (`pings.utf8`, `pings.in_flight`).
- 20 sequential pings: median 0.35 ms, min 0.28 ms, max 0.55 ms (`pings.rtt_ms`).
- `get_settings` returned 177 keys, process version 15.4, all pinned; the params map named the profile **Camera Neutral** (`photo`).
- The status file counted 29 commands handled and 0 failed (`bridge_status_after_run2.json`: hello, 26 pings, `get_context`, `get_settings`).

**What failed:** `get_context` returned the uuid (`C19DDC67-…`) and `local_id` 3869533, but all 13 metadata reads raised **`Yielding is not allowed within a C or metamethod call`** (`photo.metadata_errors`). Without a file format, the check stopped ("not a raw file") before making the snapshot or writing anything: `steps` is empty, and neither log has a `create_snapshot` or `apply_settings` line. The photo was not changed, and no question was asked.

**Cause:** `Develop.lua` wrapped each `getRawMetadata` / `getFormattedMetadata` call in a plain `pcall`. In Lua 5.1 a task cannot yield across a plain `pcall`, and these calls yield. The same `getRawMetadata("uuid")` call without a `pcall`, inside the same read gate, worked [inference from the two observations above]. Rule 03-lightroom already says to use `LrTasks.pcall` in task code; `Develop.lua` broke it. **Fix (`fix/p1-metadata-pcall`):**
- `Develop.lua` uses `LrTasks.pcall`, and so do the socket `send()`/`close()` calls in the bridge task.
- The plain `pcall`s that remain carry a `-- plain pcall: <why>` comment (pure-Lua JSON, the cleanup handler, the init script). `engine\tests\lua-plugin.test.ts` enforces this; it fails on the run-1 code at `Bridge.lua:134`.
- The check now says when the plugin could not read the file format, instead of calling the photo "undefined, not a raw file".

**Also seen:** about 3 minutes after run 2 ended, the status file still had `send_connected: true` while `receive_connected` was false [handle: `P1\bridge_status_after_run2.json`, `updated_at` 20:31:43Z, `seconds_since_last_message` 202.6]. So the send socket had not noticed its client leaving, while the receive socket had: its `bridge: receive: closed` is the last line of the log copy, which the check took as run 2 ended [handle: `P1\p1_bridge_log_2026-09-26T20-28-20-636Z.txt`, line 20]. That matches S2 [handle: `docs\reports\phase0\S2.md` "Consequences": the send socket did not fire `onClosed` when the client disconnected]. After run 1 the same log does show `bridge: send: closed`, but at 13:27:07 local time, about two minutes after the engine left (13:25:11) and 25 s before Lightroom started again (13:27:32) [handle: same log, lines 9-12]. That close most likely came from Lightroom shutting down, not from the client leaving [inference]. The plugin is written to rebind the send socket when the next engine connects on the receive side while the send socket still looks connected [handle: `plugin\LrC-AVG.lrplugin\Bridge.lua`, receive `onConnected`; P-13]. Whether that rebind works in Lightroom is [unverified]: runs 1 and 2 were the first engine connection of each Lightroom session, so no rebind was needed.

### Run 3 (2026-09-26, after PR #15): WORKED

Jim restarted Lightroom, ran the check once more, answered both questions, and reported "done (worked)" [stated]. Claude Code copied two files into `docs\reports\phase1\P1\`. `p1_check_2026-09-26T21-06-50-295Z.json` is byte-identical to the temp original. `p1_bridge_log_2026-09-26T21-06-50-295Z.txt` differs only in its three token-path lines, where the user folder is replaced by `%USERPROFILE%` [handle: the copy step compared each copy with its original after reversing the replacement, run by Claude Code on 2026-09-26].

**The three acceptance lines** (`PHASES.md:34`), with the file `p1_check_2026-09-26T21-06-50-295Z.json`:
- **Exposure +0.5 from a Node script, read back:** 0.33 → 0.83, read back 0.83 (`exposure`). The write, History name `AVG P1check pass 1/9`, changed only `Exposure2012` (`steps[0].changed_keys`) with no read-back mismatch (`steps[0].mismatches`).
- **History shows the named step:** Jim answered `y` to "is there a step named "AVG P1check pass 1/9"" (`jim.history_step_seen`) [stated, through the check].
- **Snapshot revert works:** `apply_snapshot` put the photo back with **0 of 177** settings differing from the start (`revert`). Jim answered `y` to "does the photo look the same as before the check" (`jim.photo_looks_restored`) [stated, through the check].

The check's suggestion was `WORKED` (`summary.acceptance_suggestion`); the verdict below is Jim's.

**The other checks in the same run:**
- **Bridge:** it connected in 521 ms, first try; there were no drops, no malformed lines and no late responses (`connect_ms`, `bridge_stats`). The non-ASCII round trip and five requests in flight both came back correctly (`pings`).
- **`get_context`:** all 13 metadata keys read without error (`photo.metadata_errors` is empty); the file format is `RAW`. The fix in PR #15 works.
- **Camera profile pairs (P-07, P-12, P-17):**
  - Adobe Landscape, as `Adobe Standard` plus its full Look table, then Camera Landscape with `Look = {}`, each crossed the bridge as JSON.
  - Each changed only `CameraProfile` and `Look`, read back identical, and the params map named it correctly (`steps[1]`, `steps[2]`).
- **Lens (P-16):** turning both switches off, then on, changed exactly `EnableLensCorrections` and `LensProfileEnable` each time and read back as sent (`steps[3]`, `steps[4]`). **Writing "on" works**; S5 had left this open.
- **Write time:**
  - `applyDevelopSettings` inside the write gate took 23.4–41.5 ms over the nine writes (`steps[*].apply_ms`).
  - From the plugin receiving each `apply_settings` to it receiving the check's next command, **453–983 ms** passed [handle: timestamps in `p1_bridge_log_2026-09-26T21-06-50-295Z.txt`]. This receipt-to-receipt interval is not the command's own duration. Besides the write and its `getDevelopSettings` read-back, it includes sending the response, the check's verification of it, and the check sending its next command. The command's completion was not timed separately.
  - The read-back is probably most of that interval, since the write itself took 23–42 ms [inference]. The two range-probe writes that touch 57 keys had the longest intervals (769 and 983 ms).
- **Start-up:** the plugin started with Lightroom, without any menu click (first log line, `bridge: starting generation 1`). `LrInitPlugin` with `LrForceInitPlugin` works on 15.5.1.

**Range probe (Jim's choice), all 57 numeric parameters** (`range_probe`):
- **All 114 limits read back exactly as written:** min 57/57, max 57/57. The engine's ranges are values Lightroom takes.
- **Four keys clamp one step beyond, to exactly the limit, on both sides:** exposure (−5.1 → −5, 5.1 → 5), temperature (1520 → 2000, 50480 → 50000), tint (−153 → −150, 153 → 150), sharpening radius (0.475 → 0.5, 3.025 → 3) (`per_parameter[*].below_read`, `above_read`).
- **The other 53 keys don't take an out-of-range value at all.** They read back as they were before the check, on both sides, and nothing reports an error.
  - All 53 match the same NEF's values in the S5 dump [handle: Claude Code compared `per_parameter[*].below_read` and `above_read` with `docs\reports\phase0\S5\s5_20260907-_OZ80093.NEF.json`: 53 of 53 equal, 0 mismatches]. Examples: highlights −21, shadows 10, texture 4, clarity 2, blending 50, sharpness 24.
  - The value the probe had just written (the maximum) did **not** stay. So Lightroom did not simply skip the key; it went back to the photo's earlier value. Whether that is the value before the check or the photo's default settings cannot be told apart on this photo [inference].
- **The check's own labels are misleading here:**
  - For these 53 keys it said `other` below the minimum and `ignored` above the maximum (`below_min`, `above_max`).
  - Its 13 "clamped" below the minimum include 9 keys whose minimum is also their value before the check (0): the four grading hues, the four grading saturations, and sharpening masking. The S5 comparison puts those 9 with the 53.
  - The counts above are the corrected reading.
- **What the engine takes from this:** the limits in `engine\src\params\canonical.ts` are now sourced from this run. Lightroom silently drops out-of-range values, so the engine's own range check (FR-4.2) and the read-back (P-12) are both needed. Without them, an out-of-range step would look applied but leave the slider where it was.

## Numbers

Run 3, from `docs\reports\phase1\P1\p1_check_2026-09-26T21-06-50-295Z.json` unless a row says otherwise.

| Field | Value | Source field in `p1_check_*.json` |
|---|---|---|
| Connected, time to connect | yes, 521 ms; plugin 0.1.0, protocol 1, LrC 15.5.1 | `connect_ms`, `hello` |
| Non-ASCII round trip / 5 in flight | intact / all 5 correct | `pings.utf8.ok`, `pings.in_flight.ok` |
| Round trip, 20 pings (median, min, max) | 0.37 ms, 0.23 ms, 0.76 ms | `pings.rtt_ms` |
| Exposure start → target → read back | 0.33 → 0.83 → 0.83 | `exposure` |
| `applyDevelopSettings` time, exposure write (all nine writes) | 25.5 ms (23.4–41.5 ms) | `steps[0].apply_ms` (`steps[*].apply_ms`) |
| Plugin receives `apply_settings` → plugin receives the check's next command (receipt-to-receipt; includes write, read-back, response and the check's verification; command completion not timed separately) | 453–983 ms | timestamps in `p1_bridge_log_2026-09-26T21-06-50-295Z.txt` |
| Other keys changed by the exposure write | none | `steps[0].changed_keys` |
| Profile pairs read back and identified | Adobe Landscape: yes; Camera Landscape (`Look = {}`): yes | `steps[1..2]` |
| Lens off / on read back | yes / yes (both keys each time) | `steps[3..4]` |
| Range probe: limits taken as written (min, max) | 57/57, 57/57 | `range_probe.min_accepted`, `max_accepted` |
| Range probe: one step beyond | 4 keys clamped exactly to the limit; 53 not taken (read back as before the check) | `range_probe.per_parameter`, compared with the S5 NEF dump |
| Snapshot revert: settings that differ | 0 of 177 | `revert.differing_keys` |
| Jim: History step seen / photo looks restored | y / y | `jim` |
| Metadata keys the SDK refused | 0 of 13 (runs 1-2: 13 of 13, plain `pcall`) | `photo.metadata_errors` |
| Plugin log found under `%TEMP%\LrC-AVG\` | yes | `plugin_log_copied` |

## Verdict

<!-- Jim: is Phase 1 accepted? The check prints a suggestion ("WORKED" / "FAILED"); the verdict is Jim's. -->
**Phase 1 accepted** (Jim, 2026-09-26, chosen from the options Claude Code offered, which recommended accepting) [stated: "Accept Phase 1"]. The three acceptance lines of `PHASES.md:34` are met by run 3 ("Run 3" above):
- exposure +0.5 from a Node script, read back;
- the History step `AVG P1check pass 1/9`, seen by Jim;
- the snapshot revert, 0 of 177 settings differing, with the photo looking restored to Jim.

Jim confirmed the Lightroom-side lines through the check's y/n questions instead of the screenshot path the line names, as he chose on 2026-09-26 (see "Purpose").

Jim's decisions on this report, the same day, each chosen from options Claude Code offered [stated]:
- **"Accept all 8"** for C-1 … C-8: they go into ARCHITECTURE §3 after this PR merges, each marked "Phase 1, C-n".
- **"Write them in"** for the LR_SDK_NOTES proposals under "Consequences".
- **"Amend rule 04"**: `.claude\rules\04-workflow.md` now lets Jim choose, per check, how an observation is asked (a Lightroom dialog by default, or another way he names), recorded in the check's report. The change is in this PR.

## Consequences / open questions

**Protocol details PR B settled that ARCHITECTURE §3 does not state.** Claude Code proposes them for Jim to accept in PR C [inference: each follows from the Phase 0 inputs or the design rule named]. Each row describes the code as written [handle: `plugin\LrC-AVG.lrplugin\Bridge.lua`, `Develop.lua`; `engine\src\bridge\client.ts`, `protocol.ts`].
- **Run 3 exercised the normal path** of C-1 (`ok: true` responses), C-2 (every command after `get_context` carried the matching `target_uuid`), C-3, C-4, C-5, C-7 (nine valid History names) and C-8 (token accepted) [handle: run 3 results and log].
- **Not exercised in Lightroom** [unverified]: the refusal paths (`target_mismatch`, `unauthorized`, a History name without `AVG `, an error response) and C-6's timing. The engine-side tests cover each of them against the fake plugin (`engine\tests\bridge-client.test.ts`).

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

**For LR_SDK_NOTES (proposed; the architect's doc, not edited here):** `photo:getRawMetadata(key)` and `photo:getFormattedMetadata(key)`, called from a task inside `catalog:withReadAccessDo` and wrapped in a plain `pcall`, raised "Yielding is not allowed within a C or metamethod call" for all 13 keys tried, on LrC 15.5.1; wrap them in `LrTasks.pcall` or call them unwrapped [handle: `docs\reports\phase1\P1\p1_check_2026-09-26T20-28-20-636Z.json` `photo.metadata_errors`]. Automaat's notes say only non-yielding per-photo metadata reads belong inside the read gate [upstream claim: `vendor\automaat\CLAUDE.md`, Architecture]; that these reads yield at all is Claude Code's reading of the error [inference]. `LrPathUtils.getStandardFilePath("temp")` is `%TEMP%`: the check found the plugin's `bridge.log` in `%TEMP%\LrC-AVG\` [handle: `plugin_log_copied` in both run files]. `LrPathUtils.getStandardFilePath("home")` and Node's `os.homedir()` are the same folder: the engine read the token the plugin wrote [handle: `hello` in both run files].

**Also for LR_SDK_NOTES (proposed), from run 3:**
- `photo:applyDevelopSettings` takes every Develop limit the engine uses exactly (57 numeric keys at their minimum and maximum). **One step beyond, it clamps only `Exposure2012`, `Temperature` (raw), `Tint` (raw) and `SharpenRadius` to the limit. For the 53 others it silently does not take the value; the key reads back as the photo's earlier value, with no error** [handle: `docs\reports\phase1\P1\p1_check_2026-09-26T21-06-50-295Z.json` `range_probe`, and the S5 comparison in "Run 3"]. This extends Phase 0's finding that a malformed `CameraProfile` is silently ignored (P-12).
- Writing `EnableLensCorrections = true` and `LensProfileEnable = 1` works [handle: same file, `steps[4]`].
- A camera-profile pair written through JSON (full Adobe Look table, or `Look = {}`) reads back identical [handle: same file, `steps[1..2]`].
- `getRawMetadata` / `getFormattedMetadata` wrapped in `LrTasks.pcall` inside `withReadAccessDo` read all 13 keys, `lens` and `cameraModel` included [handle: same file, `photo.metadata_errors` empty].
- `applyDevelopSettings` takes 23–42 ms [handle: `steps[*].apply_ms`]. From the plugin receiving an `apply_settings` (write, then `getDevelopSettings` read-back) to it receiving the client's next command took 0.45–1 s. That interval is an upper bound for the command, not its measured duration [handle: the run-3 log timestamps].

**Consequence for the pass budget (P-02, about 3 s per pass):** a write with its read-back may cost up to about 0.5–1 s over the bridge (the upper bound above), on top of the ~2.6 s export (S1). That may push a pass above 3 s. Phase 2 should time the write command itself and a whole pass; whether the read-back can be cheaper (for example, read only the written keys) is a Phase 2 question [inference].

**Resolved by run 3:** the [unverified] items under "Pre-run findings":
- all 13 metadata keys;
- Lightroom's temp folder is `%TEMP%`;
- the home folder is the same for the plugin and Node;
- `LrForceInitPlugin` start-up works;
- the real range limits (now in `engine\src\params\canonical.ts` with this run as their handle);
- writing lens "on".

**Not tested in Phase 1:** round trips while Lightroom is busy exporting (Phase 2); behaviour across a plugin reload; the send-socket rebind when a second engine connects in the same Lightroom session (P-13; every run here was the first connection); partial Look tables; Look identity; `grading.shadows/highlights` hue and saturation mapping to `SplitToning*` keys (written by the range probe but not checked against the Color Grading panel) [inference].
