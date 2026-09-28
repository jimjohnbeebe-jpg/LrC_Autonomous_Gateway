// lr_sync_series' parameter groups (src/sync/mask.ts).

import { describe, expect, it } from "vitest";
import { loadDefaultParamMap } from "../src/params/index.js";
import { MASK_GROUPS, applyMask, groupOf } from "../src/sync/index.js";

const map = loadDefaultParamMap();

describe("sync: parameter_mask groups", () => {
  it("puts every canonical name in one group", () => {
    const unplaced = map.names().filter((n) => groupOf(n) === null);
    expect(unplaced).toEqual([]);
    const sizes = Object.fromEntries(MASK_GROUPS.map((g) => [g, map.names().filter((n) => groupOf(n) === g).length]));
    expect(sizes).toEqual({ basic_tone: 11, white_balance: 2, tone_curve: 4, hsl: 24, grading: 14, detail: 6, lens: 3, camera_profile: 1 });
  });

  it("places the names MCP_TOOLS' groups stand for", () => {
    expect(["exposure", "dehaze", "temperature", "tone_curve.red", "hsl.aqua.lum", "grading.balance", "noise.color", "lens.ca_remove", "camera_profile"].map(groupOf)).toEqual([
      "basic_tone",
      "basic_tone",
      "white_balance",
      "tone_curve",
      "hsl",
      "grading",
      "detail",
      "lens",
      "camera_profile",
    ]);
    expect(groupOf("no.such")).toBeNull();
  });

  it("copies only the groups asked for, less the names excluded, and lists the rest", () => {
    const source = { exposure: 0.5, contrast: 10, temperature: 5200, "hsl.red.sat": -5, camera_profile: "Adobe Color", "no.such": 1 };
    expect(applyMask(source, ["basic_tone", "hsl"], ["exposure"])).toEqual({
      copied: { contrast: 10, "hsl.red.sat": -5 },
      left: ["camera_profile", "exposure", "no.such", "temperature"],
    });
    expect(applyMask(source, MASK_GROUPS).copied).toEqual({ exposure: 0.5, contrast: 10, temperature: 5200, "hsl.red.sat": -5, camera_profile: "Adobe Color" });
  });
});
