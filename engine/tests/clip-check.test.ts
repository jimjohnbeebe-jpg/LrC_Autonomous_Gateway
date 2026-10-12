// AC-4 counted on every session (src/devtools/clip-check.ts, PHASE4_PLAN decision 1): the unit
// rules, a missing or invalid log, and the Phase 3 run's own session logs, where it must find the
// three passes of PHASE3.md's AC-4 table and no other.

import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { clipCheck, clipCheckAll, clipCheckFile, describeClip } from "../src/devtools/clip-check.js";

const P3 = fileURLToPath(new URL("../../docs/reports/phase3/P3/", import.meta.url));
const SESSIONS = path.join(P3, "p3_sessions_2026-09-27T14-00-37-507Z");

describe("devtools: AC-4 on every session", () => {
  it("checks every pass against the session's limits", () => {
    const pass = (n: number, high: number, low: number) => ({ n, metrics_after: { clip_high_pct: high, clip_low_pct: low } });
    const log = { guardrails: { clip_high_pct: 0.5, clip_low_pct: 1 }, passes: [pass(0, 0.5, 1), pass(1, 0.6, 0)] } as unknown as Parameters<typeof clipCheck>[0];
    expect(clipCheck(log)).toEqual({ ok: false, passes: [{ n: 0, clip_high_pct: 0.5, clip_low_pct: 1, ok: true }, { n: 1, clip_high_pct: 0.6, clip_low_pct: 0, ok: false }] });
  });

  it("without clip_baseline fails only an end a pass pushed over; with it, every pass over a limit (issue #130)", () => {
    const pass = (n: number, before: [number, number], after: [number, number]) => ({
      n,
      metrics_before: { clip_high_pct: before[0], clip_low_pct: before[1] },
      metrics_after: { clip_high_pct: after[0], clip_low_pct: after[1] },
    });
    const passes = [pass(0, [2, 0], [2, 0]), pass(1, [2, 0], [2.5, 0.5])]; // high over before and after: left alone
    const log = (clip_baseline: boolean | undefined, extra: unknown[] = []) =>
      ({ guardrails: { clip_high_pct: 0.5, clip_low_pct: 1 }, ...(clip_baseline === undefined ? {} : { clip_baseline }), passes: [...passes, ...extra] }) as unknown as Parameters<typeof clipCheck>[0];
    expect(clipCheck(log(false)).ok).toBe(true);
    const pushed = clipCheck(log(false, [pass(2, [2.5, 0.5], [2.5, 1.5])])); // low within before, over after
    expect(pushed.passes.map((p) => p.ok)).toEqual([true, true, false]);
    expect(clipCheck(log(true)).passes.map((p) => p.ok)).toEqual([false, false]);
    expect(clipCheck(log(undefined)).ok).toBe(false); // a log from before issue #130: the baseline ran
  });

  it("without clip_baseline exempts pass 0, which corrects nothing; from pass 1 an end pushed over fails (issue #130)", () => {
    const pass = (n: number, before: number, after: number, target?: string) => ({
      n,
      ...(target ? { target } : {}),
      metrics_before: { clip_high_pct: before, clip_low_pct: 0 },
      metrics_after: { clip_high_pct: after, clip_low_pct: 0 },
    });
    const log = (clip_baseline: boolean, passes: unknown[]) => ({ guardrails: { clip_high_pct: 0.5, clip_low_pct: 1 }, clip_baseline, passes }) as unknown as Parameters<typeof clipCheck>[0];
    const pass0 = [pass(0, 0.2, 2), pass(0, 0.2, 3, "C")]; // the priors push the high end over on the master and on copy C
    expect(clipCheck(log(false, pass0)).passes.map((p) => p.ok)).toEqual([true, true]);
    expect(clipCheck(log(false, [...pass0, pass(1, 0.2, 2)])).passes.map((p) => p.ok)).toEqual([true, true, false]);
    expect(clipCheck(log(true, pass0)).passes.map((p) => p.ok)).toEqual([false, false]);
  });

  it("fails a log with no pass: nothing was measured (Greptile, PR #27)", () => {
    const log = { guardrails: { clip_high_pct: 0.5, clip_low_pct: 1 }, passes: [] } as unknown as Parameters<typeof clipCheck>[0];
    expect(clipCheck(log)).toEqual({ ok: false, passes: [] });
  });

  it("fails a session whose log is missing or not a session log, and needs at least one session", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-clip-"));
    try {
      const bad = path.join(tmp, "bad.json");
      writeFileSync(bad, JSON.stringify({ passes: [] }), "utf8");
      const missing = clipCheckFile("B", path.join(tmp, "none.json"));
      const invalid = clipCheckFile("chat", bad);
      expect(missing).toMatchObject({ session: "B", ok: false, passes: [], error: expect.stringMatching(/^cannot read the session log/) });
      expect(invalid).toMatchObject({ session: "chat", ok: false, error: expect.stringMatching(/^not a valid session log/) });
      expect(describeClip(clipCheckAll([missing, invalid]))).toMatch(/^NO \(session B: cannot read .*; session chat: not a valid session log/);
      expect(clipCheckAll([])).toMatchObject({ ok: false, sessions: [], over: [] });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("finds, in the Phase 3 run's twelve session logs and the chat's, exactly the passes of PHASE3.md's AC-4 table", () => {
    const logs = readdirSync(SESSIONS).filter((f) => f.endsWith(".json") && !f.endsWith(".recipe.json")).sort();
    expect(logs).toHaveLength(12);
    const sessions = [
      ...logs.map((f) => clipCheckFile(f.replace(/\.json$/, ""), path.join(SESSIONS, f))),
      clipCheckFile("chat", path.join(P3, "p3_chat_session", "20260927-d096a8.json")),
    ];
    expect(sessions.filter((s) => s.error)).toEqual([]);
    const summary = clipCheckAll(sessions);
    expect(summary.ok).toBe(false);
    // [handle: docs\reports\phase3\PHASE3.md "AC-4, what happened": A (…c92f59) pass 0 2.2294 %;
    // B (…b9d5c7) pass 0 5.5416 % and pass 1 1.1604 %, all shadow crush on 20260907-_OZ80099.NEF]
    expect(summary.over.map((p) => [p.session, p.n, p.clip_low_pct])).toEqual([
      ["20260927-b9d5c7", 0, 5.5416],
      ["20260927-b9d5c7", 1, 1.1604],
      ["20260927-c92f59", 0, 2.2294],
    ]);
    expect(sessions.find((s) => s.session === "chat")?.ok).toBe(true);
  });
});
