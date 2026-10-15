// The clients check (devtools\clients-*.ts, `npm run clients:check`) without Lightroom or a client: its
// state across runs, and the judges that read a client run's tool and session logs. A pending line
// (issue #155 R3: `pending`, no `ok`) must never count as a begin or a pass.

import { describe, expect, it } from "vitest";
import { approvedOnDeck, begunAndStepped, editDone, identityLogged, judgeRun, parseSessionLog, recovered, sessionFacts } from "../src/devtools/clients-judge.js";
import { lastText } from "../src/devtools/clients-run.js";
import { clientsStateSchema, done, emptyRow, newState, rowOf, stateToContinue, testOf } from "../src/devtools/clients-state.js";
import { memoryStore } from "../src/devtools/phase5-state.js";
import type { SessionLogData } from "../src/log/index.js";

const SINCE = Date.parse("2026-10-15T10:00:00.000Z");
const at = (s: number): string => new Date(SINCE + s * 1000).toISOString();
const client = { name: "opencode", version: "1.18.35" };

const records = [
  { ts: at(-60), tool: "lr_begin_session", ok: true, session_id: "old", log_path: "C:/logs/old.json" }, // before the run
  { ts: at(1), tool: "lr_begin_session", pending: "detached", args: {}, client }, // a pending line: no ok
  { ts: at(2), tool: "lr_begin_session", ok: false, duration_ms: 5, error: { code: "NO_PHOTO" }, client },
  { ts: at(3), tool: "lr_begin_session", ok: true, duration_ms: 900, session_id: "s1", log_path: "C:/logs/s1.json", client },
  { ts: at(4), tool: "lr_step", pending: "detached", args: { session_id: "s1" }, client },
  { ts: at(5), tool: "lr_step", ok: true, duration_ms: 800, session_id: "s1", client },
  { ts: at(6), tool: "lr_step", ok: false, duration_ms: 10, args: { session_id: "s1" }, client },
  { ts: at(7), tool: "lr_step", ok: true, duration_ms: 700, args: { session_id: "s1" }, client },
  { ts: at(8), tool: "lr_end_session", ok: true, duration_ms: 300, session_id: "s1", outcome: "accept", client },
  "not a record",
];

describe("clients check judges", () => {
  it("finds the run's begin, its passes and its end, and counts pending lines apart", () => {
    const j = judgeRun(records, SINCE);
    expect(j).toMatchObject({ begun: true, session_id: "s1", log_path: "C:/logs/s1.json", client_logged: "opencode", passes: 2, ended: "accept", pending_lines: 2, invalid: 1 });
    expect(editDone(j)).toBe(true);
    expect(begunAndStepped(records, SINCE)).toBe(true);
  });

  it("never takes a pending line for a begin or a pass", () => {
    const onlyPending = records.filter((r) => typeof r === "object" && "pending" in r);
    const j = judgeRun(onlyPending, SINCE);
    expect(j.begun).toBe(false);
    expect(j.passes).toBe(0);
    expect(j.pending_lines).toBe(2);
    expect(begunAndStepped(onlyPending, SINCE)).toBe(false);
    expect(begunAndStepped(records.slice(0, 5), SINCE)).toBe(false); // begun, no finished step yet
  });

  it("reads client, model, approvals and the recovery from the session log", () => {
    const log = { client, model: "openai/gpt-6-luna", outcome: "revert", ended_by: { source: "recovery", reason: "x" }, approvals: [{ by: "hud" }, { by: "claude" }], passes: [{}, {}] } as unknown as SessionLogData;
    const f = sessionFacts(log);
    expect(f.deck_line).toBe("OpenCode · openai/gpt-6-luna");
    expect(identityLogged(f)).toBe(true);
    expect(recovered(f)).toBe(true);
    expect(approvedOnDeck(judgeRun(records, SINCE), f)).toBe(true);
    const none = sessionFacts(null);
    expect(none.deck_line).toBe("the AI");
    expect(identityLogged(none)).toBe(false);
    expect(recovered(none)).toBe(false);
  });

  it("reports a session log it cannot read", () => {
    expect(parseSessionLog("{").log).toBeNull();
    expect(parseSessionLog('{"schema":"x"}').error).toMatch(/does not validate/);
  });

  it("takes a client's last text from its JSON output", () => {
    const lines = [{ type: "assistant", message: { content: [{ type: "text", text: "Working." }] } }, { type: "result", result: "A red barn under snow." }];
    expect(lines.reduce<string | null>((t, l) => lastText(l) ?? t, null)).toBe("A red barn under snow.");
  });
});

describe("clients check state", () => {
  const logDir = "C:/out/logs_a";

  it("saves and reads a state through its schema", () => {
    const s = newState("2026-10-15T10:00:00Z", logDir);
    rowOf(s, "opencode").T4 = testOf(true, { passes: 1 });
    s.pending.push({ uuid: "u1", label: "a.NEF", snapshot_id: "9", snapshot_name: "AVG clients check before x", start: { exposure: 0 } });
    const store = memoryStore(clientsStateSchema);
    store.save(s);
    expect(store.load()).toEqual(s);
  });

  it("resumes an unfinished state and keeps what is still to put back on a new one", () => {
    const saved = { ...newState("t0", logDir), mode_changed: true, registrations: [{ client: "hermes" as const, method: "append" as const, file: "f", backup: "b", sha256: "h" }] };
    expect(stateToContinue(saved, "t1", "C:/out/logs_b", false)).toMatchObject({ resumed: true, state: { started_at: "t0", log_dir: logDir } });
    const fresh = stateToContinue(saved, "t1", "C:/out/logs_b", true);
    expect(fresh).toMatchObject({ resumed: false, state: { started_at: "t1", log_dir: "C:/out/logs_b", mode_changed: true } });
    expect(fresh.state.registrations).toHaveLength(1);
    expect(stateToContinue({ ...saved, finished: true }, "t1", "C:/out/logs_b", false).resumed).toBe(false);
  });

  it("counts a client not run as done", () => {
    expect(done({ ...emptyRow(), not_run: "not installed" }, "T6")).toBe(true);
    expect(done(emptyRow(), "T6")).toBe(false);
  });
});
