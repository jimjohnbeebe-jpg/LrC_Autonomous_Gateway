// GitHub issue #181: what the wait for an AI mask shows and records while Lightroom computes (src/session/ai-update.ts,
// ai-verdict.ts, ai-trace.ts): the HUD's note with the time waited ("m:ss"), changed at most once every noteEveryMs (a second);
// and the trace's probes, the first 20 and the last 20, so that the end of a long wait is on the log.

import { describe, expect, it } from "vitest";
import { DIALOG_NOTE, STILL_NOTE, WORKING_NOTE } from "../src/session/ai-update.js";
import { clock, elapsedNote } from "../src/session/ai-verdict.js";
import { newTrace, noteProbe } from "../src/session/ai-trace.js";
import type { HudSink } from "../src/session/index.js";
import { ID, clean, fails, lr, newManager, readLog, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

const FAST = { computeMs: 300, dcWaitMs: 300, pollMs: 5, pollMaxMs: 10, dialogAfterMs: 30, probeEveryMs: 10, probeReplyMs: 50, stuckProbesMs: 10_000 };

describe("the time on the HUD's note", () => {
  it("is m:ss, the minutes not capped", () => {
    expect([0, 999, 1000, 59_999, 60_000, 125_000, 4_500_000].map(clock)).toEqual(["0:00", "0:00", "0:01", "0:59", "1:00", "2:05", "75:00"]);
  });

  it("goes after the note and fits the HUD's 120 bytes, whatever the time", () => {
    expect(elapsedNote(STILL_NOTE, 127_000)).toBe("Lightroom's AI mask is still computing (2:07)");
    for (const note of [STILL_NOTE, DIALOG_NOTE, WORKING_NOTE]) expect(Buffer.byteLength(elapsedNote(note, 4_500_000))).toBeLessThanOrEqual(120);
  });
});

async function stuckWith(timings: Record<string, number>, hold: boolean): Promise<string[]> {
  clean();
  const notes: string[] = [];
  const hud: HudSink = { stage: (s, stage, o) => void notes.push(`${stage}: ${o?.note ?? s.work?.note ?? ""}`), settle: async () => undefined };
  const m = newManager({ hud, aiTimings: { ...FAST, ...timings } });
  await m.begin({ intent_id: "test_plain", return_image: "none", max_passes: 4 });
  if (hold) [lr.masks.gate, lr.masks.heldProbes] = ["dialog", 1_000_000];
  else lr.masks.tableRoute = "never";
  await fails(m.createMask({ session_id: ID, rationale: "test", return_image: "none", kind: "sky" }));
  return notes;
}

describe("the HUD's note while the engine waits for an AI mask", () => {
  it("shows the time waited from dialogAfterMs on, at most once every noteEveryMs", async () => {
    const t0 = performance.now();
    const notes = await stuckWith({ noteEveryMs: 60 }, false);
    const waited = performance.now() - t0;
    const timed = notes.filter((n) => n === `applying: ${STILL_NOTE} (0:00)`);
    expect(notes).toContain(`applying: ${WORKING_NOTE}`);
    expect(timed.length).toBeGreaterThanOrEqual(1); // a loaded machine may stretch the loop; the bound that matters is the upper one
    expect(timed.length).toBeLessThanOrEqual(Math.ceil(waited / 60));
  });

  it("with the default noteEveryMs, a wait of less than a second changes it not at all", async () => {
    const notes = await stuckWith({}, false);
    expect(notes.filter((n) => /\(\d+:\d\d\)$/.test(n))).toEqual([]);
  });

  it("keeps the dialog note and adds the time to it while the gate is held", async () => {
    const notes = await stuckWith({ noteEveryMs: 60 }, true);
    expect(notes).toContain(`applying: ${DIALOG_NOTE}`);
    expect(notes.filter((n) => n === `applying: ${DIALOG_NOTE} (0:00)`).length).toBeGreaterThanOrEqual(1);
  });
});

describe("the trace's probes", () => {
  it("keep the first 20 and the last 20 and count the rest", () => {
    const trace = newTrace("landscape_water");
    for (let i = 0; i < 100; i++) noteProbe(trace, null, null, performance.now(), `p${i}`);
    const kept = trace.probes.map((p) => p.status);
    expect(kept).toHaveLength(40);
    expect(kept.slice(0, 20)).toEqual(Array.from({ length: 20 }, (_, i) => `p${i}`));
    expect(kept.slice(20)).toEqual(Array.from({ length: 20 }, (_, i) => `p${80 + i}`));
    expect(trace.probes_dropped).toBe(60);
  });

  it("drop nothing up to 40", () => {
    const trace = newTrace("sky");
    for (let i = 0; i < 40; i++) noteProbe(trace, null, null, performance.now(), `p${i}`);
    expect(trace.probes).toHaveLength(40);
    expect(trace.probes_dropped).toBe(0);
  });

  it("end the log's trace at the end of a long wait (the 2026-10-18 hang's end was not recorded)", async () => {
    clean();
    const m = newManager({ aiTimings: { ...FAST, computeMs: 1500, probeEveryMs: 2 } });
    await m.begin({ intent_id: "test_plain", return_image: "none", max_passes: 4 });
    [lr.masks.gate, lr.masks.heldProbes] = ["dialog", 1_000_000];
    await fails(m.createMask({ session_id: ID, rationale: "test", return_image: "none", kind: "landscape_water" }));
    const trace = readLog().failures.at(-1)?.ai_trace;
    expect(trace?.probes).toHaveLength(40);
    expect(trace?.probes_dropped).toBeGreaterThan(0);
    const [first, last] = [trace?.probes[0]?.t_ms ?? 0, trace?.probes.at(-1)?.t_ms ?? 0];
    expect(last).toBeGreaterThan(first + 500);
    expect(trace?.reads.last_t_ms ?? 0).toBeLessThan(last + 100); // the last probe is of the end of the wait
  });
});
