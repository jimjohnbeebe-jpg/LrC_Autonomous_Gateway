---
report: clients-probe
phase: 8.5
status: template
authored_by: Claude Code (Opus 5.5), issue-155 workflow, 2026-10-15 (template, harness, "Pre-run findings"); Jim ("Observed", "Verdict")
date: 2026-10-15
---

# Client probe: the installed AI clients against the Lightroom simulator (issue #155, R5)

## Purpose

Does each installed MCP client (Claude Code, OpenCode, Hermes Agent, Antigravity CLI, Codex CLI) list the engine's tools, identify itself, see the preview image, run an edit session and finish a long export through continuations, with no Lightroom involved? The plan's acceptance line, quoted from `ISSUE155_PLAN.md` "Acceptance": "`clients:probe`: T1-T5 YES for every installed client, or each NO in the report with its handle."

- **T1** all 35 tools listed, no schema error;
- **T2** clientInfo from the MCP handshake, the self-reported model (`lr_begin_session` `model`), and whether a `progressToken` came;
- **T3** a random word printed on the simulated preview, read back by the client's model;
- **T4** `lr_begin_session` -> `lr_step` -> `lr_end_session` in the session log;
- **T5** a simulated 70 s export (`export_photo` delayed) that finishes through `pending` / `not_yet` continuations.

A client that is not installed is "not run", never a failure.

## Harness

- `engine\tests\probe\clients.probe.ts` (the runs and the checks), `harness.ts` (the simulator on ports 47651/47652, lock 47653, and the engine env under a scratch folder), `report.ts` (this section and `clients-probe.json`), `engine\vitest.probe.config.ts`.
- The client kit: `engine\src\devtools\clients-launch.ts` (finding each client, its headless command line, `MODELS`) and `clients-config.ts` (registration and restore).
- Run from the repo root (Claude Code runs it; Jim does nothing for this report):

```powershell
npm run clients:probe
```

- Only the self-checks, no client: `$env:LRC_AVG_PROBE_CLIENTS = "none"; npm run clients:probe`. Some clients: `$env:LRC_AVG_PROBE_CLIENTS = "opencode,hermes"`.
- Jim's configs: Claude Code, OpenCode and Codex get a per-run config (nothing of Jim's is edited). Hermes: `%LOCALAPPDATA%\hermes\config.yaml` is backed up byte for byte, one `mcp_servers:` block appended, and the bytes restored and checked by SHA-256 afterwards; a file that already has `mcp_servers:` is left alone and Hermes is "not run". Antigravity: a workspace config in the run folder first; Jim's `~/.gemini/config/mcp_config.json` (backed up, restored) only when that run made no tool call.
- Models: OpenCode `openrouter/openai/gpt-6-luna`, Hermes `mistralai/mistral-large-4-0` (OpenRouter); the other clients their defaults. Both have image input and tool calls in OpenRouter's catalogue [handle: `docs\reports\phase8.5\clients-probe\opencode-models-openrouter.tsv`, from `opencode models openrouter --verbose`, 2026-10-15].
- Saved command outputs behind the launch flags (2026-10-15, Claude Code): `clients-probe\claude-help.txt` (`claude --help`, 2.1.300), `clients-probe\codex-exec-help.txt` (`codex exec --help`, 0.154.0), `clients-probe\opencode-run-help.txt` (`opencode run --help`, 1.18.35), `clients-probe\hermes-help.txt` (`hermes --help`, v0.22.1). Hermes reads `mcp_servers` from config.yaml and passes a server a filtered env [handle: `%LOCALAPPDATA%\hermes\hermes-agent\tools\mcp_tool_config.py:638` and `:147-192`]. Antigravity's flags are [unverified]: `agy` was not installed on 2026-10-15.

## Pre-run findings (Claude Code)

Written by `npm run clients:probe` on 2026-10-15T14:00:50.403Z; every value below is in `docs\reports\phase8.5\clients-probe.json` (the path in brackets).

- Self-checks, no client [handle: docs\reports\phase8.5\clients-probe.json `self_checks`]: {"a_word":{"word":"PELICAN","noise":{"mean":118,"min":78},"printed":{"mean":212,"min":0},"ok":true},"b_engine":{"server":{"name":"lrc-avg","version":"0.34.0"},"tools":35,"preview_image":true,"ok":true}}
- sharp draws the SVG box and text on the preview: the box's mean grey 212 against 118 on plain noise, its darkest pixel 0 (the text) [handle: docs\reports\phase8.5\clients-probe.json `self_checks.a_word`].

| Client | Status | Model (asked / reported) | clientInfo | progressToken | T1 tools | T2 identity | T3 word | T4 session | T5 slow export |
|---|---|---|---|---|---|---|---|---|---|
| claude-code [docs\reports\phase8.5\clients-probe.json `clients[0]`] | run | default / claude-opus-5-5 | claude-code 2.1.300 | true | YES | YES | YES | YES | YES |
| opencode [docs\reports\phase8.5\clients-probe.json `clients[1]`] | run | openrouter/openai/gpt-6-luna / openai/gpt-6-luna | opencode 1.18.35 | true | YES | YES | YES | YES | YES |
| hermes [docs\reports\phase8.5\clients-probe.json `clients[2]`] | run | mistralai/mistral-large-4-0 / mistralai/mistral-large-4-0 | mcp 0.1.0 | false | YES | YES | YES | YES | YES |
| antigravity [docs\reports\phase8.5\clients-probe.json `clients[3]`] | not run: not installed | - / - | - | - | not run | not run | not run | not run | not run |
| codex [docs\reports\phase8.5\clients-probe.json `clients[4]`] | run | default / - | - | - | NO (tools unknown (from none), schema error false, 0 tool-log lines) | NO (client none, model none, progress_token []) | NO (word MEADOW) | NO (0 session logs, a step and an end: false) | NO (0 export lines, continued false, files none) |

### Round 2: after the fix in `aad6b5e` (Claude Code, 2026-10-15)

The table above is round 2: one run per client, `npm run build` then `npm run clients:probe` at commit `aad6b5e` (vitest: 7 of 7 tests passed in 363.9 s; a NO is a recorded result, not a test failure). Each client's full stdout and stderr: `%TEMP%\lrc-avg-probe-runs\<client>\stdout.txt` and `stderr.txt` (not committed).

- **Claude Code 2.1.300**, default model `claude-opus-5-5`: T1-T5 YES, progressToken sent, 90.0 s [handle: clients-probe.json `clients[0]`: t1 "tools 35 (from init event)", t3 "word GLACIER", t5 "4 export lines, continued true"].
- **OpenCode 1.18.35**, `openrouter/openai/gpt-6-luna` (reported `openai/gpt-6-luna`): T1-T5 YES, progressToken sent, 123.0 s [handle: clients-probe.json `clients[1]`: t2 "client opencode, model openai/gpt-6-luna", t3 "word PELICAN", t4 "1 session logs, a step and an end: true", t5 "4 export lines, continued true"]. Round 1's four NOs (T2-T5) are gone: the engine defect fixed in `aad6b5e` (optional arguments that do not apply are ignored) was their cause.
- **Hermes Agent**, `mistralai/mistral-large-4-0` through OpenRouter: T1-T5 YES, no progressToken, 144.0 s [handle: clients-probe.json `clients[2]`: t3 "word MEADOW", t5 "4 export lines, continued true"]. Its clientInfo is still `mcp 0.1.0` (see round 1 and "Consequences"). Its config was registered by appending (`registration` "append") and restored in the probe's `finally` (`engine\tests\probe\clients.probe.ts:149,157`).
- **Antigravity CLI**: not run, `agy` is not installed [handle: clients-probe.json `clients[3].reason` "not installed"; `which agy` found nothing, 2026-10-15].
- **Codex CLI 0.154.0**, default model: T1-T5 NO, exit code 1 after 3.9 s, 0 engine tool-log lines. **Client limitation (theirs: the sign-in on this machine)**, unchanged from round 1: the turn failed before any tool call with "Your access token could not be refreshed. Please log out and sign in again." [handle: clients-probe.json `clients[4].excerpt`, `clients[4].exit_code` 1]. No engine defect: the engine was never called.

Engine defects found in round 2: none.

### Round 1: what each NO is (Claude Code, 2026-10-15)

Round 1's table and JSON are in commit `aad6b5e` (`git show aad6b5e:docs/reports/phase8.5/clients-probe.json`); its `clients-probe.json` handles below point there.

One run per client, `npm run build` then `npm run clients:probe` (vitest: 7 of 7 tests passed in 370 s; a NO is a recorded result, not a test failure). Each client's full stdout and stderr were in `%TEMP%\lrc-avg-probe-runs\<client>\stdout.txt` and `stderr.txt` (not committed; round 2 overwrote them).

- **Claude Code 2.1.300**, default model `claude-opus-5-5` (self-reported, and `modelUsage` in its result event): T1-T5 YES; progressToken sent [handle: clients-probe.json `clients[0]`].
- **Hermes Agent**, `mistralai/mistral-large-4-0` through OpenRouter: T1-T5 YES; no progressToken [handle: clients-probe.json `clients[2]`]. Its clientInfo is `mcp 0.1.0`, not `hermes-agent`: Hermes passes `ClientSession` no `client_info` [handle: `%LOCALAPPDATA%\hermes\hermes-agent\tools\mcp_tool_transport.py:169-179`, `_session_kwargs`], so the name is the Python MCP SDK's default [inference]. R1's display name then falls back to `clientInfo.name`, so the Deck shows "mcp" for Hermes [inference: from the R1 rule; not seen on a Deck]. That is not a NO; it is listed under "Consequences".
- **Antigravity CLI**: not run, `agy` is not installed [handle: clients-probe.json `clients[3].reason`].
- **OpenCode 1.18.35**, `openrouter/openai/gpt-6-luna`: T1 YES; T2, T3, T4 and T5 NO [handle: clients-probe.json `clients[1]`; the tool calls in `%TEMP%\lrc-avg-probe-runs\opencode\stdout.txt`]. The model sends a value for every optional argument, and the engine refuses combinations its JSON schema allows. **Engine defect (ours)**:
  - T4 and T2 (model): 14 `lr_begin_session` calls with `mode: "converge"` and `variant_count` 2 or 3, all refused with `INVALID_ARGUMENTS` "variant_count is for mode \"variants\"" (`engine\src\session\begin.ts:47`). No session opened, so no session log carried `model` (the calls did pass `model: "openrouter/openai/gpt-6-luna"`).
  - T5: 3 `lr_export_photos` calls with `format: "jpeg"`, `bit_depth: 8` and `long_edge` together with `width`/`height`, refused by the zod refinements at `engine\src\mcp\defs-files.ts:52` and `:54`.
  - T3: `lr_get_preview` with `session_id: "selected"` (and no session open), refused with `SESSION_NOT_ACTIVE`, so no image reached the model. This is the same class: a filled-in optional argument [inference].
  - Contributing, on the client side: the model resent the same refused `variant_count` 13 times after a clear error message. Whether OpenCode or the model makes every optional field filled (for example a strict-mode schema transform) is [unverified].
- **Codex CLI 0.154.0**, default model: T1-T5 NO, exit code 1 after 4.9 s, 0 engine tool-log lines. **Client limitation (theirs: the sign-in on this machine)**: the turn failed before any tool call with "Your access token could not be refreshed. Please log out and sign in again." [handle: clients-probe.json `clients[4].excerpt`]. Codex is an inferred client (plan D4), and a fresh sign-in is Jim's action, so it was not retried.

## Observed (Jim)

(Jim: anything you saw that the probe did not record.)

## Numbers

| Client | Model | T1 | T2 | T3 | T4 | T5 |
|---|---|---|---|---|---|---|
| Claude Code | | | | | | |
| OpenCode | | | | | | |
| Hermes Agent | | | | | | |
| Antigravity CLI | | | | | | |
| Codex CLI | | | | | | |

## Verdict

(Jim: go / conditional / no-go. A script's suggestion, if any, is labelled as one.)

## Consequences / open questions

- What Claude Desktop sends as `clientInfo` stays [unverified] here: Desktop is covered by `npm run clients:check` (R6), not by this probe.
- Antigravity's command line and workspace config are [unverified] until a run with `agy` installed.
- Round 1 (Claude Code, 2026-10-15): OpenCode's NOs are an engine defect. `lr_begin_session` (`session\begin.ts:47`) and `lr_export_photos` (`mcp\defs-files.ts:52,54`) refuse optional arguments that a model fills in, and `lr_get_preview` refuses a placeholder `session_id`. The fix is not part of this round.
- Fixed after round 1 (Claude Code, 2026-10-15): an argument that does not apply is now ignored, not refused. `lr_begin_session` ignores `variant_count` in Converge mode and treats `intent_id` "none" as no intent; `lr_export_photos` sends the plugin only what applies to the format (`long_edge` wins over width and height; quality on jpeg only, bit_depth on png and tiff only; no resize for an original) and still refuses a lone width or height that would be used; `lr_get_preview` and `lr_get_metrics` ignore a `session_id` while no session is open, and `lr_get_preview` says so in `session_id_note` [handle: `engine\tests\mcp-filled-args.test.ts`, OpenCode's own arguments from round 1, 4 passed; all 4 failed on the code before the fix]. Round 2 confirms it: OpenCode reached T1-T5 YES [handle: clients-probe.json `clients[1]`, `npm run clients:probe` at `aad6b5e`].
- Hermes identifies itself as `mcp 0.1.0`. `engine\src\session\client.ts` maps that name, the Python MCP SDK's default, to "the AI", so the Deck says "the AI" for Hermes, not "mcp" [handle: `engine\tests\session-client.test.ts` "says 'the AI' for no client and for the MCP SDK's default name"]. Naming it "Hermes" would need a guess about the client, which D1 rules out [inference].
- Codex: re-run once Jim signs Codex in again (`codex login`). Codex is an inferred client (D4), so that step is not required.
