// The pure parts of npm run clip:res (src/devtools/clip-res-check.ts, issue #168): medians, ratios to the
// 1600 px render, the clip difference, the worst-case step estimate and the verdict.

import { describe, expect, it } from "vitest";
import { EDGES, RENDERS_PER_STEP, RUNS, summarize, verdict, type Sample } from "../src/devtools/clip-res-check.js";
import { MAX_CORRECTIONS } from "../src/session/index.js";

const s = (edge: number, total_ms: number, clip_high_tone_pct = 0, clip_low_pct = 0): Sample => ({
  width: edge,
  height: Math.round(edge / 1.5),
  export_ms: total_ms - 100,
  command_ms: total_ms - 50,
  file_ms: 10,
  metrics_ms: 30,
  total_ms,
  clip_high_pct: clip_high_tone_pct,
  clip_high_tone_pct,
  clip_low_pct,
});

const full = (): Array<{ edge: number; samples: Sample[] }> => [
  { edge: 1600, samples: [s(1600, 2600), s(1600, 3000, 0.1), s(1600, 2500)] },
  { edge: 2560, samples: [s(2560, 3100), s(2560, 2900), s(2560, 9000)] },
  { edge: 4096, samples: [s(4096, 4000, 0.5, 0.2), s(4096, 3800, 0.5, 0.2), s(4096, 4100, 0.5, 0.2)] },
];

describe("clip:res", () => {
  it("takes nearest-rank medians, ratios and clip differences against the 1600 px render", () => {
    const [base, mid, top] = summarize(full());
    expect(base?.median.total_ms).toBe(2600);
    expect(mid?.median.total_ms).toBe(3100); // the 9 s outlier does not move the median
    expect(top?.median.export_ms).toBe(3900);
    expect(top?.total_x).toBe(1.54);
    expect(base?.total_x).toBe(1);
    expect(top?.clip_high_tone_vs_base).toBe(0.5);
    expect(top?.clip_low_vs_base).toBe(0.2);
    expect(top?.measured_long_edge).toBe(4096);
  });

  it("estimates the worst-case step as its render, every guardrail re-render and the undo render", () => {
    expect(RENDERS_PER_STEP).toBe(2 + MAX_CORRECTIONS);
    expect(summarize(full())[2]?.worst_step_ms).toBe(RENDERS_PER_STEP * 4000);
  });

  it("is WORKED only when every edge got every render", () => {
    expect(verdict(summarize(full())).worked).toBe(true);
    expect(verdict(summarize(full())).lines).toHaveLength(EDGES.length);
    const failed = full();
    failed[2]!.samples[1] = { error: "export_failed" };
    const v = verdict(summarize(failed));
    expect(v.worked).toBe(false);
    expect(v.lines[2]).toMatch(/^NO .*2 of 3/);
    expect(verdict(summarize(full().slice(0, 2))).lines[2]).toBe("NO  4096 px: not reached");
    const short = full();
    short[1]!.samples.pop();
    expect(short[1]!.samples).toHaveLength(RUNS - 1);
    expect(verdict(summarize(short)).worked).toBe(false);
  });

  it("says when Lightroom exported a smaller photo than asked", () => {
    const small = full();
    small[2]!.samples = small[2]!.samples.map(() => s(3000, 3500));
    expect(verdict(summarize(small)).lines[2]).toContain("Lightroom exported 3000 px");
  });
});
