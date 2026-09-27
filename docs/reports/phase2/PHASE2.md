---
report: Phase 2 — MCP server, preview and vision
phase: 2
status: accepted
authored_by: "Template, harness and pre-run findings: Claude Code (Opus 5.5), 2026-09-26. Observed: Jim ran npm run phase2:check on 2026-09-26 (run 1 could not connect; run 2 Part 1 worked, Part 2 was blocked by ENGINE_BUSY until fix PR #19, then worked) and answered its six questions; Claude Code collected the files and wrote the analysis, Numbers and Consequences. Verdict and decisions: Jim (Phase 2 accepted, pass budget ~3.5 s, all doc proposals accepted; 2026-09-26)."
date: 2026-09-26 (runs 1-2)
---

# Phase 2 — MCP server, preview and vision

## Purpose

Can Claude, in Claude Desktop, look at the photo selected in Lightroom, change a Develop setting through the engine, and look at the result?

PHASES.md, quoted (`PHASES.md:61-64`):
- "Engine as stdio MCP server (Automaat's server skeleton, tools rewritten): `lr_get_active_photo_context`, `lr_get_preview`, `lr_get_metrics` (basic histogram + clipping only)."
- "Preview pipeline with freshness contract and export fallback."
- "Claude Desktop config; Claude can look at the active photo and change one slider via `lr_step`-lite (`lr_set_settings`, temporary)."
- "Acceptance: a chat session in Claude Desktop where Claude describes the fixture, changes exposure, and describes the change — log path in the report."

PHASES.md gives Phase 2 no go / conditional / no-go rule beyond this acceptance line. Its open items from Phase 0 (`PHASES.md:69`) and Phase 1 (`PHASES.md:52-56`), each measured by the check:
- export time at smaller long edges;
- the export's embedded ICC profile;
- the `LR_jpeg_quality` range;
- the write command's own duration against the ~3 s pass budget (P-02);
- round trips while Lightroom exports;
- the send-socket rebind when a second engine connects.

**Jim's decisions (2026-09-26)** [stated: "go with recommendations", on the plan Claude Code offered]:
1. `lr_set_settings` takes absolute values. Deltas, decay and guardrails come with `lr_step` in Phase 3.
2. `lr_get_preview` has no region crop yet; that comes with `lr_set_regions` in Phase 3.
3. `lr_set_settings` names the photo by the uuid of an earlier result, and the plugin refuses the write if another photo is selected (C-2).
4. **How the check asks Jim:** y/n questions in PowerShell, as in Phase 1, with the Claude Desktop chat as a step inside the same command (rule 04 lets Jim choose this per check).

## Harness

| Part | Files |
|---|---|
| MCP server (PR #17; fix PR #19) | `engine\src\mcp\`: `main.ts` (stdio entry, `engine\dist\mcp\main.js`), `server.ts` (tool list, zod validation, content blocks), `tools.ts` (the four tools), `errors.ts` (`{code, message, recoverable}`), `bridge-gate.ts` and `instance-lock.ts` (one engine per bridge: a listener on 127.0.0.1:8767; since PR #19 taken on the first tool call and given back after 60 s without one), `dev-overrides.ts` (ports and token file for scratch runs) |
| Preview and metrics (PR #17) | `engine\src\preview\service.ts` (export path → read, delete, hash; only inside `%TEMP%\LrC-AVG\previews`), `engine\src\metrics\basic.ts` (luma histogram and mean, clipping overall and per channel), `engine\src\log\tool-log.ts` (one JSON line per tool call) |
| Plugin (PR B) | `plugin\LrC-AVG.lrplugin\Preview.lua` (`export_preview`: an `LrExportSession` JPEG, the S1 settings), `Develop.lua` (rating, pick and label in `get_context`; `read_ms` and `command_ms` in `apply_settings`), `Bridge.lua` (plugin 0.2.0) |
| Claude Desktop | `engine\src\devtools\desktop-config.ts` and `install-desktop-config-cli.ts`, run with `npm run desktop:install` |
| The check | `engine\src\devtools\phase2-check.ts` (the steps), `phase2-collect.ts` (the chat's logs), `phase2-check-cli.ts`; run with `npm run phase2:check` |

**What `npm run desktop:install` is written to do.** It adds the server `lrc-avg` to Claude Desktop's `claude_desktop_config.json`. The entry runs this repo's Node on `engine\dist\mcp\main.js`, with `LRC_AVG_LOG_DIR` set to the repo's `logs\`. It removes the S3 test server `lrc-avg-spike-s3`, the set-up item in `PHASES.md:46`. It writes a backup first, reads the result back, and changes nothing the second time. This is the S3 installer, generalised; Jim ran that one on 2026-09-26 [handle: `docs\reports\phase0\S3.md` "Steps 2-3"].

**What `npm run phase2:check` is written to do**, on the selected photo and under one Develop snapshot. This describes the code [handle: `engine\src\devtools\phase2-check.ts` header and `runPhase2Check`]. It has run only against simulated plugins (see "Pre-run findings"); against Lightroom it is [unverified] until Jim's run.

*Part 1*, through the same `Tools` class the MCP server uses:
1. Takes the engine lock, connects, and checks that the plugin is 0.2.0.
2. Reads the photo's context. It stops before any write unless the photo is raw, on process version 15.4, with room for exposure +1.0.
3. Makes the snapshot `AVG P2 check <time>`.
4. Exports at long edges 800, 1200 and 1600 px, three times each.
5. Exports at JPEG quality 60 and 90, to see whether the file size follows.
6. Pings every 200 ms while an export runs.
7. Makes three `lr_set_settings` passes: exposure +0.5, +1.0, then back to the start. They are named `AVG P2check set 1` to `set 3`, and each returns its preview and is timed part by part.
8. Applies the snapshot and compares every setting with the start.
9. Releases the lock and asks two y/n questions.

*Part 2*, the acceptance line:
1. Jim opens Claude Desktop and sends one fixed sentence. Claude Desktop's engine connects to the plugin after the check's engine has left.
2. The check asks three y/n questions.
3. It collects Claude Desktop's MCP log and the engine's tool log from the time of the chat, with the user folder redacted.
4. Jim clicks the snapshot to undo the chat's change. The check asks a sixth y/n question, whether the photo is back; WORKED needs a yes.
5. The headline `Phase 2 acceptance: WORKED / FAILED` covers the passes, the revert, Jim's answers and the chat. A second line, `Pass budget: n of 3 passes within ~3 s`, reports the timing on its own: the budget (P-02) is a measurement Phase 2 takes, not part of its acceptance line (`PHASES.md:64`).

Results go to `%TEMP%\LrC-AVG\P2\`:
- `p2_check_<time>.json`;
- `p2_desktop_mcp_log_<time>.txt`;
- `p2_chat_tool_log_<time>.jsonl`;
- `p2_check_tools_<time>\`;
- `p2_bridge_log_<time>.txt`.

Claude Code collects them.

### Steps for Jim

Do these after Claude Code says PR B is merged.

1. In Lightroom Classic, choose **File > Exit**. Then start Lightroom Classic again. This loads plugin 0.2.0.
2. In the Library module, click **20260907-_OZ80093.NEF** so it is selected, then press **D** to open it in Develop.
3. Right-click the Claude icon in the Windows system tray → **Quit**.
4. In VS Code's PowerShell terminal, at `D:\Developer\LrC_Autonomous_Gateway`, run:

   ```powershell
   npm run desktop:install
   ```

   It ends with `Done: add "lrc-avg", remove "lrc-avg-spike-s3"` (or `"lrc-avg" is already set up`).
5. In the same terminal, run:

   ```powershell
   npm run phase2:check
   ```

   You should see `Connected (… ms, plugin 0.2.0)`, export times, three lines starting with `OK`, and `Photo put back to how it was: YES`. The photo in Lightroom changes a few times while this runs and ends as it started. It takes about a minute.
6. The command asks two questions. Look at Lightroom's Develop module, then type `y` or `n` and press Enter for each:
   1. Are there three steps named `AVG P2check set 1`, `set 2` and `set 3` in the **History** panel (left side)?
   2. Does the photo look the same as before the check?
7. The command prints the Part 2 steps. Do them:
   1. Start Claude Desktop (Start menu > Claude).
   2. Open a new chat, type this sentence and press Enter:
      `Look at the photo selected in Lightroom and describe it. Then raise its exposure by 0.5 EV and describe what changed.`
   3. If Claude Desktop asks whether Claude may use an lrc-avg tool, allow it.
   4. Wait until Claude has answered both parts. Then go back to the terminal and press Enter.
8. The command asks three questions. Type `y` or `n` and press Enter for each:
   1. Did Claude describe the photo correctly?
   2. Is the photo in Lightroom now brighter, with Exposure 0.5 higher than before the chat?
   3. Did Claude describe the change correctly?
9. The command says `Last step`: in the **Snapshots** panel (left side of Develop), click the snapshot it names (`AVG P2 check …`). That puts the photo back as it was. Then answer its sixth question with `y` or `n`: did you click it, and does the photo look as before the check?
10. The last lines say `Phase 2 acceptance: WORKED` or `FAILED`, `Pass budget: …`, and `Results saved automatically`. Tell Claude Code "done".

### If something goes wrong

- If `npm run desktop:install` prints `FAILED`, nothing was changed. Tell Claude Code what it says.
- If `npm run phase2:check` prints `another LrC-AVG engine is using the Lightroom bridge`, Claude Desktop is still running: do step 3 again, then step 5.
- If it prints `Lightroom is running LrC-AVG plugin 0.1.0`, do step 1 again, then step 5.
- If it prints `could not connect to Lightroom` and the reason says `no bridge token`, do step 1 again, then step 5. With any other reason, choose **File > Plug-in Extras > LrC-AVG - Bridge status** in Lightroom and tell Claude Code what the dialog title says.
- If it prints `not a raw file`, do step 2 again, then step 5.
- If it prints `+1.0 would pass +5`, tell Claude Code (the NEF's exposure was +0.33 in Phase 1).
- If it prints `Photo put back to how it was: NO`, don't change the photo, and tell Claude Code. The snapshot `AVG P2 check …` is in the **Snapshots** panel.
- If in step 7 Claude says it has no Lightroom or lrc-avg tools, answer `n` to the three questions and tell Claude Code; it reads Claude Desktop's log itself.
- If Lightroom shows an error dialog, click OK and tell Claude Code.
- If a Windows Firewall window appears, click **Cancel** and tell Claude Code. The engine only uses connections inside this computer (127.0.0.1).

## Pre-run findings (Claude Code)

Checks Claude Code ran on 2026-09-26, before Jim's run. None of them involves a Lightroom Develop change.

- **Engine tests: 216 pass** on branch `phase-2/preview-check` (PR #17 left 190) [handle: `npm test` after the Greptile round-1 fixes on PR #18, "Test Files 15 passed (15), Tests 216 passed (216)"]. `npm run build` and `npm run typecheck` pass too.
  - `mcp-tools.test.ts`, `mcp-server.test.ts`, `mcp-lock.test.ts`: the tools and the MCP server, tested against the fake plugin with a **simulated Lightroom**, `engine\tests\helpers\lightroom-sim.ts`. The simulation starts from the live S5 NEF dump; its "export" is a grey-noise JPEG whose mean follows `Exposure2012`. The MCP server is reached through a real MCP client over the SDK's in-memory transport. These are **Node numbers, not Lightroom's.**
  - `metrics-basic.test.ts`: the metrics on hand-made pixel buffers.
  - `phase2-check.test.ts`: the whole check, with a second engine standing in for Claude Desktop's during Part 2.
  - `phase2-collect.test.ts`, `desktop-config.test.ts`.
  - `lua-plugin.test.ts`: every command in `protocol.ts` has a handler in `Bridge.lua`, and the plugin version matches the check's.
- **Stdio smoke tests** of `engine\dist\mcp\main.js`, driven by the SDK's stdio client. Observed:
  - the server started and listed its four tools in 479 ms;
  - with two engines, the second answered `ENGINE_BUSY` and named the first one's PID;
  - invalid arguments came back as `INVALID_ARGUMENTS`;
  - the engine exited when stdin closed [handle: PR #17 description and triage comments].
  - **These smoke tests reached Jim's running Lightroom plugin twice (hello only, no Develop command)** [handle: `%TEMP%\LrC-AVG\bridge.log`, 2026-09-26 14:56:42 and 15:07:20]. The environment overrides in `dev-overrides.ts` exist so later runs use a scratch plugin instead.
- **Dry run of `npm run phase2:check`**, end to end, against a scratch plugin on ports 18765–18767 with its own token file. The dry run passed:
  - The real `main.js` played Claude Desktop in Part 2 (preview, then exposure +0.5).
  - The check printed `Phase 2 acceptance: WORKED`, and its three passes were within ~3 s (scratch timings, not Lightroom's).
  - It found the chat's two tool calls in the engine's tool log. Claude Desktop's log was "NOT found", as expected with no Claude Desktop.
- **ICC profile (open item):** the Lightroom-exported fixture JPEG carries a 3,144-byte sRGB profile. sharp decodes it to identical pixels with and without the profile: 0 of 8,386,560 bytes differ [handle: Claude Code, sharp 0.35.4, `raw()` vs `raw()` with `ignoreIcc` on `fixtures\20260907-_OZ80093.jpg`]. The engine passes an export that fits the long edge on unchanged, profile included. A JPEG it re-encodes carries no profile.
- **Windows port lock:** a second `listen` on one 127.0.0.1 port fails with `EADDRINUSE` [handle: Claude Code, Node v24.11.1 win32].
- **`os.tmpdir()` is `%TEMP%`** [handle: `node -e`, true]. It is also the plugin's temp folder: the Phase 1 check found `bridge.log` there.
- **Not yet run inside Lightroom** [unverified until Jim's run]:
  - `Preview.lua`'s export into `<temp>\LrC-AVG\previews\<id>\`, and finding the JPEG with `LrFileUtils.files`;
  - `LR_jpeg_quality = quality / 100`;
  - the metadata keys `rating`, `pickStatus`, `colorNameForLabel`;
  - the new timings in `apply_settings`;
  - Claude Desktop starting `lrc-avg` from the MSIX config.

## Observed (Jim)

Jim ran the steps on 2026-09-26 and said "done" [stated]. The check saved its files to `%TEMP%\LrC-AVG\P2\`; Claude Code copied them, already redacted, to `docs\reports\phase2\P2\` (checked: no file holds the user name or the token value). Times below are local (UTC−7) unless marked Z. `P2\…` means that folder; "run 2" is `P2\p2_check_2026-09-26T23-55-03-940Z.json`.

### Run 1 (16:54): could not connect

The check stopped before any command: `could not connect to Lightroom (127.0.0.1:8765: ECONNREFUSED)` [handle: `P2\p2_check_2026-09-26T23-54-25-650Z.json` `errors`; its plugin-log copy is `P2\p2_bridge_log_2026-09-26T23-54-25-650Z.txt`]. Lightroom was still starting: the plugin began at 16:54:50 and listened from 16:55:00 [handle: `P2\p2_bridge_log_2026-09-26T23-55-03-940Z.txt` lines 60-62]. Nothing was written.

### Run 2 (16:55 → 18:53): WORKED, after fix PR #19

**Part 1 (16:55:03 → 16:55:47): worked.**
- Connected in 523 ms to plugin 0.2.0 on LrC 15.5.1 (`hello`, `connect_ms`).
- 9 exports, 2 quality exports and an export with pings during it all worked. The three passes `AVG P2check set 1-3` read back as written, each with its preview; the snapshot then restored all 177 settings exactly (`passes`, `revert`).
- Jim: the three History steps were there, and the photo looked as before [stated: `jim_part1` y / y].

**Part 2 (the chat): blocked, fixed, then worked.**
- **Blocked by `ENGINE_BUSY`.** At 16:55:50 Claude Desktop started two lrc-avg engines, PIDs 2304 and 12632, both children of `claude.exe` 10416. Engine 2304 took the engine lock at start-up but was never called; every chat call went to 12632 and was answered `ENGINE_BUSY` (16:57:01, 16:57:03, 17:45:09) [handle: `P2\p2_chat_tool_log_…jsonl` lines 1-3; `P2\p2_desktop_mcp_log_…txt`; the process list Claude Code read with `Get-CimInstance Win32_Process`]. Nothing was read or written.
- Lightroom was restarted at 17:44:57 and 18:50:58 [handle: bridge log lines 100, 108]. That Jim restarted it while troubleshooting is [inference].
- **Jim chose "fix first"** [stated]. Fix PR #19 (`06e72d9`): an engine takes the lock on its first tool call and gives it back after 60 s without one. Jim quit and reopened Claude Desktop, which again started a short-lived engine and then two engines (01:50:03Z-01:50:05Z) [handle: `P2\p2_desktop_mcp_log_…txt`, two "ready" lines].
- **18:50:45: the first call failed `BRIDGE_DISCONNECTED`** after its 5 s wait, `ECONNREFUSED` on 8765. Lightroom had just restarted, and the plugin listened only from 18:51:07 [handle: chat tool log line 4; bridge log lines 108-110]. Claude retried.
- **18:51:23 → 18:51:51: the acceptance chat.**
  - `lr_get_active_photo_context` worked;
  - `lr_get_preview` returned the 1600 px image (export 3,622 ms);
  - `lr_set_settings` set exposure 0.89 → 1.39 and read it back, with History step `AVG debf set 1`, a new preview, mean luma +14.6 and a whole pass of 3,129 ms [handle: chat tool log lines 5-7].
  - The called engine took the lock on that first call and gave the bridge back after 60 s idle, as PR #19 intends [handle: desktop log, last lines].
- **Jim:** Claude described the photo correctly; the photo was brighter with Exposure 0.5 higher; Claude described the change correctly; after the snapshot click the photo looked as before the check [stated: `jim_part2` y / y / y / y].
- The check printed `Phase 2 acceptance: WORKED` and `Pass budget: 0 of 3 passes within ~3 s` (`summary`).

**Exposure 0.89 before the chat:** the check's revert left 0.33 at 16:55:47, and the plugin received no `apply_settings` between then and the chat's write at 18:51:48 [handle: bridge log lines 91-118]. Jim changed it himself in Lightroom [stated: "Yes, I changed it", 2026-09-26].

## Numbers

| Field | Value | Source field in `p2_check_*.json` |
|---|---|---|
| Connected, time to connect, plugin version | yes, 523 ms, plugin 0.2.0, protocol 1, LrC 15.5.1 | `connect_ms`, `hello` |
| Photo, process version, profile; rating / label / pick read | `20260907-_OZ80093.NEF`, RAW, 15.4, Camera Neutral; rating `null`, label `"gray"`, pick `0`; no key refused | `photo` |
| Export time by long edge, median (min–max): 800 / 1200 / 1600 px | 2,605 (2,601–3,154) / 2,578 (2,303–3,092) / 2,576 (2,575–2,579) ms | `exports.<edge>.export_ms` |
| Preview size by long edge (px, bytes) | 800×533, 219,517 B / 1200×800, 409,511–409,513 B / 1600×1067, 653,719–653,720 B; passed on unchanged | `exports.<edge>.runs` |
| File size at quality 60 / 90 (1600 px); size follows quality | 421,691 B / 1,123,095 B (×2.66); yes | `quality` |
| Pings during an export: answered, median, max, failed, bridge drops | 13, 1.0 ms, 24.7 ms, 0, 0 (export 2,575 ms) | `pings_during_export` |
| Pass 1–3: write command (engine round trip / plugin `command_ms` / `apply_ms` / `read_ms`) | 400 / 397 / 21 / 322 ms; 388 / 386 / 22 / 308 ms; 386 / 384 / 24 / 306 ms | `passes[*].timings` |
| Pass 1–3: export, metrics, whole pass; within ~3 s | 2,574 ms, 39 ms, 3,097 ms; 2,584 ms, 42 ms, 3,129 ms; 3,084 ms, 46 ms, 3,641 ms; 0 of 3 within ~3 s | `passes[*].timings`, `summary.passes_within_budget` |
| Pass 1–3: exposure, mean-luma change | 0.33 → 0.83, +13.8; → 1.33, +14.6; → 0.33, −28.4 | `passes[*].exposure`, `delta_luma_mean` |
| Snapshot revert: settings that differ | 0 of 177 | `revert.differing_keys` |
| Jim, part 1: History steps seen / photo restored | y / y | `jim_part1` |
| Chat: tool calls; Claude looked / raised exposure by 0.5 / saw the result | 7 calls: 3 `ENGINE_BUSY` (before PR #19), 1 `BRIDGE_DISCONNECTED` (Lightroom restarting), then context, preview, `lr_set_settings` 0.89 → 1.39 (whole pass 3,129 ms); yes / yes / yes | `chat` |
| Jim, part 2: photo described / photo brighter / change described / photo put back after the chat | y / y / y / y | `jim_part2` |
| Log paths | `P2\p2_desktop_mcp_log_2026-09-26T23-55-03-940Z.txt` (40 lines), `P2\p2_chat_tool_log_2026-09-26T23-55-03-940Z.jsonl` (7 records); also `P2\p2_bridge_log_…txt`, `P2\p2_check_tools_…jsonl` | `chat.desktop_log.saved_as`, `chat.engine_log.saved_as` |

## Verdict

<!-- Jim: is Phase 2 accepted? The check printed "Phase 2 acceptance: WORKED" (a suggestion); the verdict is Jim's. -->
**Phase 2 accepted** (Jim, 2026-09-26, chosen from the options Claude Code offered, which recommended accepting) [stated: "Accept Phase 2"]. The check's suggestion was **WORKED**. The acceptance line (`PHASES.md:64`) is met by run 2, Part 2 (see "Observed"):
- Claude described the photo;
- Claude changed exposure by +0.5 through `lr_set_settings`, read back;
- Claude described the change;
- log paths are in "Numbers".

It needed fix PR #19 on the way.

Jim's decisions on this report, the same day, each chosen from options Claude Code offered [stated]:
- **"Re-baseline to ~3.5 s"** for the pass budget (decision 1 below).
- **"Accept all"** for decisions 2-6 below. They go into the vault docs after this PR merges, each marked "Phase 2".

## Consequences / open questions

Proposed by Claude Code; **all six decisions below were accepted by Jim on 2026-09-26** (decision 1 as recommended, ~3.5 s) [stated]. Each item follows from the handles above; the recommendations were [inference]. The vault docs are changed after this PR merges.

**Resolved open items** (`PHASES.md:52-56, 69`):
- **Export time at smaller long edges:** there is no gain. The export takes ~2.6 s at 800, 1200 and 1600 px alike (medians 2,605 / 2,578 / 2,576 ms) [handle: run 2 `exports.<edge>.export_ms`].
- **The export's embedded ICC profile:** pixels are identical with and without it [handle: "Pre-run findings", ICC profile: Claude Code, sharp 0.35.4, `raw()` vs `raw()` with `ignoreIcc` on `fixtures\20260907-_OZ80093.jpg`, 0 of 8,386,560 bytes differ]. The engine passes the export on unchanged: all 9 timed exports have `reencoded: false` [handle: run 2 `exports.<edge>.runs`].
- **The `LR_jpeg_quality` range:** the 0–1 scale works. Quality 0.60 gives 421,691 B and 0.90 gives 1,123,095 B at 1600 px [handle: run 2 `quality`].
- **The write command's own duration:** 384–397 ms in the plugin. Of that, 306–322 ms is the `getDevelopSettings` read-back and 21–24 ms the write [handle: run 2 `passes[*].timings.plugin_command_ms`, `plugin_read_ms`, `plugin_apply_ms`].
- **Round trips while Lightroom exports:** the bridge stays responsive (13 pings, median 1.0 ms, max 24.7 ms, no failure, no drop) [handle: run 2 `pings_during_export`].
- **The send-socket rebind on a second engine connection** (P-13): it works. After the check's engine left, Claude Desktop's engine connected in the same Lightroom session and got `hello` at 16:55:51 [handle: bridge log lines 92-97].
- **Resolved by run 2**, the pre-run `[unverified]` items:
  - `Preview.lua`'s export and finding the JPEG with `LrFileUtils.files` (15 exports in Part 1, 2 in the chat);
  - `LR_jpeg_quality = quality / 100`;
  - the three metadata keys;
  - the `apply_settings` timings;
  - Claude Desktop starting `lrc-avg` from the MSIX config (desktop log).

**Decisions for Jim** (all accepted, 2026-09-26):
1. **Pass budget (P-02, about 3 s)**; Jim chose ~3.5 s. 0 of 3 passes were within 3 s; whole passes took 3,097–3,641 ms, and the chat's pass 3,129 ms [handle: run 2 `summary.passes_within_budget`, `passes[*].timings.total_ms`; `P2\p2_chat_tool_log_…jsonl` line 7 `timings.total_ms`].
   - The export is 2.57–3.08 s of each pass, about 83%, and does not shrink with a smaller preview. The write command is ~0.39 s, of which the read-back P-12 requires is ~0.31 s [handle: run 2 `passes[*].timings`, `exports`].
   - **Recommendation:** re-baseline P-02 to **about 3.5 s per pass** (PRD NFR-2, ARCHITECTURE §6), rather than chase savings that the numbers show are small.
2. **MCP_TOOLS:**
   - add the temporary `lr_set_settings` contract (absolute values, `uuid`, `return_image`, `preview_error`);
   - add the Phase 2 error codes (`ENGINE_BUSY`, `INVALID_ARGUMENTS`, `UNKNOWN_TOOL`, `WRITE_NOT_TAKEN`, `NO_PREVIEW_YET`, `PREVIEW_PATH_REFUSED`, `PREVIEW_UNREADABLE`, `BRIDGE_TIMEOUT`, `UNKNOWN_CAMERA_PROFILE`, `WRONG_TYPE`);
   - `lr_get_preview` has no `region` until Phase 3 (Jim's decision 2).
3. **ARCHITECTURE §2 (process lifecycle).** Claude Desktop starts a short-lived engine and then two long-lived ones per launch, and calls only one [handle: `P2\p2_desktop_mcp_log_…txt`; the process list in "Observed"]. The engine therefore takes its lock (127.0.0.1:8767) on the first tool call and gives it back after 60 s without one (PR #19). Why Desktop keeps two engines is [unverified].
4. **ARCHITECTURE §3:** the command `export_preview {long_edge, quality}` → `{path, export_ms}` (the preview in `<temp>\LrC-AVG\previews\<id>\`), and `apply_settings`' `read_ms` / `command_ms`.
5. **PRD §6.8:** a 1600 px q75 preview of the NEF is 653,719 B, not the "≈ 150–300 KB" the PRD estimates. The image token cost follows the pixel size, not the bytes [inference].
6. **LR_SDK_NOTES, "Recorded in Phase 2"** (LrC 15.5.1):
   - The `LrExportSession` JPEG export takes ~2.6 s at 800, 1200 and 1600 px alike [handle: run 2 `exports`].
   - `LR_jpeg_quality` takes 0–1 [handle: run 2 `quality`].
   - `getRawMetadata("rating")` returned nil, `"pickStatus"` returned 0 and `"colorNameForLabel"` returned `"gray"` for the NEF; no key was refused [handle: run 2 `photo`]. That "gray" means "no label" is [unverified].
   - The plugin answers pings while it exports [handle: run 2 `pings_during_export`].
   - A second engine in the same Lightroom session connects and handshakes [handle: bridge log lines 92-97].
   - The plugin listens about 10 s after it starts (16:54:50 → 16:55:00, 17:44:57 → 17:45:07, 18:50:58 → 18:51:07) [handle: bridge log].

**For Phase 3 (Claude Code's proposal):**
- The engine waits 5 s for the bridge, but the plugin needs ~10 s from start to listening. A call right after a Lightroom restart can therefore fail once, as at 18:50:45. Waiting up to 15 s on the first connection would cover it [inference].
- The previews are larger than the PRD assumed (item 5), which is worth watching for the contact sheets.

**Still open:** why Claude Desktop keeps two engines [unverified]. The engine does not depend on the answer since PR #19.
