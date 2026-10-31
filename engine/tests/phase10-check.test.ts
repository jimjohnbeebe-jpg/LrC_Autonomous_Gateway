// The pure parts of npm run phase10:check (src/devtools/phase10-check.ts): a look's set reproduced on another photo
// within Lightroom's rounding, and the check's lines and headline.

import { describe, expect, it } from "vitest";
import { notReproduced, verdictLines } from "../src/devtools/phase10-check.js";
import { loadDefaultParamMap } from "../src/params/index.js";

const map = loadDefaultParamMap();

describe("phase10:check", () => {
  it("counts a set value as reproduced within 1 % of the slider's range, and an array only when equal", () => {
    const set = { exposure: 0.35, contrast: 12, "tone_curve.points": [0, 0, 255, 255] };
    expect(notReproduced(set, { exposure: 0.4, contrast: 12, "tone_curve.points": [0, 0, 255, 255] }, map, "raw")).toEqual([]);
    expect(notReproduced(set, { exposure: 0.6, contrast: 12 }, map, "raw")).toEqual([
      { name: "exposure", look: 0.35, photo: 0.6 },
      { name: "tone_curve.points", look: [0, 0, 255, 255], photo: null },
    ]);
  });

  it("is WORKED only when every step is as expected and every answer asked is y", () => {
    const good = [{ step: "a", expect: ["ok"], statuses: ["ok"] }];
    expect(verdictLines(good, ["y", "y"], 2)).toMatchObject({ worked: true, lines: ["YES a: ok (expected ok)", "YES Jim's answer 1: y", "YES Jim's answer 2: y"] });
    expect(verdictLines(good, ["y"], 2).worked).toBe(false);
    expect(verdictLines(good, ["y", "n"], 2).worked).toBe(false);
    expect(verdictLines([{ step: "a", expect: ["ok"], statuses: [], error: "boom" }], ["y", "y"], 2).lines[0]).toBe("NO  a: boom (expected ok)");
  });
});
