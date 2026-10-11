// `npm run ai:probe`'s runs (src/devtools/ai-probe.ts; issue #123) against the simulated Lightroom
// (helpers/lightroom-sim-masks.ts): a mask that computes, the 2026-10-11 shape (the update over, the gate
// free, no result), and the run without reads, which reads only once the update is over.

import { describe, expect, it } from "vitest";
import { PROBE_TIMINGS, RUNS, runOne, type RunSpec } from "../src/devtools/ai-probe.js";
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
