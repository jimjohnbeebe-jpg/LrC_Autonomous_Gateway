---
report: clients
phase: "8.5"
status: accepted
authored_by: "Claude Code (Opus 5.5), issue-155 workflow, 2026-10-15 (purpose, harness, steps, pre-run findings); Jim (Observed answers via the harness, Verdict); Claude Code (Opus 5.5) transcribed Observed and Numbers from the results file, 2026-10-16"
date: 2026-10-16
---

# Clients check: every installed AI client edits a photo in Lightroom (issue #155, R6)

## Purpose

Issue #155 makes LrC-AVG work with MCP clients other than Claude Desktop (vault `ISSUE155_PLAN.md`, decisions D1-D7, Jim, 2026-10-15). The headless probe (`clients-probe.md`, R5) checks each client against the Lightroom simulator. This check runs each client against Jim's real Lightroom and asks what only Jim can see.

Question: does each installed client (Claude Code, OpenCode, Hermes, Antigravity) run an edit end to end in Lightroom, show its name and model on the Deck, reach the Deck's Approve, and recover an edit it left open? And does Claude Desktop still work as before?

Go / no-go, from the plan's "Acceptance" [stated: Jim, 2026-10-15, plan approved]:
- `clients:check`: T2-T7 YES on Claude Desktop, Claude Code, OpenCode, Hermes and Antigravity, or each NO with its handle and Jim's verdict.
- A client that is not installed is "not run", never a failure (R5). Codex is not run (D4).

The tests, per client:

| Test | What is checked | Judged by |
|---|---|---|
| T2 | The Deck shows "client · model" | the session log has the client and the model, and Jim's y |
| T3 | The model describes the selected photo correctly | a session began, and Jim's y on the description printed in the window |
| T4 | The edit is on the sliders and History carries the AVG name | one pass or more and the session ended, and Jim's y |
| T6 | Approve on the Deck reaches the client | the session log has a pass approved on the Deck ("hud") and two passes |
| T7 | The check ends the client mid-edit; a new run lists the edit as left open and reverts it | the first session's log ends with `ended_by` "recovery" and outcome "revert", and Jim's y |

Claude Desktop holds one chat, as in the Phase 8 check (`phase8-chat.ts`): judged by its tool log and Jim's two y's.

Jim answers y/n in the PowerShell window, as in Phase 1 [stated: Jim, 2026-09-26, "y/n in PowerShell"; `docs\reports\phase1\PHASE1.md:17`] (rule 04, "Steps for Jim").

## Harness

- `npm run clients:check` (root script: `npm run deck:build`, then `node engine\dist\devtools\clients-check-cli.js`). Modules in `engine\src\devtools\`:
  - `clients-check-cli.ts`: the preflight and the order of the tests.
  - `clients-state.ts`: the saved state.
  - `clients-run.ts`: one client run, and T2-T4.
  - `clients-t6t7.ts`: T6 and T7.
  - `clients-judge.ts`: reads the logs.
  - `clients-desktop.ts`: the Claude Desktop chat.
  - `clients-deck.ts`: installs the Deck.
  - Clients are found and started by `clients-launch.ts` and registered by `clients-config.ts` (shared with `clients:probe`).
- First, it restores any client config a stopped run left edited (`restoreLeftovers`). Then the preflight:
  - no other LrC-AVG engine is running (`%USERPROFILE%\.lrc-avg\hud_endpoint.json`);
  - Lightroom connects, and the plugin is 0.23.0 or later;
  - it notes the selected photo (every client edits that photo);
  - it finds each client (Hermes is "not run" when its `config.yaml` already has `mcp_servers:`, since the check does not add a second one);
  - it installs the Deck built for this branch and reads its version (0.3.6).
- For each run, the check selects the photo, takes its own snapshot "AVG clients check before <time>" and gives the bridge up. It registers the engine in the client: a per-run config for Claude Code and OpenCode, a workspace config in the run folder for Antigravity, and for Hermes Jim's `config.yaml` backed up, appended to and restored afterwards (`clients-config.ts` header). The engine logs to the run's own folder (`LRC_AVG_LOG_DIR`). The check starts the client with its prompt, with output to files only, and waits for it to exit (20 minutes at most). Then it takes the bridge back and reads the logs. It prints the client's last words, asks Jim, and puts the photo back with its snapshot.
- Order:
  1. one edit per client (T2-T4);
  2. the Mode set to "Approve each pass" once, T6 per client, the Mode back to "Autonomous";
  3. T7 per client;
  4. the Claude Desktop chat.
- It resumes: run the same command again after a stop and it continues; `npm run clients:check -- --new` starts over. Exit code 0: every test that ran is YES. Exit code 1: finished with a NO. Exit code 2: not finished.
- Results go under `%TEMP%\LrC-AVG\clients\` (or `LRC_AVG_CLIENTS_OUT`), with the user folder redacted. Claude Code collects them into `docs\reports\phase8.5\clients\`.
  - `clients_state.json`
  - `clients_check_<time>.json`
  - `<client>_<test>_<time>_stdout.txt` / `_stderr.txt`
  - `logs_<time>\` (tool and session logs)
  - `clients_desktop_mcp_log_<time>_desktop.txt`, `clients_chat_tool_log_<time>_desktop.jsonl`

## Steps for Jim

1. In Lightroom Classic, open **File > Plug-in Manager**. In the list on the left, click **LrC-AVG (Autonomous Vision Gateway)**, then click **Reload Plug-in**. Click **Done**, then wait 20 seconds (as `docs\reports\phase6\masks-capture.md` step 2). The check itself reads the plugin's version and stops if it is not 0.23.0 or later.
2. In Lightroom's Develop module, select one photo. Every client edits it, and the check puts it back after each run.
3. Quit Claude Desktop: right-click the Claude icon in the Windows system tray > Quit.
4. In PowerShell, in the repo folder, run:

   ```powershell
   npm run clients:check
   ```

5. Follow the window. Each client starts by itself. While a client works, watch the Deck's top line. When asked, click Approve on the Deck, set the Mode in Plug-in Manager, or hold the Claude Desktop chat. Answer each question with y or n, then Enter.
6. When the window says "Nothing to copy", tell Claude Code "done".

## If something goes wrong

- If the window says another LrC-AVG engine is running, quit Claude Desktop and every AI client, then run `npm run clients:check` again.
- If the window says the plugin is not 0.23.0, do step 1 again, then run the command again.
- If the window says the Deck installer failed or the Deck is not 0.3.6, tell Claude Code; the check does not go on without the Deck.
- If you stop the check (Ctrl+C or closing the window), run `npm run clients:check` again. It restores the client configs, puts the photo back and continues.
- If the window ends with "NOT put back", open the Snapshots panel in Develop and click the snapshot it names.
- If a client runs for 20 minutes, the check ends it, records the run as failed, and goes on.

## Pre-run findings (Claude Code)

- The judges skip pending lines: a tool-log line with `pending` and no `ok` never counts as a begin or a pass [handle: `engine\tests\clients-check.test.ts` "never takes a pending line for a begin or a pass", `npx vitest run tests/clients-check.test.ts` in `engine\`, 8 passed, 2026-10-15].
- The state round-trips through its schema, resumes when unfinished, and a `--new` start keeps what is still to put back [handle: same test file, "clients check state"].
- Not run against Lightroom or a client by Claude Code: everything below is Jim's.

## Observed (Jim)

Jim ran `npm run clients:check -- --new` on 2026-10-16 (run `2026-10-16T02-24-13-068Z`, 02:24-02:43 UTC). Claude Code copied the table below from the results file, where the harness saved Jim's y/n answers and the session-log judgements. Jim edited nothing by hand.

| Client | T2 | T3 | T4 | T6 | T7 | Notes |
|---|---|---|---|---|---|---|
| Claude Code | YES | YES | YES | YES | YES | Deck line `Claude Code · claude-opus-5-5`; T6: 1 approval on the Deck, 3 passes |
| OpenCode | YES | YES | YES | YES | YES | Deck line `OpenCode · openrouter/openai/gpt-6-luna`; T6: 1 approval on the Deck |
| Hermes | YES | YES | YES | YES | YES | Deck line `the AI · mistralai/mistral-large-4-0` (Hermes sends clientInfo `mcp`); T6: 1 approval on the Deck |
| Antigravity | YES | YES | YES | YES | YES | Deck line `antigravity-client · Gemini 3.8 Flash` (the raw name: it was not in the name map then); T6: 1 approval on the Deck |

In T7, each client was ended mid-edit (exit 1, its session left open). The next run recovered it: `ended_by: recovery`, outcome `revert`, and no setting differed after the revert. Jim answered y to "does the photo look as before?" for all four.

Claude Desktop chat: YES. Both answers were y. The session ran on `20260906-OZ80005-edited.dng`: 1 pass, ended `accept`, 6 tool calls.

Results file: `docs\reports\phase8.5\clients\clients_check_2026-10-16T02-24-13-068Z.json` (copied from `%TEMP%\LrC-AVG\clients\`). The harness's suggestion: **WORKED**. Nothing stayed un-put-back, and the run recorded no errors.

## Numbers

- Clients run / not run: 4 run (Claude Code, OpenCode, Hermes, Antigravity) plus the Claude Desktop chat. Codex is not part of the check (D4).
- Model each client named (session log `model`): Claude Code `claude-opus-5-5`; OpenCode `openrouter/openai/gpt-6-luna`; Hermes `mistralai/mistral-large-4-0`; Antigravity `Gemini 3.8 Flash` (`Gemini 3.8 Flash (High)` in T7); Claude Desktop `claude-opus-5-5`.
- `clientInfo` each client sent (session log `client`): Claude Code `claude-code` 2.1.301 with title `Claude Code`; OpenCode `opencode` 1.18.35; Hermes `mcp` 0.1.0; Antigravity `antigravity-client` v1.0.0; Claude Desktop `claude-ai` 0.1.0.
- Pending lines per run (calls that hit the 50 s deadline): 0 in every run. No call in this check reached the deadline, so whether a client calls again after a real `pending` in Lightroom is still [unverified]. The simulator's tests cover the engine side (`engine\tests\mcp-deadline.test.ts`).

## Verdict

**Go** [stated: Jim, 2026-10-16, "Go with recommendations", in answer to Claude Code's question about the verdict, after the all-YES summary above].

## Consequences / open questions

- `antigravity-client` -> "Antigravity" was added to the name map (`engine\src\session\client.ts`). `claude-ai`, `claude-code` and `opencode` are now confirmed by this run. `hermes-agent` stays [unverified]: Hermes 0.21.5 sends `mcp`.
- Jim accepted Claude Code's recommendation on the four build decisions, keeping each one as built [stated: Jim, 2026-10-16, "Go with recommendations"]: the 50 s call deadline for every client; APPROVAL_WAIT_MS lowered to 40 s; neutral "the AI client" wording in tool descriptions; and the `hud\probe\**` prompts and the Deck spec quotes keeping "Claude".

### Decisions for Jim

These are choices Claude Code made alone while building the check. Each can be changed.

- **The photo.** Every client edits the photo selected when the check first starts, kept across resumes. The check selects it again before each run.
- **The prompts.** Every run uses intent `neutral_technical_correction`. The prompt tells the client to pass its own model name as `model`, to call again when a tool answers that Lightroom is still working, and to ask nothing.
- **T3's description.** Jim reads the client's last words in the window. For JSON output, that is the last text field: Claude Code's `result`, OpenCode's text parts [inference]. He opens no file.
- **The Mode.** It is set to Autonomous at the start of each run, and to "Approve each pass" once for every client's T6. If the Mode was "Approve each pass" before the check, the check leaves it on Autonomous.
- **Timeouts.** A client run is ended after 20 minutes. After a client exits, the check waits 90 s for the bridge.
- **T6 has no y/n.** It is judged from the session log only.
- **T7.** Ending the client relies on `process.kill` ending the process at once on Windows [unverified]. With Hermes (started through `hermes.cmd`), the check ends cmd.exe's child instead, never the engine (node.exe running main.js) or the Deck. T7 asks Jim one y/n: does the photo look as before?
- **The Deck.** The Deck 0.3.6 stays installed after the check.
