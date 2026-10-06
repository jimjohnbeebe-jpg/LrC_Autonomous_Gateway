// The Phase 7 check's timings from the Deck's log lines (budgets.ts timingsFrom): the cold start from
// the process's creation to its first paint, the warm show only for a hidden Deck's new edit, update
// to paint only while shown, and click to the engine's receipt by click id.
import { describe, expect, it } from "vitest";
import { sampleTree, timingsFrom, type PidEvent } from "./budgets.ts";

const ui = (t: number, line: Record<string, unknown>, pid = 1): PidEvent => ({ ev: "ui", t, line, pid });
const ev = (t: number, name: string, pid = 1): PidEvent => ({ ev: name, t, pid });

const LOG: PidEvent[] = [
  ui(1500, { got: 1, session: "s1", stage: "begin", at: 1490 }),
  ev(1520, "show"),
  ui(1530, { painted: 1, at: 1525 }),
  ui(2000, { got: 2, session: "s1", stage: "awaiting_claude", at: 2000 }),
  ui(2020, { painted: 2, at: 2015 }),
  ui(2101, { click: "hud_accept", click_id: "c1", at: 2100 }),
  ev(3000, "hide"),
  ui(5000, { got: 1, session: "s2", stage: "begin", at: 5000 }),
  ev(5040, "show"),
  ui(5046, { painted: 1, at: 5045 }),
  ui(5100, { got: 2, session: "s2", stage: "awaiting_claude", at: 5100 }),
  ui(5131, { painted: 2, at: 5130 }),
  ev(6000, "hide"),
  ui(6100, { got: 3, session: "s2", stage: "aborted", at: 6100 }),
  ui(6151, { painted: 3, at: 6150 }),
];

describe("phase7 check samples", () => {
  it("a Deck process that is not there gives an incomplete sample, not a zero that passes", async () => {
    const s = await sampleTree(2_000_000_000, 20);
    expect(s.complete).toBe(false);
    expect(s.procs).toBe(0);
  });

  it("a process that is there gives a complete sample", async () => {
    const s = await sampleTree(process.pid, 20);
    expect(s.complete).toBe(true);
    expect(s.private_mib).toBeGreaterThan(0);
  });
});

describe("phase7 check timings", () => {
  it("measures each budget from its own start and stop", () => {
    const t = timingsFrom(LOG, [{ pid: 1, created: 1000 }], new Map([["c1", 2110]]));
    expect(t).toEqual({ cold_start: [525], warm_show: [40], update_paint: [15, 30], click_action: [10] });
  });

  it("a Deck that was already running has no cold start; an unknown click id has no number", () => {
    const t = timingsFrom(LOG, [{ pid: 2, created: 1000 }], new Map([["other", 2110]]));
    expect(t.cold_start).toEqual([]);
    expect(t.click_action).toEqual([]);
  });

  it("keeps processes apart", () => {
    const two = [...LOG, ...LOG.map((e) => ({ ...e, pid: 2, t: e.t + 100_000, ...(e.ev === "ui" ? { line: { ...(e["line"] as object), at: Number((e["line"] as { at?: number }).at) + 100_000 } } : {}) }))];
    const t = timingsFrom(two, [{ pid: 1, created: 1000 }, { pid: 2, created: 101_000 }], new Map());
    expect(t.cold_start).toEqual([525, 525]);
    expect(t.warm_show).toEqual([40, 40]);
  });
});
