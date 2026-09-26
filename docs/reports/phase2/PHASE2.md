---
report: Phase 2 — MCP server, preview and vision
phase: 2
status: template
authored_by: "Template, harness and pre-run findings: Claude Code (Opus 5.5), 2026-09-26. Observed, Numbers, Verdict: after Jim's run."
date: 2026-09-26 (template)
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
| MCP server (PR #17) | `engine\src\mcp\`: `main.ts` (stdio entry, `engine\dist\mcp\main.js`), `server.ts` (tool list, zod validation, content blocks), `tools.ts` (the four tools), `errors.ts` (`{code, message, recoverable}`), `bridge-gate.ts` and `instance-lock.ts` (one engine per bridge: a listener on 127.0.0.1:8767), `dev-overrides.ts` (ports and token file for scratch runs) |
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
4. It ends with the snapshot step.

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
9. The command says `Last step`: in the **Snapshots** panel (left side of Develop), click the snapshot it names (`AVG P2 check …`). That puts the photo back as it was.
10. The last lines say `Phase 2 acceptance: WORKED` or `FAILED`, and `Results saved automatically`. Tell Claude Code "done".

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

- **Engine tests: 213 pass** on branch `phase-2/preview-check` (PR #17 left 190) [handle: `npm test`, "Test Files 15 passed (15), Tests 213 passed (213)"]. `npm run build` and `npm run typecheck` pass too.
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

<!-- Nothing to paste. The check saves everything to %TEMP%\LrC-AVG\P2\ (the results with Jim's five answers, the chat's logs, the plugin's log). Jim says "done"; Claude Code copies the files to docs\reports\phase2\P2\ and fills this section and Numbers from them. -->

## Numbers

| Field | Value | Source field in `p2_check_*.json` |
|---|---|---|
| Connected, time to connect, plugin version | | `connect_ms`, `hello` |
| Photo, process version, profile; rating / label / pick read | | `photo` |
| Export time by long edge, median (min–max): 800 / 1200 / 1600 px | | `exports.<edge>.export_ms` |
| Preview size by long edge (px, bytes) | | `exports.<edge>.runs` |
| File size at quality 60 / 90; size follows quality | | `quality` |
| Pings during an export: answered, median, max, failed, bridge drops | | `pings_during_export` |
| Pass 1–3: write command (engine round trip / plugin `command_ms` / `apply_ms` / `read_ms`) | | `passes[*].timings` |
| Pass 1–3: export, metrics, whole pass; within ~3 s | | `passes[*].timings`, `summary.passes_within_budget` |
| Pass 1–3: mean-luma change | | `passes[*].delta_luma_mean` |
| Snapshot revert: settings that differ | | `revert.differing_keys` |
| Jim, part 1: History steps seen / photo restored | | `jim_part1` |
| Chat: tool calls; Claude looked / raised exposure by 0.5 / saw the result | | `chat` |
| Jim, part 2: photo described / photo brighter / change described | | `jim_part2` |
| Log paths | | `chat.desktop_log.saved_as`, `chat.engine_log.saved_as` |

## Verdict

<!-- Jim: is Phase 2 accepted? The check prints a suggestion ("WORKED" / "FAILED"); the verdict is Jim's. -->

## Consequences / open questions

<!-- Filled after the run. Proposed so far (for Jim to accept in PR C; the vault docs are the architect's): -->
- **MCP_TOOLS** gains three changes:
  - the temporary `lr_set_settings` contract (absolute values, `uuid`, `return_image`, `preview_error`);
  - the Phase 2 error codes (`ENGINE_BUSY`, `INVALID_ARGUMENTS`, `UNKNOWN_TOOL`, `WRITE_NOT_TAKEN`, `NO_PREVIEW_YET`, `PREVIEW_PATH_REFUSED`, `PREVIEW_UNREADABLE`, `BRIDGE_TIMEOUT`, `UNKNOWN_CAMERA_PROFILE`, `WRONG_TYPE`);
  - `lr_get_preview` without `region` until Phase 3 (Jim's decision 2).
- **ARCHITECTURE §1–2 and PRD §6.2:** the engine's instance lock on 127.0.0.1:8767, next to the bridge's 8765/8766, and the previews folder `%TEMP%\LrC-AVG\previews`.
- **ARCHITECTURE §3:** the `export_preview {long_edge, quality}` → `{path, export_ms}` command, and `apply_settings`' `read_ms` / `command_ms`.
