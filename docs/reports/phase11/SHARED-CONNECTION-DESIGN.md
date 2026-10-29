---
report: SHARED-CONNECTION-DESIGN (issue #211, step 2)
phase: 11
status: observed
authored_by: "Design note, pre-run findings and the reproduce checklist: Claude Code (Opus 5.5, night run on epic #207), 2026-10-27. Observed: filled by Claude Code from the logs of Jim's run, 2026-10-29. Decisions: Jim."
date: 2026-10-29
---

# Sharing one Lightroom connection across Claude Desktop's engine processes (issue #211)

## In five minutes

- **The problem.** Claude Desktop can start more than one lrc-avg engine for one connector. Only one engine at a time may talk to Lightroom (the plugin serves one client). Every other engine answers `ENGINE_BUSY` until the holder has gone 60 s without a tool call. Using chat and Cowork/Code at the same time is therefore likely to fail [inference: from the code below; never observed with Cowork/Code].
- **Upstream's fix** (Automaat, PR #243 and follow-ups): one engine leads and owns the plugin; the others forward each tool call to it over a named pipe [upstream claim].
- **Ours needs more than upstream's.** The edit session, the Deck channel and the session's HUD buttons live in the engine that holds the lock. Forwarding keeps all of them in the leader, so a follower has to forward only tool calls, progress and cancel. What is new for us is a leader that exits with an edit open (section 3).
- **Recommendation:** first run the reproduce checklist (section 6: one Lightroom session, about 10 minutes). If it shows `ENGINE_BUSY` or a failed start with chat plus Cowork/Code, choose **Option A** (port forwarding, 3 engine PRs and 1 check PR). If Desktop sends both surfaces to one engine, choose **Option B** (document it, 1 small PR).
- **Decided, 2026-10-29: Option B; Option A is parked** (section 8, "Decision") [stated: Jim, 2026-10-29, "Go with recommendations", on the batch lead's recommendation of B].
- **Plugin side:** nothing to port. Upstream's #296 and #237 are already in our plugin, and #297 has not been seen on Windows (section 7).
- **Decisions for Jim:** section 8, D1-D8.

## Purpose

Issue #211, work step 2: lay out the options with a recommendation before any code (rule 04, "STOP markers and decisions"). Its acceptance lines, quoted from the issue:

> - Tests with a fake plugin: two and three engines, leader exit, leader hang, forwarded progress and cancel, mid-call owner loss.
> - Jim: Claude Desktop with chat and Cowork/Code both calling `lr_get_selected_photos`; a session started in one surface; Abort from the Deck. Report under `docs/reports/`.
> - No `ENGINE_BUSY` in normal multi-process use.

This note writes no code. Option A's implementation plan is section 5.

## 1. The problem with handles

**How our engine shares Lightroom today:**

- **One engine per bridge**, enforced by a TCP listener on 127.0.0.1:8767, the event port + 1 [handle: `engine/src/mcp/instance-lock.ts:1-14, 25-32`]. Only one process can listen on that port, and the OS frees the port when the process ends, however it ends [handle: `instance-lock.ts:7-10`, two `listen` calls on one port gave `EADDRINUSE`, Node v24.11.1 win32, 2026-09-26]. The holder answers a connection with its PID [handle: `instance-lock.ts:41-66`].
- **Why only one engine:** the plugin serves one client and rebinds its send socket for each new one, so a second engine would take the bridge from the first [handle: `instance-lock.ts:1-3`, Phase 0 P-13].
- **The lock is taken lazily and given back.** The engine takes it on the first tool call that needs the bridge. It gives it back after `IDLE_RELEASE_MS` (60 s) without a call, but never while a session is open [handle: `engine/src/mcp/bridge-gate.ts:65-93`, `engine/src/mcp/main.ts:50-87`]. An engine without the lock answers `ENGINE_BUSY` and names the holder's PID [handle: `bridge-gate.ts:130-140`].
- **Why lazy.** Claude Desktop started two lrc-avg engines in the same second and sent every tool call to the one without the lock, because the other had taken it at start-up and was never called [handle: `bridge-gate.ts:5-11`: Jim's Phase 2 run, 2026-09-26, PIDs 2304 and 12632, children of claude.exe 10416; `mcp-server-lrc-avg.log` tool calls id 2-4 answered `ENGINE_BUSY` naming 2304]. Earlier, Desktop started the S3 server twice, 2 s apart, and only one of the two got `initialize` [handle: `docs/reports/phase0/S3/desktop-mcp-log-excerpt.txt`, "Server started" at 17:21:36.712 and 17:21:38.735, one `initialize` at 17:21:38.736]. Why Desktop keeps two engines is [unverified].
- **Calls overlap within one engine.** Desktop sent request id 14 while id 13 was still pending [handle: `engine/src/mcp/call-context.ts:4-5`, citing `docs/reports/phase8.5/desktop-call-limit.md`].
- **Desktop sends no progressToken** (194 of 194 calls) [handle: `engine/src/mcp/server.ts:221-226`, citing `desktop-call-limit.md`]. Forwarded progress therefore matters only for other clients.
- **The Deck and the session stay with the lock.** The engine that holds the lock opens the HUD channel and writes `hud_endpoint.json`. It closes the channel when it gives the lock back [handle: `main.ts:20-26, 71-87`; `engine/src/hud/channel.ts:1-14`]. The classic HUD's buttons reach the engine over the bridge, which is why the lock is kept while a session is open [handle: `bridge-gate.ts:71-76`].

**What fails.** Suppose two engines are both used, for example a chat engine and a Cowork/Code engine:

- Whichever calls second within 60 s of the other's last call gets `ENGINE_BUSY`.
- While an edit is open in one surface, the other surface gets `ENGINE_BUSY` for the whole edit.

We have not seen this ourselves. Cowork/Code was never run against lrc-avg [unverified], and `docs/CLIENTS.md` lists Claude Code as tested on 2026-10-16 only, as a separate client.

**Upstream's failure was different.** Their engines exited on a held lock, and Desktop reported "Couldn't start for Cowork and Code sessions ... connection closed during the server/discover probe" [upstream claim: `git show ebd4c24` message; upstream `CLAUDE.md:19`]. Ours never exits on a held lock: `main.ts` serves MCP first and checks the lock only inside a tool call [handle: `main.ts:6-10, 110-117`]. So Desktop's start probe should pass for us, and the failure would come later, as `ENGINE_BUSY` on a tool call [inference].

**Where Desktop's log is.** The issue names `%APPDATA%\Claude\Logs\mcp-server-lrc-avg.log`. On this PC the file is under `%LOCALAPPDATA%\Claude\Logs\`, and there is no `%APPDATA%\Claude\logs` folder [handle: `docs/reports/phase8.5/desktop-call-limit.md`, "Harness"]. The checklist in section 6 has Claude Code look in both.

## 2. How upstream solved it [upstream claim throughout]

Read at upstream `1040453` (`C:/Users/jimbe/AppData/Local/Temp/lightroom-mcp`).

- **Election** (`server/src/bridge.ts`, from `ebd4c24`, PR #243, fixes their #238):
  - One `Bridge` per port pair. Whoever takes the instance lock leads: it listens on the broker, then starts the plugin sockets (`bridge.ts:163-201`). The others become followers and forward `callTool` (`bridge.ts:82-93, 215-242`).
  - Election starts on MCP `initialized` or on the first tool call, so short-lived probe processes never touch the plugin (`bridge.ts:69-76`; `index.ts:111-112`).
  - A follower whose broker socket closes re-elects after a jittered 200-400 ms (`bridge.ts:219-225, 276-284`).
  - A role-less call waits up to 10 s, then answers "No Lightroom MCP bridge owns the plugin connection yet" (`bridge.ts:28-29, 84, 286-298`).
  - A lock holder that does not serve the broker (an older version) gets an error naming its PID (`bridge.ts:31-37, 227-233`).
- **Broker** (`server/src/broker.ts`):
  - Line-delimited JSON over a Unix socket, or on Windows the named pipe `\\.\pipe\lightroom-mcp-<user>-bridge-<req>-<resp>` (`broker.ts:43-56`).
  - The follower opens with a challenge, which the owner signs as `HMAC-SHA256(token, "owner:"+challenge)`. The owner sends a nonce, and the follower signs each call as `HMAC(token, "follower:"+nonce)`. The token itself never crosses the pipe, and a squatter on the pipe name can neither pose as the owner nor learn the token (`broker.ts:1-11, 58-61, 171-198, 311-339`).
  - Frames: 1 KB before the handshake, 16 MB after (`broker.ts:39-41`).
  - Malformed lines are logged and dropped (`broker.ts:190-194`).
  - If the owner's socket closes during a call, every pending call resolves with `OWNER_LOST_MESSAGE` ("... its result is unknown. Check Lightroom before retrying a call that changes photos") and is never retried (`broker.ts:288-290, 343-348`).
- **#286, recover from an unresponsive owner** (`15d892d`):
  - Their lock is a PID file. A live but hung PID, or a reused one, was never reclaimed.
  - The owner now refreshes a `.lock.alive` heartbeat every 5 s. A lock whose heartbeat and file are both older than 60 s is reclaimed through a guarded path.
  - A leader that wakes to find its lock taken steps down (`bridge.ts:203-213`).
  - Followers check every 5 s and re-elect after two stale checks in a row, or when the lock names another PID (`bridge.ts:244-269`).
  - 511 lines added, most of them tests (`git show --stat 15d892d`).
- **#295, finish forwarded calls before exit** (`edf3a44`):
  - An owner whose own client exits waits for the followers' calls in flight. A call counts as done once its reply is flushed (`broker.ts:229-259`, `bridge.ts:105-121`).
  - The grace is the longest action timeout + 5 s, 305 s, with a hard exit timer behind it (`index.ts:63, 125-131`).
  - Seen live on LrC 15.6 macOS: a forwarded `import_photos` returned its real result 15 s after the owner's stdin closed (commit message).
- **#236, diagnose hijacked plugin ports** (`923f27d`): when a ping goes unanswered, netstat and tasklist name the process holding the plugin ports. On the plugin side, "failed to open" is now logged.
- **#404, progress and cancellation through the broker** (`f15adbc`):
  - `progressFor` frames carry progress and have no response id.
  - Signed `cancelFor` controls abort the leader-side `AbortController`.
  - A follower whose socket closes aborts its calls (`broker.ts:152-153, 183-218, 359-394`).
  - 76 lines in `broker.ts`/`bridge.ts` plus tests.
- **Their lock:** the PID file is hard-linked into place, so no lock exists without its PID. Reclaim is serialised by a guard file (`instance-lock.ts:52-57, 93-122`). Ours needs none of this: a TCP listener cannot outlive its process and cannot be held by a reused PID [handle: `instance-lock.ts:7-12`].

## 3. What ours needs that upstream's does not

| Ours | Where | What forwarding means for it |
|---|---|---|
| The edit session (in memory, one per engine) | `engine/src/session/manager.ts:150` refuses a second open session | Every session tool runs in the leader, so chat and Cowork/Code see **one** session. Session tools name it by `session_id` (`engine/src/mcp/defs-session.ts:52-88`), so either surface can step or end it. That matches the Deck, which can also end it (D7). |
| A leader exits with an edit open | `engine/src/session/left-open.ts:1-19` (log with `ended` null, recovered by `lr_end_session` revert/accept/abandon once the bridge is held), `engine/src/session/abandon.ts:1-23` | No new mechanism needed. The new leader finds the session left open. `lr_get_active_photo_context` lists it (`left_open`), and `lr_begin_session` refuses that photo (`SESSION_LEFT_OPEN`) until it is ended [handle: `left-open.ts:13-18`; `engine/tests/session-left-open.test.ts`, against the sim]. Upstream has nothing like this. D3 decides whether the leader should linger instead. |
| HUD channel and Deck | `main.ts:23-26, 71-80`; `docs/hud/lrc-avg-hud-spec-v2.md` 3.2 | Stay with the leader: `onAcquire` already opens the channel. A Deck that is running reads the endpoint file a new engine writes, and connects (spec 3.2, "Engine takes the bridge lock" row). A new leader without the shown edit sends `welcome` with a null `session_id`, and the Deck shows "gone" (spec 3.2). **Nothing to forward:** Deck clicks and classic HUD events reach only the leader [inference: from `hud/channel.ts` and `hud/events.ts`; contrary to the issue's guess that a follower must forward HUD events]. |
| The call deadline: `pending` after 50 s, and a repeated identical call attaches to the run | `engine/src/mcp/deadline.ts:1-29` | Runs in the leader only. A follower's retry is forwarded with the same name and arguments and attaches there. It also bounds the drain on leader exit: no forwarded call stays open longer than about 50 s [inference]. |
| Per-call context: the client's identity, progressToken, cancel signal | `engine/src/mcp/call-context.ts`; `server.ts:266-287` | The follower forwards its client's `clientInfo` and whether a token was sent. The leader runs the call inside `withCallContext`, so the tool log and the session log name the real client and model. Cancel aborts the leader-side signal that batch tools poll (`callCancelled`). |
| Progress notes | `server.ts:227-244` (`withProgress`, the session's HUD note as message) | The leader sends progress frames; the follower turns them into `notifications/progress` with its own client's token. Desktop sends no token, so this is for other clients. |
| Idle release (60 s) | `main.ts:50-55, 81-85` | Not needed once followers forward. Keeping it would hand leadership around and close and reopen the Deck channel (D2). |
| Results with images | `engine/src/mcp/image-cap.ts` (900,000-character base64 cap, 2000 px edge) | Fit under a 16 MB frame cap. |
| Different engine versions on one PC (a dev engine in Claude Code, the installed one in Desktop) | `docs/CLIENTS.md` | Upstream does not check versions. Ours should send `engine_version` in the handshake and refuse a mismatch with a clear error (D6), because tool schemas differ between versions. |

## 4. Options

| | A: port leader/follower forwarding | B: keep the lazy lock, document it | C: wait for a report |
|---|---|---|---|
| What | An election over our existing TCP lock, plus a named-pipe broker with an HMAC handshake, forwarded progress and cancel, owner-lost, drain on exit, and a version check. Idle release is dropped. | README and `docs/CLIENTS.md` say: use lrc-avg from one Claude Desktop surface at a time; `ENGINE_BUSY` means the other surface (or a dev check) holds Lightroom, so wait a minute or end its edit. The `ENGINE_BUSY` text may name the 60 s. | Nothing now. #211 stays open. |
| Cost | 3 engine PRs + 1 check PR, about 4 sessions, 4 Greptile reviews (about $0.50 each [stated: Jim, 2026-09-28, rule 04]) plus 1 Lightroom/Desktop check by Jim. About 600-800 source lines and as many test lines [inference: upstream's `bridge.ts` + `broker.ts` are 709 lines at `1040453`; we skip their lock file and heartbeat (about 230 lines of `instance-lock.ts`) but add the version check and the session hand-over]. | 1 small PR, under 1 session, docs only (Greptile skips docs, so no review cost). | 0 |
| Risk | Medium: every tool call in a follower takes a new path (`server.ts` `tools/call`). A broker bug would break every forwarded call. Mitigated by fake-plugin tests (section 5) and by keeping the leader's path identical to today's. Hung-leader handling is weaker than upstream's (D4). | Low for code. Leaves the third acceptance line ("No `ENGINE_BUSY` in normal multi-process use") unmet, and epic #207's parity line for #211 with it. | The same as B, and the first report would come from a confused user. |
| Module Map | No new module and no new edge [inference]: the broker, election and forwarding go in `mcp` (`mcp/broker.ts`, `mcp/broker-protocol.ts`, `mcp/election.ts`). `mcp` already may import `bridge` (token reading), `hud` (Deck open on leadership) and `session`. `bridge` stays the plugin link only. To confirm with `npm run arch:check` in PR A1. If `readTokenFile` must be exported from `bridge/index.ts`, that is inside `bridge`, not a new edge. | None | None |
| Also helps | Fewer plugin reconnects: one leader stays connected instead of a release and re-take every idle minute. Each engine disconnect closes the plugin's receive socket and can trigger a rebind (`plugin/LrC-AVG.lrplugin/Sockets.lua:46-65, 99-104`), the kind of socket work #176 linked to freezes [inference]. | | |

**Recommendation: A, conditional on the reproduce checklist (section 6).**

- If the check shows `ENGINE_BUSY`, or a surface that cannot start lrc-avg, while chat and Cowork/Code are both used, build A.
- If Desktop runs both surfaces through one engine process, A buys nothing in Desktop; choose B.
- Either way, the check is one short Lightroom session, cheaper than either option.

## 5. Option A: implementation plan (session-sized PRs)

Branches are `phase-11/<topic>`; each PR passes the four gates and gets one Greptile review.

**PR A1, the broker** (one session; nothing wired in):

- `engine/src/mcp/broker-protocol.ts` holds zod schemas for every frame (rule 01):
  - `hello {challenge}`;
  - `greet {nonce, proof, engine_version, pid}`;
  - `call {id, auth, name, args, client, progress}`;
  - `reply {id, result}`;
  - `progress {for, progress, message?}`;
  - `cancel {for, auth}`.
- `engine/src/mcp/broker.ts` holds the `BrokerServer` and `BrokerClient`:
  - Pipe `\\.\pipe\lrc-avg-<user>-<eventPort>`.
  - HMAC-SHA256 with the bridge token (`%USERPROFILE%\.lrc-avg\bridge_token`, read the way the bridge client reads it), in both directions as upstream does.
  - Frame caps of 1 KB before the handshake and 16 MB after.
  - In-flight count and `whenIdle`.
  - Owner-lost for pending calls when the pipe closes.
- Tests, `engine/tests/broker.test.ts` (in-process pairs):
  - the handshake;
  - a wrong token, rejected in both directions;
  - a malformed frame dropped without a crash;
  - an oversize frame closing the pipe;
  - progress relayed;
  - cancel aborting the leader-side signal;
  - a closed pipe resolving pending calls as owner-lost.
- Records, with a handle, whether a second `listen` on the same pipe name fails on Windows [unverified]. Nothing depends on it, since the TCP lock stays the election primitive.

**PR A2, election and forwarding** (one session):

- `engine/src/mcp/election.ts`:
  - Roles `none | leader | follower` over the existing `acquireInstanceLock`.
  - Election starts on `server.oninitialized` (already hooked, `main.ts:116`) or on the first `tools/call`.
  - A leader starts its broker, then the bridge client (upstream's order, so a leader that cannot serve does not touch the plugin).
  - A follower connects and re-elects with jitter when the pipe closes.
- `server.ts` `tools/call`:
  - In a follower, it forwards name, arguments, client identity, whether a progressToken was sent, and the abort signal.
  - The leader's broker handler calls the same `withCallContext` → deadline → `respond` path as a local call. That path moves into one shared function so the two cannot drift.
- `main.ts`:
  - The idle release goes (D2).
  - `ENGINE_BUSY` remains only for a holder that does not serve the pipe (an engine from before forwarding) or one whose `engine_version` differs (D6). Both messages name the PID.
- Tests, with `engine/tests/helpers/fake-plugin.ts` and `lightroom-sim.ts`, engines in one process with separate MCP servers on in-memory transports:
  - **Two engines:** a follower's `lr_get_selected_photos` reaches the sim once and returns the leader's result.
  - **Three engines:** calls from all three succeed, and only the leader connects to the fake plugin.
  - **Shared session:** begun through follower 1, stepped through follower 2, ended by the leader's own client.
  - **Forwarded progress:** a follower call with a progressToken gets `notifications/progress`.
  - **Forwarded cancel:** `notifications/cancelled` on the follower aborts the leader-side signal, and a batch tool stops between photos.
- If A2 grows past about 600 changed lines, A3's items stay in A3; otherwise A2 and A3 may merge.

**PR A3, hand-over and failure** (one session):

- **Drain on exit** (#295): a leader whose stdin ends waits for forwarded calls in flight, at most `CALL_DEADLINE_MS` + 5 s. The deadline bounds every call [inference: `deadline.ts:25-29`]. A hard-exit timer backs it up.
- **Edit open at exit:** the session is left open (D3). A follower's next call reaches the new leader, which reports the session through the existing `left_open` path.
- **Owner lost mid-call:** `OWNER_LOST`, not retried (D5).
- **Hung leader:** the follower sees forwarded calls unanswered and the lock holder not answering its PID probe twice (`instance-lock.ts:41-59`, 500 ms). It answers `ENGINE_HUNG`, naming the PID, and does not kill it (D4).
- **The Deck follows the leader:** the new leader's `onAcquire` opens the channel and rewrites the endpoint file; checked with `engine/tests/helpers/hud-harness.ts`.
- Tests:
  - **Leader exit:** the follower re-elects, and the next call works through the new leader.
  - **Leader exit with a call in flight:** the follower gets the real result.
  - **Leader exit past the grace:** owner-lost.
  - **Leader exit with an edit open:** the new leader lists it as `left_open`; `lr_end_session` revert puts the photo back in the sim.
  - **Leader hang:** a leader whose broker stops answering gives `ENGINE_HUNG` within a bounded time.
  - **Mid-call owner loss:** the pipe is destroyed mid-`lr_step`; the result is owner-lost and the call is not repeated (the sim counts one `apply_settings`).
- Docs: README "Troubleshooting", `docs/CLIENTS.md`, `docs/DEVELOPMENT.md`; the vault ARCHITECTURE §2 note via the coordinator.

**PR A4, Jim's check** (one session plus Jim's run):

- The harness and report for acceptance line 2: `docs/reports/phase11/SHARED-CONNECTION.md`, with the run steps added to the `lrc-avg-checks` skill.
- Jim's part: Claude Desktop chat and Cowork/Code both call `lr_get_selected_photos`; an edit is begun in one surface and stepped from the other; Abort from the Deck.
- Claude Code collects Desktop's log, the tool log and the process list. Jim answers y/n in the harness.

**Not ported** (each a ponytail cut, with what would bring it back):

- Upstream's PID-file lock, heartbeat file and reclaim guard. The TCP lock cannot go stale. Revisit only if hung engines are seen.
- #236's netstat diagnosis of foreign port owners. Our plugin logs "failed to open" already (`Sockets.lua:26-44`). Revisit if a foreign listener is seen.

## 6. Jim's reproduce step (issue step 1)

No harness exists yet. This checklist uses what the engine already writes:

- Claude Desktop's log;
- the tool log (`logs\engine-<yyyymmdd>.jsonl` with the dev entry, else `%LOCALAPPDATA%\LrC-AVG\logs`);
- `%LOCALAPPDATA%\LrC-AVG\last-start.json`.

Claude Code collects all of it and a process list after each "done". Jim types into Claude Desktop and says "done".

**Before you start** (Claude Code checks these and tells you when to begin):

- Lightroom Classic is open in Library with one photo selected, and the LrC-AVG plugin is enabled.
- Claude Desktop is quit (tray icon > Quit).

**Steps:**

1. Start Claude Desktop. Open a **new chat** and type exactly: `Call lr_get_selected_photos and show me the result.` You should see a tool result, either your photo or an error. Either is fine. Say **done**.
2. In Claude Desktop, open **Cowork** (or **Code**) and start a new task there. Type exactly the same sentence. Say **done**.
3. Within one minute, go back to the chat from step 1 and type the same sentence again. Say **done**.
4. In the Cowork/Code task, type exactly: `Call lr_begin_session on the selected photo, then call lr_end_session with outcome revert.` Say **done**.
5. Quit Claude Desktop (tray icon > Quit). Say **done**.

**If something goes wrong**

- If Claude Desktop shows no Cowork or Code tab, say **no Cowork** at step 2. Claude Code then records that and stops.
- If Claude Desktop asks to allow an lrc-avg tool, click **Allow** (once, or always), then go on.
- If a step shows "Couldn't start" for lrc-avg, say **done** anyway. That message is the finding.

**What Claude Code records:**

- the engine PIDs with their parent;
- which PID answered each call (`ENGINE_BUSY` names the holder);
- the log lines `Server started`, `initialize` and `tools/call` per process;
- whether the session began and ended with the photo put back.

### Observed (Jim)

Filled by Claude Code from the three log excerpts, 2026-10-29. Jim ran the steps as check 6 of the 1.7.0 batch (`BATCH-1.7.0-CHECKS.md`), engine and plugin 1.7.0 [stated: Jim, 2026-10-29, "check 6 failed, the second instance was unable to connect because the bridge was open."]. The files [all in `docs\reports\phase11\SHARED-CONNECTION-DESIGN\reproduce\`]: the engine's tool log `engine-20261028_excerpt.jsonl` (UTC), Claude Desktop's MCP log `mcp-server-lrc-avg_excerpt.log` (UTC), and the plugin log `bridge_log_excerpt.txt` (Jim's local time, UTC-7).

| Step | Client (tool log `client.name`) | Time (UTC) | Call | Result |
|---|---|---|---|---|
| 1 | `claude-ai` (the chat) | 00:57:55.483 | `lr_get_selected_photos` | ok, 1 photo, 542.5 ms |
| 2 | `local-agent-mode-lrc-avg` (Cowork) | 00:58:26.936 | `lr_get_selected_photos` | **`ENGINE_BUSY`**: "Another LrC-AVG engine (process 16092) is using the Lightroom bridge", port 8767 |
| 3 | `claude-ai` | 00:59:04.917 | `lr_get_selected_photos` | ok, 1 photo, 521.7 ms |
| 4 | `local-agent-mode-lrc-avg` | 00:59:43.734 | `lr_begin_session` | **`ENGINE_BUSY`**, the same process 16092 |

[handle: `engine-20261028_excerpt.jsonl`, `ts`, `tool`, `ok`, `client`, `error`]

- **Step 4: no session began**, so there is nothing to put back [handle: the same file, `lr_begin_session` `ok` false]. `lr_end_session` does not appear in the excerpt.
- **Both Cowork calls came within 60 s of the chat's last call**: 31 s after step 1's answer and 38 s after step 3's [handle: the same file, `ts` and `duration_ms`]. The engine keeps the bridge for 60 s after a call [handle: `engine\src\mcp\main.ts:56` `IDLE_RELEASE_MS = 60000`].
- The plugin log matches: the chat's engine connected at 17:57:55.517 local and its connection closed at 17:58:56.045, 60 s after its `get_selection` (17:57:56.026); it connected again at 17:59:04.921 and closed at 17:59:59.616 [handle: `bridge_log_excerpt.txt`]. No second engine connected in the excerpt.
- Claude Desktop's MCP log shows one lrc-avg server answering: started at 00:57:26.935 (after a first start shut down at 00:57:26.147), `tools/call` id 3 at 00:57:55.485 and id 4 at 00:59:04.916, the times of the chat's two calls, and "Shutting down server" at 00:59:59.590 [handle: `mcp-server-lrc-avg_excerpt.log`]. That shutdown is likely step 5 (Claude Desktop quit), and it closed the bridge before the 60 s ran out [inference: the plugin's close at 17:59:59.616 local is 26 ms later]. The Cowork calls are not in this log, so Cowork's engine logs somewhere this excerpt does not cover [inference].
- That process 16092 is the chat's engine is [inference]: the tool log does not record its own process id, and **no process list was taken during the run**, so the engine PIDs with their parent (What Claude Code records, first item) are not recorded.
- **The issue's problem is reproduced:** a Cowork task cannot use LrC-AVG while the chat's engine holds the bridge, and gets `ENGINE_BUSY` instead [handle: the table above].

## 7. Plugin-side items upstream fixed (#296, #297, #237), compared with ours (analysis only)

| Upstream | What it fixed [upstream claim] | Ours | Port? |
|---|---|---|---|
| #296 `4a30a85` rebind the request socket after close | Lightroom closed both listeners with no client, and the request side only called `reconnect()` on a dead listener. Fix: request generations, rebind on `onClosed` or a non-timeout error, and a `reconnect()` that throws leads to a rebind. | **Already in, with more.** Plugin 1.1.0 (PR #191, `8f7a0bd`, issue #176): <ul><li>receive-socket generations, and `onClosed` → `rebindOr` [handle: `plugin/LrC-AVG.lrplugin/Sockets.lua:46-66, 68-119`];</li><li>a re-arm that fails is rebound on the next tick [handle: `plugin/LrC-AVG.lrplugin/Bridge.lua:196-221`];</li><li>beyond upstream: rebinds at most once per 60 s per side (`REBIND_MIN_SECONDS`, #174/#176), and a new connection cancels a rebind queued on the last close (`Sockets.lua:79-82`).</li></ul> Run 5: 0 rebinds and no stutter in 120 s [handle: vault LR_SDK_NOTES "Recorded in Phase 9 — 2026-10-24"; issue #176 closing comment]. | No |
| #297 `a6295f8` explain that start waits for activation | On LrC 15.6 macOS, `LrInitPlugin` ran only when Lightroom's window was first activated. Fix: log "Plugin initialized" and say so in the not-connected error. | <ul><li>Our init's first log line is `bridge: starting generation N` (`Bridge.lua:297`), or `bridge: not started (plugin disabled)` (`PluginInit.lua:14-15`). Either shows the init ran, so the log half is covered.</li><li>On Windows, `LrForceInitPlugin` started the plugin with Lightroom [handle: LR_SDK_NOTES "Recorded in Phase 1", first line of `P1\p1_bridge_log_2026-09-26T21-06-50-295Z.txt`]. A hidden or background launch on Windows deferring it is [unverified].</li><li>Our not-connected text asks whether Lightroom is running with the plugin enabled (`engine/src/bridge/client.ts:224`).</li></ul> | No, until seen on Windows. A one-line wording change if it is. |
| #237 `5540c46` stop the superseded instance on reload | Reload Plug-in left the old server task running and holding the ports. Fix: the old loop reads the token file every 1 s and exits when it holds another instance's token. Armed only if its own token write succeeded. | **Already in, found independently.** <ul><li>Plugin 0.17.0: `replacedOnDisk` checks the token file every 2 s (`Bridge.lua:223-249`), after LrC 15.6 on Windows ran both instances [handle: LR_SDK_NOTES "Recorded in Phase 6 — 2026-10-04": the old bridge stopped within 2 s, 5 of 5 connections reached the new one].</li><li>Stricter than upstream: a bridge whose token write fails does not start at all (`Bridge.lua:332-339`).</li><li>Beyond upstream: an overlapping start rebinds once (`Bridge.lua:61-72, 260-265`).</li></ul> | No |

**#176 and this issue.** #176's freezes were traced to socket rebinds and fixed in plugin 1.1.0 [handle: issue #176 closing comment, stall:check run 5]. Option A does not touch the plugin. It lowers how often an engine connects and disconnects, since no idle release means one long-lived connection [inference]. `Stall.lua` stays as the measure (`npm run stall:check`).

So **work step 4 of #211 needs no plugin change** [inference: from the table]. Whether to mark it done is Jim's call (D8).

## 8. Decisions for Jim

### Decision (2026-10-29)

- **D1: Option B, use LrC-AVG from one Claude surface at a time.** Option A (section 5) is **parked**, not dropped: its plan stays here for when it is wanted [stated: Jim, 2026-10-29, "Go with recommendations", on the batch lead's recommendation of B for issue #211].
- This differs from the recommendation above, which was A once section 6 showed `ENGINE_BUSY`, as it did [handle: section 6 "Observed"]. The choice of B is Jim's, made with that result in hand [stated: the same].
- What B shipped (PR on branch `docs/one-surface-211`): README "Known limitations" ("One Claude surface at a time") and "If something goes wrong", `docs/CLIENTS.md`, and an `ENGINE_BUSY` text that names the fix: end the other surface's edit, wait a minute, or quit the other AI app [handle: `engine/src/mcp/bridge-gate.ts` `ready`; `engine/tests/mcp-lock.test.ts` "answers ENGINE_BUSY while another engine holds the lock"].
- **Left unmet:** the issue's third acceptance line ("No `ENGINE_BUSY` in normal multi-process use"), and epic #207's parity line for issue #211 with it (section 4, B "Risk"). Whether issue #211 stays open for A is Jim's call.
- D2-D7 apply to A only and wait with it. D8 is still open.

| # | Question | Options | Recommendation |
|---|---|---|---|
| D1 | Which option? | A, B or C (section 4) | Run section 6 first. A if it shows `ENGINE_BUSY` or a failed start; B if Desktop uses one engine for both surfaces. |
| D2 | Under A, drop the 60 s idle release? | (a) drop it: the leader keeps the bridge until its client exits; (b) keep it | (a). Followers forward, so nobody needs the lock back, and keeping it would close and reopen the Deck channel. Dev checks already require Claude Desktop quit. |
| D3 | The leader's client exits while an edit is open | (a) finish the calls in flight, then exit; the edit is left open and recovered by the new leader (existing `left-open.ts`); (b) the leader lingers while an edit is open and a follower is connected | (a). It reuses tested recovery; (b) risks an orphaned engine holding Lightroom. |
| D4 | A hung leader (alive, not answering) | (a) report `ENGINE_HUNG` naming its PID; (b) the follower kills that PID | (a). Killing a process is destructive, and a hung Node engine has not been seen. |
| D5 | Owner lost mid-call | (a) never retry (upstream); (b) retry read-only tools once after re-election | (a). It is simpler, and the AI can call again. |
| D6 | Leader and follower run different engine versions | (a) refuse, with an error naming both versions and the PID; (b) forward anyway | (a). Tool schemas differ between versions. |
| D7 | One edit at a time across all surfaces, and any surface may step or end it by `session_id` | (a) yes; (b) only the surface that began it | (a). The Deck can end it already, and (b) needs session ownership that does not exist. |
| D8 | #211 work step 4 (plugin ports) | (a) mark it done: #296 and #237 are in, and #297 is not seen on Windows; (b) port #297's wording now | (a), on your word. Claude Code does not close the item itself. |
