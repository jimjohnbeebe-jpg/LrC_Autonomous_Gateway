// looks-eval.ts (npm run looks:eval, Phase 10 row 6) without Lightroom: the sign test, the arm draw, the tally and
// headlines, the prompt text, Claude Code's stream-json result line and the command's arguments.

import { describe, expect, it } from "vitest";
import {
  armOf,
  assignArms,
  copyName,
  editPrompt,
  headlines,
  lastRun,
  mayReveal,
  newRun,
  parseCli,
  pickLeft,
  runId,
  runSchema,
  signTest,
  streamResult,
  tally,
  winner,
  type Edit,
  type EvalRun,
} from "../src/devtools/looks-eval.js";
import { lookCandidate, lookSummary } from "../src/devtools/looks-eval-look.js";

const ok: Edit = { at: "t", exit: 0, timed_out: false, error: null, begun: true, session_id: "s", passes: 3, ended: "accept", client_error: false, turns: 9, minutes: 4.2, stdout: "x" };
const cycle = (bits: number[]): (() => number) => {
  let i = 0;
  return () => bits[i++ % bits.length] as number;
};

/** A run of n photos, every edit accepted, P always arm B, Jim's answers given as the arm he preferred (or "T"). */
function judgedRun(prefs: Array<"A" | "B" | "T">): EvalRun {
  const r = newRun({ run: "20261029-153000", createdAt: "t", arms: { A: { intent: null, tone_mode: null }, B: { intent: "my_look", tone_mode: null } }, timeoutMin: 20, logDir: "l", photos: prefs.map((_, i) => ({ uuid: `u${i}`, filename: `f${i}`, start: {} })), coin: () => 1 });
  r.photos.forEach((p, i) => {
    p.edits = { P: ok, Q: ok };
    const pref = prefs[i];
    // left is P (arm B): "L" picks B, "R" picks A
    p.judged = { at: "t", left: "P", answer: pref === "T" ? "T" : pref === "B" ? "L" : "R", file: "f" };
  });
  r.masters = { at: "t", differing: Object.fromEntries(r.photos.map((p) => [p.uuid, []])) };
  return r;
}

describe("signTest", () => {
  it("gives the exact two-sided binomial p", () => {
    expect(signTest(13, 16)).toBeCloseTo(0.02127, 4);
    expect(signTest(12, 16)).toBeCloseTo(0.07681, 4);
    expect(signTest(3, 16)).toBeCloseTo(signTest(13, 16), 12);
    expect(signTest(3, 3)).toBeCloseTo(0.25, 12);
    expect(signTest(8, 16)).toBe(1);
    expect(signTest(0, 0)).toBe(1);
  });
  it("refuses impossible counts", () => {
    expect(() => signTest(5, 4)).toThrow(RangeError);
    expect(() => signTest(-1, 4)).toThrow(RangeError);
  });
});

describe("arms and sides", () => {
  it("draws P's arm per photo and gives Q the other", () => {
    expect(assignArms(4, cycle([0, 1, 1, 0]))).toEqual(["A", "B", "B", "A"]);
    expect(armOf({ p_arm: "B" }, "Q")).toBe("A");
    expect(armOf({ p_arm: "A" }, "P")).toBe("A");
    expect(pickLeft(() => 1)).toBe("Q");
  });
  it("uses both arms when drawn with node:crypto", () => {
    const arms = assignArms(64);
    expect(arms).toContain("A");
    expect(arms).toContain("B");
  });
  it("names copies neutrally", () => {
    expect(copyName("20261029-153000", "07", "Q")).toBe("AVG eval 20261029-153000 07 Q");
    expect(runId(new Date(2026, 9, 29, 15, 30, 5))).toBe("20261029-153005");
  });
});

describe("tally and headlines", () => {
  it("counts 13 of 16 as conclusive", () => {
    const r = judgedRun([...Array(13).fill("B"), "A", "A", "A", "T"]);
    expect(runSchema.parse(r)).toEqual(r);
    const t = tally(r);
    expect([t.b_wins, t.a_wins, t.ties, t.n]).toEqual([13, 3, 1, 16]);
    expect(t.conclusive).toBe(true);
    expect(headlines(r, t)).toEqual(["Looks eval: WORKED", "B won 13 of 16 (ties 1), p = 0.021", "conclusive: YES", "masters untouched: YES"]);
  });
  it("is not conclusive with fewer than 16 non-tie pairs, however one-sided", () => {
    const t = tally(judgedRun(Array(12).fill("B")));
    expect(t.p).toBeLessThan(0.05);
    expect(t.conclusive).toBe(false);
  });
  it("reads a right-hand answer as the copy on the right", () => {
    const r = judgedRun(["A"]);
    const p = r.photos[0]!;
    expect(winner(p)).toBe("A");
    p.judged = { ...p.judged!, left: "Q", answer: "R" };
    expect(winner(p)).toBe("B");
  });
  it("fails on an edit not accepted, a pair not judged or a changed master", () => {
    const r = judgedRun(["B", "B", "A", "B"]);
    r.photos[1]!.edits.Q = { ...ok, ended: null };
    r.photos[2]!.judged = null;
    r.masters!.differing["u3"] = ["exposure"];
    const h = headlines(r);
    expect(h[0]).toBe("Looks eval: FAILED (edits not accepted: 02 Q; pairs not judged: 03; masters untouched: NO)");
    expect(h[3]).toBe("masters untouched: NO");
  });
  it("says NOT CHECKED, not NO, when a master's read failed and none changed (run 20261030-055012)", () => {
    const r = judgedRun(["B", "B"]);
    r.masters!.differing["u1"] = ["not read: TIMEOUT"];
    expect(headlines(r)[3]).toBe("masters untouched: NOT CHECKED");
    r.masters!.differing["u2"] = ["exposure"];
    expect(headlines(r)[3]).toBe("masters untouched: NO");
  });
  it("keeps the arms hidden while an edit is not accepted, unless --judge or already revealed", () => {
    const r = judgedRun(["B", "A"]);
    expect(mayReveal(r, "resume")).toBe(true);
    r.photos[1]!.edits.P = { ...ok, timed_out: true };
    expect([mayReveal(r, "new"), mayReveal(r, "resume"), mayReveal(r, "judge")]).toEqual([false, false, true]);
    r.revealed_at = "t";
    expect(mayReveal(r, "resume")).toBe(true);
  });
});

describe("editPrompt", () => {
  it("names the copy and the intent, converge, accept", () => {
    const p = editPrompt("copy-uuid", { intent: "my_look", tone_mode: null });
    expect(p).toContain('uuid "copy-uuid"');
    expect(p).toContain('mode "converge" and intent_id "my_look"');
    expect(p).toContain('outcome "accept"');
    expect(p).not.toContain("tone_mode");
  });
  it("leaves the intent out for no intent and passes a tone mode as text", () => {
    const p = editPrompt("u", { intent: null, tone_mode: "adapt" });
    expect(p).toContain("no intent_id");
    expect(p).toContain('"tone_mode" argument, set it to "adapt"');
  });
});

describe("streamResult", () => {
  it("takes the last result line and skips cut-off lines", () => {
    const text = ['{"type":"system"}', '{"type":"result","subtype":"error_max_turns","is_error":true,"num_turns":2}', '{"type":"result","subtype":"success","is_error":false,"num_turns":31}', '{"type":"result","is_er'].join("\n");
    expect(streamResult(text)).toEqual({ is_error: false, turns: 31, subtype: "success" });
    expect(streamResult('{"type":"assistant"}')).toBeNull();
  });
});

describe("parseCli", () => {
  it("reads a new run with defaults", () => {
    expect(parseCli(["--b-intent", "my_look"])).toEqual({ mode: "new", armA: { intent: null, tone_mode: null }, armB: { intent: "my_look", tone_mode: null }, timeoutMin: 20 });
    expect(parseCli(["--b-intent", "x", "--b-tone", "adapt", "--a-intent", "none", "--timeout-min", "30"])).toMatchObject({ armB: { tone_mode: "adapt" }, armA: { intent: null }, timeoutMin: 30 });
  });
  it("reads resume, judge, cleanup and look-from", () => {
    expect(parseCli(["--resume", "20261029-153000"])).toEqual({ mode: "resume", run: "20261029-153000", timeoutMin: null });
    expect(parseCli(["--cleanup", "20261029-153000"]).mode).toBe("cleanup");
    expect(parseCli(["--judge", "last"])).toEqual({ mode: "judge", run: "last", timeoutMin: null });
    expect(lastRun(["20261029-153000", "_", "20261030-090000", "20261029-235959"])).toBe("20261030-090000");
    expect(lastRun(["x"])).toBeNull();
    expect(parseCli(["--look-from", "abc", "--look-id", "my_look"])).toEqual({ mode: "look", uuid: "abc", id: "my_look" });
  });
  it("refuses what it cannot read", () => {
    expect(() => parseCli([])).toThrow(/--b-intent/);
    expect(() => parseCli(["--judge", "../x"])).toThrow(/run id/);
    expect(() => parseCli(["--b-intent", "--b-tone"])).toThrow(/needs a value/);
    expect(() => parseCli(["--look-from", "abc"])).toThrow(/--look-id/);
    expect(() => parseCli(["--b-intent", "x", "--timeout-min", "0"])).toThrow(/1 to 120/);
  });
});

describe("look-from", () => {
  it("gives lr_save_intent the fields from_photo needs, and a summary", () => {
    expect(lookCandidate("my_look", "a.NEF")).toMatchObject({ id: "my_look", category: "look", priors: {} });
    const lines = lookSummary({ set: { exposure: 0.3, contrast: 10 }, profile: { raw: "Adobe Color", rendered: "Color" } }, { filename: "a.NEF", pipeline: "raw", captured: 2, left_out: "detail" });
    expect(lines[0]).toBe("Photo: a.NEF (raw), 2 settings captured.");
    expect(lines[2]).toBe("Settings: contrast, exposure.");
  });
});
