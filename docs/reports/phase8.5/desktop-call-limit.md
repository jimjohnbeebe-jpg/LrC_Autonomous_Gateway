---
report: desktop-call-limit
phase: "8.5"
status: template
authored_by: "Claude Code (purpose, harness, pre-run findings, consequences); Jim (observed, verdict)"
date: 2026-10-11
---

# How long Claude Desktop waits for a tool call (issue #136)

## Purpose

Issue #136: one slow photo in `lr_import_photos` (up to 90 s, `IMPORT_PHOTO_TIMEOUT_MS`) or `lr_export_photos` (up to 120 s, `EXPORT_PHOTO_TIMEOUT_MS`) can outlast Claude Desktop's tool call, because the 40 s call budget is checked only between photos (`engine\src\library\files.ts`). The right per-photo timeout depends on Desktop's own time limit, which is [unverified].

Questions:
1. Does Claude Desktop send a `progressToken` with a tool call?
2. How long does Desktop wait for a tool call, and do progress notifications extend that wait?

Jim chose option A for this PR: log whether each call carries a progressToken, commit the evidence that Desktop's own log already holds, and keep the timeout constants as they are [stated: Jim, 2026-10-11, plan decision D2 = A]. There is no PHASES.md go rule for this question; closing #136 is Jim's call.

## Harness

- The engine's tool log now records `progress_token: true | false` on every call that reaches a tool (`engine\src\mcp\call-context.ts`, entered in `engine\src\mcp\server.ts`, written by `run` in `engine\src\mcp\tools-shared.ts`). Test: `engine\tests\mcp-server.test.ts` "logs whether each call carried a progressToken (issue #136)" (one call with a token logs `true`, one without logs `false`). A call refused before it runs (unknown tool, invalid arguments) is logged without the field.
- The tool log is `logs\engine-<yyyymmdd>.jsonl` (Claude Desktop's entry sets `LRC_AVG_LOG_DIR` to the repo's `logs\` folder, `engine\src\devtools\install-desktop-config-cli.ts:31`), else `%LOCALAPPDATA%\LrC-AVG\logs`.
- Claude Desktop's log for this server: `%LOCALAPPDATA%\Claude\Logs\mcp-server-lrc-avg.log` (found there on this PC with `Get-ChildItem -Recurse -Filter "mcp-server-lrc-avg*.log"` over `%LOCALAPPDATA%\Claude`, 2026-10-11; there is no `%APPDATA%\Claude\logs` folder on this PC).

## Pre-run findings (Claude Code)

Read on 2026-10-11 from a copy of Desktop's log taken when it had 9,202 lines, first entry `2026-09-26T23:55:48.561Z`, last `2026-10-12T03:15:09.506Z` (UTC). Desktop is still writing to it, so later counts are higher. No raw log lines are copied here: the engine's own stderr lines in that file carry user paths.

`$L` below is `"$env:LOCALAPPDATA\Claude\Logs\mcp-server-lrc-avg.log"`.

**Counts.**

| What | Count | Handle |
|---|---|---|
| Server starts (`initialize` requests) | 54 | `(Select-String -Path $L -Pattern 'method="initialize"' -SimpleMatch).Count` |
| Tool calls Desktop sent | 575 | `(Select-String -Path $L -Pattern 'method="tools/call"' -SimpleMatch).Count` |
| Answers Desktop received from the server | 681 | `(Select-String -Path $L -Pattern 'Message from server: id=' -SimpleMatch).Count` |
| Server notifications Desktop logged (`Message from server: method=`) | 0 | `(Select-String -Path $L -Pattern 'Message from server: method=' -SimpleMatch).Count` |
| Cancel notifications Desktop sent (`notifications/cancelled`) | 0 | `(Select-String -Path $L -Pattern 'notifications/cancelled' -SimpleMatch).Count` |
| Lines naming `progressToken` or `_meta` | 0 and 0 | `(Select-String -Path $L -Pattern 'progressToken' -SimpleMatch).Count`, same with `'_meta'` |

Each request line ends in `params { metadata: undefined }`: Desktop logs the method and id but not the request's params, so a progressToken would not show in this log either way [handle: `Select-String -Path $L -Pattern 'method="tools/call" id=\d+ params \{ metadata: undefined \}$'` matches all 575 tool calls]. Desktop also logs no server notification at all (0 above), so the absence of `notifications/progress` lines says nothing about whether the engine sent any.

**Every tool call of 30 s or more, the unanswered ones, and the one that overlapped.** Times are UTC from Desktop's log; an id is per server start, so the received time identifies the call. The tool and its outcome come from the engine's tool log record with the same start time.

| id | method | received | answered | next call |
|---|---|---|---|---|
| 4 | tools/call (`lr_begin_session`, ok, 73,650 ms) | 2026-09-28T04:31:51.512Z | 2026-09-28T04:33:05.170Z (73.7 s) | 2026-09-28T04:33:24.107Z (id 5) |
| 65 | tools/call (`lr_begin_session`, BRIDGE_TIMEOUT, 33,725 ms) | 2026-10-05T00:00:29.762Z | 2026-10-05T00:01:03.489Z (33.7 s) | 2026-10-05T00:01:07.160Z (id 66) |
| 71 | tools/call (`lr_begin_session`, ok, 30,569 ms) | 2026-10-05T00:04:26.589Z | 2026-10-05T00:04:57.161Z (30.6 s) | 2026-10-05T00:05:06.721Z (id 72) |
| 4 | tools/call (no engine record) | 2026-10-07T11:14:49.875Z | not answered: Desktop shut the server down at 2026-10-07T11:14:59.143Z | none (server stopped) |
| 26 | tools/call (`lr_create_mask`, BRIDGE_DISCONNECTED, 168,516 ms) | 2026-10-11T05:49:48.598Z | 2026-10-11T05:52:37.116Z (168.5 s) | 2026-10-11T05:52:40.280Z (id 27) |
| 13 | tools/call (`lr_create_mask`, AI_MASK_FAILED, 171,186 ms) | 2026-10-12T00:41:27.540Z | 2026-10-12T00:44:18.729Z (171.2 s) | 2026-10-12T00:43:47.182Z (id 14, `lr_get_active_photo_context`, sent while id 13 was pending) |
| 10 | tools/call (`lr_create_mask`, ok, 32,716 ms) | 2026-10-12T02:47:26.373Z | 2026-10-12T02:47:59.099Z (32.7 s) | 2026-10-12T02:48:05.246Z (id 11) |

Handles, row by row (Desktop's log line numbers in the 9,202-line copy, request then answer; `(Get-Content $L)[n-1]` shows line n; engine records by start time, e.g. `Select-String -Path logs\engine-20260927.jsonl -Pattern '"ts":"2026-09-28T04:31:51.514Z"'`):

1. `$L:1338,1339`; `logs\engine-20260927.jsonl` ts `2026-09-28T04:31:51.514Z`.
2. `$L:4330,4331`; `logs\engine-20261004.jsonl` ts `2026-10-05T00:00:29.763Z`.
3. `$L:4344,4345`; `logs\engine-20261004.jsonl` ts `2026-10-05T00:04:26.589Z`.
4. `$L:5506` (request), `$L:5507` (shutdown); no record in `logs\engine-20261006.jsonl` or `engine-20261007.jsonl` with a start time of `2026-10-07T11:14:49` (the engine writes a record when a call ends, `engine\src\mcp\tools-shared.ts` `run`, and the engine's stderr line after the shutdown is "stdin ended (the client exited)").
5. `$L:7346,7349`; `logs\engine-20261010.jsonl` ts `2026-10-11T05:49:48.588Z`.
6. `$L:8476,8479` (id 13), `$L:8477,8478` (id 14); `logs\engine-20261011.jsonl` ts `2026-10-12T00:41:27.541Z` and `2026-10-12T00:43:47.182Z`.
7. `$L:9167,9168`; `logs\engine-20261011.jsonl` ts `2026-10-12T02:47:26.373Z`.

The table holds the 6 answered calls of 30 s or more (the longest is 171.2 s; 3 of them are 60 s or more) and the 1 unanswered call; the copy's last line, a call still in flight when it was taken, is left out. Pairing rule: within one server start, a `Message from client: method="tools/call" id=N` line is paired with the next `Message from server: id=N` line.

**What this shows, and what it does not.**
- Desktop logged the engine's answers to calls of 73.7 s, 168.5 s and 171.2 s, and sent no cancel for any call [handle: rows 1, 5, 6 and the 0 cancel count above]. The MCP SDK's client sends `notifications/cancelled` when its own request timeout fires [unverified: not read in the SDK source for this report]; Desktop logs client notifications (`notifications/initialized` appears 54 times, `Select-String -Path $L -Pattern 'notifications/initialized' -SimpleMatch`).
- After rows 1 and 5 Desktop's next call came 18.9 s and 3.2 s after the answer, which looks like a chat that waited for the result [inference]. Whether the model actually received those results, or Desktop had already given up on its side and only logged the late answer, is not in this log [unverified].
- Row 6: Desktop sent a new call 139.6 s into a pending one. Calls overlap, so per-call facts (such as `progress_token`) cannot be a shared field in the engine [handle: `$L:8476-8479`]. Why Desktop sent it then (a parallel tool call, a new message from Jim, or a client-side timeout) is [unverified].
- Whether Desktop sends a progressToken: [unverified]. Desktop's log does not print params. The engine's tool log answers it from the next Desktop chat on (`progress_token`).
- Desktop's time limit for a tool call, and whether progress notifications extend it: [unverified]. No call in this log was cancelled, including three of more than 60 s.

## Observed (Jim)

_Filled after one Claude Desktop chat on engine 0.30.0 (the plan's verification step 2). Claude Code then reads `progress_token` from `logs\engine-<yyyymmdd>.jsonl` for that chat's calls._

- Chat date and time:
- `progress_token` on that chat's calls (true / false / mixed):

## Numbers

| Field | Value | Handle |
|---|---|---|
| Longest tool call Desktop logged an answer for | 171.2 s | row 6 |
| Calls of 60 s or more, answered | 3 | rows 1, 5, 6 |
| Cancels sent by Desktop | 0 | count table |
| Desktop sends a progressToken | [unverified] | to fill from Observed |
| Desktop's tool-call time limit | [unverified] | |

## Verdict

_Jim decides. No verdict is suggested: the time limit is still unknown._

## Consequences / open questions

- The timeout constants stay: `CALL_BUDGET_MS` 40 s, `IMPORT_PHOTO_TIMEOUT_MS` 90 s, `EXPORT_PHOTO_TIMEOUT_MS` 120 s (`engine\src\library\files.ts`) [stated: Jim, 2026-10-11, D2 = A].
- `engine\src\library\files.ts` (header) and `engine\src\mcp\server.ts` (`PROGRESS_MS`) now point here instead of carrying their own [unverified] note.
- The #116 change (PR-2) should cite this table for the call budget, not the SDK's 60 s default.
- Open: whether Desktop sends a progressToken (answered by `progress_token` in the tool log after the next chat); Desktop's time limit and whether progress extends it (needs a probe that holds a call open for a set time, issue #136 "Direction").
