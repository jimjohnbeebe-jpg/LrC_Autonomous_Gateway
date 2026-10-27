// The pure parts of npm run stats:check (src/devtools/stats-check.ts, issue #216): when a fast preview caught
// up with a change, and the verdict's lines.

import { describe, expect, it } from "vitest";
import { MS_PER_PHOTO, caughtUpAt, verdict, type Sample } from "../src/devtools/stats-check.js";

const s = (at_ms: number, luma_mean: number, source = "thumbnail"): Sample => ({ at_ms, source, luma_mean, ms: 50 });

describe("stats:check", () => {
  it("finds the first thumbnail that moved most of the way the export moved, either direction", () => {
    expect(caughtUpAt([s(0, 100), s(500, 110), s(2000, 118)], 100, 90, 110)).toEqual({ at_ms: 2000 });
    expect(caughtUpAt([s(0, 100), s(1000, 84, "export"), s(3500, 84)], 100, 100, 80)).toEqual({ at_ms: 3500 });
    expect(caughtUpAt([s(0, 100)], 100, 100, 120).at_ms).toBeNull();
    expect(caughtUpAt([s(0, 130)], 100, 100, 100.5).why).toContain("too little");
  });

  it("is WORKED only with every photo measured within budget, a thumbnail, the photo back and a y", () => {
    const good = { photos: 20, measured: 20, total_ms: 20 * MS_PER_PHOTO, thumbnails: 3, fast_tries: 3, put_back: true, answer: "y" };
    expect(verdict(good).worked).toBe(true);
    expect(verdict({ ...good, total_ms: 20 * MS_PER_PHOTO + 1 }).worked).toBe(false);
    expect(verdict({ ...good, measured: 19 }).worked).toBe(false);
    expect(verdict({ ...good, put_back: null, answer: null }).lines.filter((l) => l.startsWith("NO "))).toHaveLength(2);
  });
});
