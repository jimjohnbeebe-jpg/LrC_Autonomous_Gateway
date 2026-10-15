---
report: desktop-call-limit
phase: "8.5"
status: observed
authored_by: "Claude Code (purpose, harness, pre-run findings, observed collected from the tool log 2026-10-15, numbers, consequences); Jim (the chats, verdict)"
date: 2026-10-15
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

Jim's Claude Desktop chats on engine 0.30.0 and later, 2026-10-12 to 2026-10-14 (among them the PR #147 effects chat and the PR #152 metadata chat), collected by Claude Code from the tool log on 2026-10-15 (rule 04: the harness saves, Claude Code collects).

- Chat dates: 2026-10-12, 2026-10-13, 2026-10-14 (UTC).
- `progress_token` on those calls: **false on every call**: 194 calls, 0 true [handle: `grep -c '"progress_token":false'` gives 28, 128 and 38 on `logs\engine-20261012.jsonl`, `engine-20261013.jsonl`, `engine-20261014.jsonl`; `grep -c '"progress_token":true'` gives 0 on each].
- The calls came from Claude Desktop: the PR #152 chat's first call, `lr_search_photos` at `2026-10-13T12:17:58.873Z` in `logs\engine-20261013.jsonl`, is `tools/call id=2` at `2026-10-13T12:17:58.871Z` in `$L:10075` (Desktop's log at 10,814 lines, last written 2026-10-14).
- Desktop's log after the copy above (lines 9,203-10,814): 214 tool calls, all answered, none of 30 s or more [handle: pairing rule above, run with awk over `$L` from line 9,203, 2026-10-15]; cancels in the whole log: 0 (`Select-String -Path $L -Pattern 'notifications/cancelled' -SimpleMatch`).

**What happened after the two longest calls.** Taken from the engine's tool log records that follow each one.
- Row 5: the 168.5 s `lr_create_mask` answer (`BRIDGE_DISCONNECTED`) was followed 3.2 s later by `lr_list_masks` in the same session [handle: `logs\engine-20261010.jsonl`, records with ts `2026-10-11T05:49:48.588Z` and `05:52:40`]. Listing the masks fits a model that read the disconnect, so the result most likely reached the model after 168.5 s [inference].
- Row 6: after the 171.2 s answer (`AI_MASK_FAILED`), Claude made no further call in session `7ae27134` [handle: `logs\engine-20261011.jsonl`, records from ts `2026-10-12T00:41:27.541Z` on: only `hud_channel` follows]. The call 139.6 s into it (`lr_get_active_photo_context`) could be a timeout on Desktop's side, a new message from Jim, or a parallel call [unverified]. So row 6 says nothing either way about the limit.

## Numbers

| Field | Value | Handle |
|---|---|---|
| Longest tool call Desktop logged an answer for | 171.2 s | row 6 |
| Longest tool call whose result most likely reached the model | 168.5 s | row 5, Observed [inference] |
| Calls of 60 s or more, answered | 3 | rows 1, 5, 6 |
| Cancels sent by Desktop | 0 | count table, Observed |
| Desktop sends a progressToken | no (194 of 194 calls without one) | Observed |
| Desktop's tool-call time limit | not measured; at least 168.5 s [inference] | row 5 |
| Longest `lr_export_photos` / `lr_import_photos` call the engine allows | 160 s / 130 s (budget 40 s, then one photo of up to 120 s / 90 s) | `engine\src\library\files.ts` constants |

## Verdict

_Jim decides. Suggestion (Claude Code): close #136 with the constants unchanged. Both tools' longest call fits under the 168.5 s call whose result most likely got through, and a call that ends early leaves `not_yet` / `resume_after` to go on from._

## Consequences / open questions

- The timeout constants stay: `CALL_BUDGET_MS` 40 s, `IMPORT_PHOTO_TIMEOUT_MS` 90 s, `EXPORT_PHOTO_TIMEOUT_MS` 120 s (`engine\src\library\files.ts`) [stated: Jim, 2026-10-11, D2 = A; again 2026-10-15, "Go with A1"].
- Shorter per-photo timeouts were rejected: a timeout does not stop Lightroom's export or import, so the call would end with `maybe_done` and the next call would meet a busy Lightroom [inference].
- The engine's progress notifications (`engine\src\mcp\server.ts` `withProgress`) never run under Claude Desktop, which sends no token. They stay, for clients that send one.
- Still open: Desktop's actual time limit. If it is under 160 s, a full-size export can still outlast the call; the measurement would be a probe that holds a call open for set times and checks the result reached the model (option A2 of the 2026-10-15 plan, not chosen).
