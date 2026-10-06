// The Phase 7 check's verdict (summary.ts): a line is YES only when every one of its checks is YES; a
// skipped check (one monitor) does not count; budgets over target, or not measured, fail the run.
import { describe, expect, it } from "vitest";
import { CHECKS, LINES, acceptance, freshState, pct, stateSchema, type State, type Timings } from "./summary.ts";

const GOOD: Timings = { cold_start: [600, 900], warm_show: [40, 60, 80], update_paint: [10, 20, 30], click_action: [5, 8] };
const sample = (cpu: number, mib = 110) => ({ window_ms: 60_000, private_mib: mib, cpu_pct: cpu, complete: true, procs: 6 });

function allYes(): State {
  const s = freshState("run", 0);
  for (const x of CHECKS) s.answers[x.id] = { ok: true, at: "t" };
  s.samples = { hidden: sample(0.2), visible: sample(1.1) };
  return s;
}

describe("phase7 check summary", () => {
  it("every 11.1 line but A20 has checks, and every check names a known line", () => {
    for (const l of LINES) expect(CHECKS.some((x) => x.line === l)).toBe(true);
    expect(LINES).not.toContain("A20");
    for (const x of CHECKS) expect([...LINES, "cleanup"]).toContain(x.line);
    expect(new Set(CHECKS.map((x) => x.id)).size).toBe(CHECKS.length);
  });

  it("all YES and budgets met: WORKED", () => {
    const a = acceptance(allYes(), GOOD);
    expect(a.worked).toBe(true);
    expect(a.headline).toBe("Phase 7 acceptance: WORKED");
  });

  it("one NO fails its line; a missing answer is NOT RUN", () => {
    const s = allYes();
    s.answers["A13.back"] = { ok: false, at: "t" };
    delete s.answers["A21.jim"];
    const a = acceptance(s, GOOD);
    expect(a.worked).toBe(false);
    expect(a.lines.find((l) => l.line === "A13")).toMatchObject({ result: "NO", failed: ["A13.back"] });
    expect(a.lines.find((l) => l.line === "A21")).toMatchObject({ result: "NOT RUN", missing: ["A21.jim"] });
  });

  it("a skipped check does not count; a null answer without a reason is NOT RUN", () => {
    const s = allYes();
    s.answers["A9.f2.jim"] = { ok: null, at: "t", skipped: "one monitor connected" };
    expect(acceptance(s, GOOD).worked).toBe(true);
    s.answers["A9.f2.jim"] = { ok: null, at: "t" };
    expect(acceptance(s, GOOD).lines.find((l) => l.line === "A9")?.result).toBe("NOT RUN");
  });

  it("a failed put-back fails the cleanup line", () => {
    const s = allYes();
    s.answers["back.E2"] = { ok: false, at: "t", detail: { differing: ["exposure"] } };
    expect(acceptance(s, GOOD).lines.find((l) => l.line === "cleanup")?.result).toBe("NO");
  });

  it("budgets: not measured and an incomplete sample fail; over target is named, for Jim's verdict", () => {
    const over = acceptance(allYes(), { ...GOOD, update_paint: [10, 20, 120] });
    expect(over.worked).toBe(true);
    expect(over.headline).toBe("Phase 7 acceptance: WORKED; over budget: update_paint");
    expect(acceptance(allYes(), { ...GOOD, click_action: [] }).headline).toContain("click_action NOT MEASURED");
    const s = allYes();
    s.samples.hidden = { ...sample(0.2), complete: false };
    expect(acceptance(s, GOOD).headline).toContain("memory INCOMPLETE");
    s.samples.hidden = sample(0.2, 160);
    expect(acceptance(s, GOOD).headline).toContain("over budget: memory");
  });

  it("a step's error fails the run until the step finishes", () => {
    const s = allYes();
    s.errors["E3"] = "boom";
    expect(acceptance(s, GOOD).headline).toContain("E3 error");
  });

  it("pct is nearest-rank", () => {
    expect(pct([], 95)).toBeNull();
    expect(pct([5], 95)).toBe(5);
    expect(pct(Array.from({ length: 20 }, (_, i) => i + 1), 95)).toBe(19);
  });

  it("the state schema takes a fresh state and refuses unknown fields", () => {
    expect(stateSchema.parse(freshState("r", 1))).toEqual(freshState("r", 1));
    expect(() => stateSchema.parse({ ...freshState("r", 1), extra: 1 })).toThrow();
  });
});
