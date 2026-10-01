// The Phase 5 check's pure parts: a chat judged from its tool-log records (phase5-chat-eval.ts), the
// resumable state file (phase5-state.ts), and the plugin log and HUD trace (phase5-trace.ts).

import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { approveChatProblems, evaluateChat, goldenChatProblems } from "../src/devtools/phase5-chat-eval.js";
import { FIXTURES } from "../src/devtools/phase3-config.js";
import { fileStateStore, newState, stateToContinue, type CheckState } from "../src/devtools/phase5-state.js";
import { acceptance } from "../src/devtools/phase5-summary.js";
import { PluginLog, lineTime, stagesOf, tracked, type HudTraceEntry } from "../src/devtools/phase5-trace.js";
import type { SessionLogData } from "../src/log/index.js";

let tmp = "";
beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-p5units-"));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const rec = (tool: string, extra: Record<string, unknown>): Record<string, unknown> => ({ ts: "2026-09-30T10:00:00.000Z", tool, ok: true, duration_ms: 5, ...extra });
const begin = (sid: string, filename = "a.NEF") => rec("lr_begin_session", { session_id: sid, intent_id: "landscape_golden_hour", target: { uuid: "U", filename }, snapshot: { id: `S-${sid}`, name: "AVG pre-session" }, log_path: `L-${sid}` });
const step = (sid: string) => rec("lr_step", { session_id: sid });
const end = (sid: string, outcome: string) => rec("lr_end_session", { session_id: sid, outcome });
const hud = (sid: string, shown: boolean) => rec("hud_update", { session_id: sid, seq: 1, stage: "begin", result: { applied: true, shown, opened: shown } });
const log = (approval: string, extra: Partial<SessionLogData> = {}) => ({ engine_version: "0.9.0", settings: { approval }, approvals: [], ...extra }) as unknown as SessionLogData;

describe("devtools: Phase 5 check, a chat from its tool log", () => {
  it("judges the session that ended with accept, not one Claude reverted and began again", () => {
    const e = evaluateChat([begin("s1"), step("s1"), end("s1", "revert"), begin("s2"), hud("s2", true), step("s2"), step("s2"), end("s2", "accept")]);
    expect(e).toMatchObject({ session_id: "s2", passes: 2, session_ended: "accept", hud_shown: true, snapshot: { id: "S-s2" } });
    expect(goldenChatProblems(e, log("autonomous"), "a.NEF", "0.9.0")).toEqual([]);
  });

  it("names every way a golden-hour chat misses AC-1", () => {
    const e = evaluateChat([begin("s1", "b.NEF"), ...Array.from({ length: 5 }, () => step("s1")), end("s1", "revert")]);
    expect(goldenChatProblems(e, log("approve_each_pass", { engine_version: "0.8.0" }), "a.NEF", "0.9.0")).toEqual([
      "the session was on b.NEF, not a.NEF",
      "5 passes, not 1-4",
      "the session ended as revert, not accept",
      "the tool log shows no HUD update taken with the HUD open",
      "the session ran in approve_each_pass mode, not autonomous",
      "Claude Desktop ran engine 0.8.0, not 0.9.0: restart Claude Desktop",
    ]);
    expect(goldenChatProblems(evaluateChat([]), null, "a.NEF", "0.9.0")).toEqual(["no session began"]);
  });

  it("finds the approve chat's full wait in a failed lr_step, by its arguments and error details", () => {
    const waited = { ...rec("lr_step", { ok: false, duration_ms: 61234, args: { session_id: "s1" } }), error: { code: "AWAITING_APPROVAL", details: { session_id: "s1", waited_ms: 60001 } } };
    const e = evaluateChat([begin("s1"), step("s1"), waited, step("s1"), end("s1", "accept")]);
    expect(e.awaiting).toEqual([{ duration_ms: 61234, waited_ms: 60001 }]);
    const approved = log("approve_each_pass", { approvals: [{ at: "t", target: "master", pass: 1, by: "hud" }] } as Partial<SessionLogData>);
    expect(approveChatProblems(e, approved, "a.NEF", 60000)).toEqual([]);
    expect(approveChatProblems(e, log("approve_each_pass"), "a.NEF", 60000)).toEqual(["no pass was approved in the HUD"]);
    expect(approveChatProblems(evaluateChat([begin("s1"), step("s1"), step("s1"), end("s1", "accept")]), approved, "a.NEF", 60000)).toEqual(["no lr_step ran its full 60 s wait (AWAITING_APPROVAL)"]);
  });
});

describe("devtools: Phase 5 check, records checked and the outcome summed up", () => {
  it("leaves out a tool-log record that fails its check, and counts it", () => {
    const noLogPath = { ...begin("s0"), log_path: undefined };
    const e = evaluateChat([{ tool: 5 }, noLogPath, begin("s1"), step("s1"), end("s1", "accept")]);
    expect(e).toMatchObject({ invalid_records: 2, session_id: "s1", passes: 1, session_ended: "accept" });
  });

  const finishedState = (attempts: Array<Record<string, unknown>>): CheckState => {
    const ok = { ok: true };
    const s = newState("t0");
    s.part1 = { at: "t", ok: true, summary: { lines: { page_setting_reaches_engine: true, session_rides_out_plugin_manager: true, hud_tracks_stages: true, ac2_hud_abort: true, approve_blocks_until_pressed: true, ac3_hud_pick: true, menu_items: true, photo_put_back: true }, ac4: ok, unexpected: [] } };
    s.approve_chat = { at: "t", ok: true, summary: { put_back: true, ac4: ok, unexpected: [] } };
    s.chats = FIXTURES.map((fixture, i) => ({ fixture, at: "t", ok: true, summary: { attempts: i === 0 ? attempts : [{ ok: true, ac4: ok, unexpected: [], put_back: true }] } }));
    s.finished = true;
    return s;
  };

  it("counts every attempt of a chat held twice for AC-4 and unexpected changes, the last for AC-1 (Greptile, PR #49)", () => {
    const passed = { ok: true, ac4: { ok: true }, unexpected: [], put_back: true };
    expect(acceptance(finishedState([passed]))).toMatchObject({ accepted: true, headline: "WORKED" });
    const overLimit = acceptance(finishedState([{ ok: false, ac4: { ok: false }, unexpected: [], put_back: true }, passed]));
    expect(overLimit.lines).toMatchObject({ ac1_six_chats: true, ac4_clipping: false, no_unexpected_change: true });
    const changedAnother = acceptance(finishedState([{ ok: false, ac4: { ok: true }, unexpected: ["P: exposure changed"], put_back: true }, passed]));
    expect(changedAnother.lines).toMatchObject({ ac1_six_chats: true, ac4_clipping: true, no_unexpected_change: false });
    expect(changedAnother).toMatchObject({ accepted: false, headline: "FAILED" });
  });
});

describe("devtools: Phase 5 check, the resumable state", () => {
  it("saves the state by replacing it whole, leaving no partial file", () => {
    const file = path.join(tmp, "state.json");
    const store = fileStateStore(file);
    store.save(newState("t0"));
    store.save({ ...newState("t0"), page_autonomous: true });
    expect(store.load()?.page_autonomous).toBe(true);
    expect(readdirSync(tmp)).toEqual(["state.json"]);
  });

  it("continues an unfinished state, starts over on a finished one or with --new", () => {
    const store = fileStateStore(path.join(tmp, "state.json"));
    expect(stateToContinue(store, "t0", false)).toMatchObject({ resumed: false });
    const s = newState("t0");
    s.chats.push({ fixture: "a.NEF", at: "t1", ok: true, summary: {} });
    store.save(s);
    expect(stateToContinue(store, "t2", false)).toMatchObject({ resumed: true, state: { started_at: "t0" } });
    expect(stateToContinue(store, "t2", true)).toMatchObject({ resumed: false, state: { started_at: "t2", chats: [] } });
    store.save({ ...s, finished: true });
    expect(stateToContinue(store, "t3", false)).toMatchObject({ resumed: false, state: { started_at: "t3" } });
  });

  it("sets an unreadable state file aside instead of trusting it", () => {
    const file = path.join(tmp, "state.json");
    writeFileSync(file, JSON.stringify({ schema: "something else" }));
    expect(fileStateStore(file).load()).toBeNull();
    expect(existsSync(file)).toBe(false);
    expect(readdirSync(tmp).some((f) => f.startsWith("state.json.unreadable-"))).toBe(true);
  });
});

describe("devtools: Phase 5 check, the plugin log and the HUD trace", () => {
  it("reads the local time of a plugin log line, and finds a click's sent line by its id", () => {
    expect(lineTime("2026-09-30 05:54:54.295 INFO  hud: shown")).toBe(new Date(2026, 8, 30, 5, 54, 54, 295).getTime());
    expect(lineTime("no time here")).toBeNaN();
    const file = path.join(tmp, "bridge.log");
    writeFileSync(file, "2026-09-30 05:00:00.000 INFO  an earlier run's line, hud: hud_abort X1 from the hud: sent\n");
    const pl = new PluginLog(file);
    writeFileSync(file, "2026-09-30 05:00:00.000 INFO  an earlier run's line, hud: hud_abort X1 from the hud: sent\n2026-09-30 05:54:54.295 INFO  hud: hud_abort X2 from the hud: sent\n2026-09-30 05:54:54.300 INFO  hud: hud_accept X3 from the menu: not sent, the engine is not connected\n");
    expect(pl.clickSent("X1")).toBeNull(); // before the check started
    expect(pl.clickSent("X2")).toBe(new Date(2026, 8, 30, 5, 54, 54, 295).getTime());
    expect(pl.clickSent("X3")).toBeNull(); // not sent
  });

  it("counts a session as tracked from begin to an end, whatever stages the publisher coalesced", () => {
    const t = (session_id: string, stage: string, applied: boolean | null = true): HudTraceEntry => ({ at: "t", session_id, seq: 1, stage, open: false, ms: 2, applied, opened: false });
    const trace = [t("s", "begin"), t("s", "applying"), t("s", "applying"), t("x", "metrics"), t("s", "metrics", null), t("s", "awaiting_claude"), t("s", "aborted")];
    expect(stagesOf(trace, "s")).toEqual(["begin", "applying", "awaiting_claude", "aborted"]);
    expect(tracked(stagesOf(trace, "s"))).toBe(true);
    expect(tracked(["begin", "applying", "awaiting_claude"])).toBe(false);
    expect(tracked(["begin", "awaiting_claude", "accepted"])).toBe(false);
  });
});
