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

Written by `npm run clients:probe` on 2026-10-15T13:25:49.201Z; every value below is in `docs\reports\phase8.5\clients-probe.json` (the path in brackets).

- Self-checks, no client [handle: docs\reports\phase8.5\clients-probe.json `self_checks`]: {"a_word":{"word":"PELICAN","noise":{"mean":118,"min":75},"printed":{"mean":212,"min":0},"ok":true},"b_engine":{"server":{"name":"lrc-avg","version":"0.34.0"},"tools":35,"preview_image":true,"ok":true}}
- sharp draws the SVG box and text on the preview: the box's mean grey 212 against 118 on plain noise, its darkest pixel 0 (the text) [handle: docs\reports\phase8.5\clients-probe.json `self_checks.a_word`].

| Client | Status | Model (asked / reported) | clientInfo | progressToken | T1 tools | T2 identity | T3 word | T4 session | T5 slow export |
|---|---|---|---|---|---|---|---|---|---|
| claude-code [docs\reports\phase8.5\clients-probe.json `clients[0]`] | not run: not selected (LRC_AVG_PROBE_CLIENTS=none) | - / - | - | - | not run | not run | not run | not run | not run |
| opencode [docs\reports\phase8.5\clients-probe.json `clients[1]`] | not run: not selected (LRC_AVG_PROBE_CLIENTS=none) | - / - | - | - | not run | not run | not run | not run | not run |
| hermes [docs\reports\phase8.5\clients-probe.json `clients[2]`] | not run: not selected (LRC_AVG_PROBE_CLIENTS=none) | - / - | - | - | not run | not run | not run | not run | not run |
| antigravity [docs\reports\phase8.5\clients-probe.json `clients[3]`] | not run: not selected (LRC_AVG_PROBE_CLIENTS=none) | - / - | - | - | not run | not run | not run | not run | not run |
| codex [docs\reports\phase8.5\clients-probe.json `clients[4]`] | not run: not selected (LRC_AVG_PROBE_CLIENTS=none) | - / - | - | - | not run | not run | not run | not run | not run |

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
