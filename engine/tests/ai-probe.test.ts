// `npm run ai:probe`'s runs (src/devtools/ai-probe.ts; issue #123) against the simulated Lightroom
// (helpers/lightroom-sim-masks.ts): a mask that computes, the 2026-10-11 shape (the update over, the gate
// free, no result), and the run without reads, which reads only once the update is over. Issue #181: the options
// (--kind, --repeat, --sky-first), the runs of one kind after a Sky mask, and the summary of the runs.

import { describe, expect, it } from "vitest";
import { PROBE_TIMINGS, RUNS, runOne, type RunSpec } from "../src/devtools/ai-probe.js";
import { parseArgs, photoQuestions, plan, summarize, summaryLine, type Options } from "../src/devtools/ai-probe-plan.js";
import { client, lr, plugin, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

const FAST = { ...PROBE_TIMINGS, limitMs: 400, pollMs: 5, pollMaxMs: 10, probeFromMs: 20, probeEveryMs: 10, probeReplyMs: 50, readsAfterMs: 20, noResultShotMs: 50 };
const spec = (id: string): RunSpec => RUNS.find((r) => r.id === id) as RunSpec;
const run = (id: string, shots: string[] = []) => runOne({ client, uuid: lr.uuid, shot: (label) => (shots.push(label), `${label}.png`), say: () => undefined, timings: FAST }, spec(id));
const sent = (name: string): number => plugin.received.filter((r) => r.name === name).length;

describe("ai:probe runs", () => {
  it("a mask that computes ends the run with its result, the update's answer first", async () => {
    const r = await run("mountains_reads");
    expect(r.outcome).toBe("computed");
    expect(r.events[0]).toMatchObject({ what: "update", result: expect.stringMatching(/^started/) });
    expect(lr.writes.at(-1)?.name).toBe("AVG ai-probe mountains_reads");
  });

  it("the 2026-10-11 shape: the update over, the gate free, no result: probes stop, reads go on, a screenshot, then the time limit", async () => {
    lr.masks.tableRoute = "never";
    const shots: string[] = [];
    const r = await run("vegetation_reads", shots);
    expect(r.outcome).toBe("no result within 0.4 s");
    expect(r.settled_ms).not.toBeNull();
    expect(r.events.filter((e) => e.what === "probe")).toHaveLength(1);
    expect(r.events.filter((e) => e.what === "read" && e.t_ms > (r.settled_ms ?? 0)).length).toBeGreaterThan(1);
    expect(shots).toEqual(["vegetation_reads_no_result"]);
  });

  it("without reads: no get_settings until the update is over and the gate free", async () => {
    lr.masks.tableRoute = "never";
    const before = sent("get_settings");
    const r = await run("vegetation_no_reads");
    const firstRead = r.events.find((e) => e.what === "read");
    expect(firstRead?.t_ms).toBeGreaterThanOrEqual(r.settled_ms ?? Infinity);
    expect(sent("get_settings") - before).toBe(1 + r.events.filter((e) => e.what === "read").length); // the table read before the write
  });

  it("a dialog holding the gate: the first busy probe takes a screenshot", async () => {
    [lr.masks.gate, lr.masks.heldProbes] = ["dialog", 3];
    const shots: string[] = [];
    const r = await run("vegetation_reads", shots);
    expect(r.first_busy_ms).not.toBeNull();
    expect(shots[0]).toBe("vegetation_reads_gate_busy");
  });
});

describe("ai:probe options (issue #181)", () => {
  it("--kind, --repeat and --sky-first make n runs of one kind; no options make the three runs of issue #123", () => {
    expect(plan(parseArgs([]) as Options)).toEqual(RUNS);
    const o = parseArgs(["--new", "--kind", "landscape_water", "--repeat", "3", "--sky-first"]) as Options;
    expect(o).toEqual({ kind: "landscape_water", repeat: 3, skyFirst: true, fresh: true });
    const specs = plan(o);
    expect(specs.map((s) => s.id)).toEqual(["landscape_water_01", "landscape_water_02", "landscape_water_03"]);
    expect(specs[0]).toMatchObject({ kind: "landscape_water", reads: true, skyFirst: true, waitMs: 300_000, sliders: { "local.whites": 25, "local.dehaze": 6 } });
    expect(plan(parseArgs(["--kind", "sky"]) as Options)[0]).not.toHaveProperty("skyFirst");
  });

  it("refuses what it cannot run, saying what is wrong", () => {
    expect(parseArgs(["--kind", "no_such_kind"])).toMatch(/^--kind needs one of: .*landscape_water/);
    expect(parseArgs(["--kind", "person_hair"])).toMatch(/^--kind needs one of/); // a kind that needs a point on the photo
    expect(parseArgs(["--kind", "sky", "--repeat", "0"])).toMatch(/^--repeat needs a whole number/);
    expect(parseArgs(["--kind", "sky", "--repeat", "x"])).toMatch(/^--repeat needs a whole number/);
    expect(parseArgs(["--repeat", "5"])).toBe("--repeat and --sky-first need --kind");
    expect(parseArgs(["--sky-first"])).toBe("--repeat and --sky-first need --kind");
    expect(parseArgs(["--bogus"])).toBe("unknown option --bogus");
  });

  it("asks about the photo what the kind needs", () => {
    expect(photoQuestions(parseArgs([]) as Options, "a.dng")).toEqual(["The probe runs on a.dng. Does it show trees, shrubs or grass?"]);
    expect(photoQuestions(parseArgs(["--kind", "landscape_water", "--sky-first"]) as Options, "a.dng")).toEqual(["The probe runs on a.dng. Does it show water?", "Does it show sky?"]);
  });

  it("sums up the runs: completed, stuck (no result in time, a Sky mask's too), other, and the median and largest time", () => {
    const runs = [
      { outcome: "computed", t_ms: 6000 },
      { outcome: "computed", t_ms: 8000 },
      { outcome: "computed", t_ms: 7000 },
      { outcome: "no result within 300 s", t_ms: 300_400 },
      { outcome: "sky first: no result within 300 s", t_ms: 300_100 },
      { outcome: "ErrorReason 1", t_ms: 900 },
    ];
    const s = summarize(runs);
    expect(s).toEqual({ runs: 6, completed: 3, stuck: 2, other: 1, median_ms: 7500, max_ms: 300_400, completed_median_ms: 7000, completed_max_ms: 8000 });
    expect(summaryLine(s)).toBe("6 runs: 3 completed, 2 stuck (no result in time), 1 other; all runs median 7500 ms, max 300400 ms; completed runs median 7000 ms, max 8000 ms");
    expect(summaryLine(summarize([]))).toBe("0 runs: 0 completed, 0 stuck (no result in time), 0 other; all runs median none, max none; completed runs median none, max none");
  });
});

describe("ai:probe runs of one kind, after a Sky mask (issue #181)", () => {
  const water = (extra: Partial<RunSpec> = {}): RunSpec => ({ id: "landscape_water_01", kind: "landscape_water", reads: true, ...extra });
  const go = (s: RunSpec) => runOne({ client, uuid: lr.uuid, shot: (label) => `${label}.png`, say: () => undefined, timings: FAST }, s);

  it("a Sky mask first: made and computed, then the run; both times are in the result", async () => {
    const r = await go(water({ skyFirst: true }));
    expect(r).toMatchObject({ run: "landscape_water_01", kind: "landscape_water", outcome: "computed", sky_first_ms: expect.any(Number) });
    expect(sent("update_ai_settings")).toBe(2);
    expect(lr.writes.map((w) => w.name)).toEqual(expect.arrayContaining(["AVG ai-probe landscape_water_01_sky", "AVG ai-probe landscape_water_01"]));
  });

  it("without --sky-first there is one update and no Sky time", async () => {
    const r = await go(water());
    expect(r.outcome).toBe("computed");
    expect(r).not.toHaveProperty("sky_first_ms");
    expect(sent("update_ai_settings")).toBe(1);
  });

  it("a Sky mask that gets no result ends the run: the result says so, with the Sky's time, and the Water mask is not asked for", async () => {
    lr.masks.tableRoute = "never";
    const r = await go(water({ skyFirst: true }));
    expect(r.outcome).toBe("sky first: no result within 0.4 s");
    expect(r).toMatchObject({ run: "landscape_water_01", kind: "landscape_water", sky_first_ms: expect.any(Number) });
    expect(sent("update_ai_settings")).toBe(1);
  });

  it("a run waits as long as its waitMs says, not the timings' limit", async () => {
    lr.masks.tableRoute = "never";
    const r = await go(water({ waitMs: 150 }));
    expect(r.outcome).toBe("no result within 0.15 s");
    expect(r.t_ms).toBeLessThan(400);
  });
});
