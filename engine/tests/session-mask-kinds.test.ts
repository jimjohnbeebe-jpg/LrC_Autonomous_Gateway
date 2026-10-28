// Colour range, depth range and brush masks inside a session (src/session/masks.ts; issue #190) against the
// simulated Lightroom, whose tonal render is grey on top and orange below (tests/helpers/lightroom-sim.ts).

import { describe, expect, it } from "vitest";
import { MASK_TABLE_KEY, type Correction } from "../src/params/index.js";
import { ID, SHORT, clean, fails, lr, manager, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

const begin = () => manager.begin({ max_passes: 4, intent_id: "test_plain", return_image: "none" });
const masks = (): Correction[] => (lr.settings[MASK_TABLE_KEY] ?? []) as Correction[];
const create = (args: Record<string, unknown>) => manager.createMask({ session_id: ID, rationale: "test", return_image: "none", kind: "linear", ...args });
const holder = (e: Correction | undefined): Record<string, unknown> => ((e?.["CorrectionMasks"] as Record<string, unknown>[])[0] as Record<string, Record<string, unknown>>)["CorrectionRangeMask"] as Record<string, unknown>;

describe("new mask kinds in a session", () => {
  it("samples a colour range's colour from the preview at its point: orange in the orange half", async () => {
    clean();
    await begin();
    const out = await create({ kind: "color_range", point: { x: 0.5, y: 0.75 }, sliders: { "local.saturation": -20 } });
    expect(out.json["mask"]).toMatchObject({ kind: "color_range" });
    const [r, g, b] = String((holder(masks()[0])["PointModels"] as string[])[0]).split(" ").map(Number) as [number, number, number];
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    expect(lr.history.at(-1)).toBe(`AVG ${SHORT} pass 1/4 mask create`);
  });

  it("writes a given sample verbatim, and copies a colour range's sample with copy_sample_from (issue #210)", async () => {
    clean();
    await begin();
    const first = await create({ kind: "color_range", point: { x: 0.5, y: 0.25 }, geometry: { sample: { l: 0.522527, a: 0.888059, b: 0.758296 }, color_amount: 0.3 } });
    const id = (first.json["mask"] as { id: string }).id;
    expect(holder(masks()[0])["PointModels"]).toEqual(["0.522527 0.888059 0.758296 0.500000 0.250000 0"]);
    expect((first.json["mask"] as { geometry: unknown }).geometry).toMatchObject({ sample: { l: 0.522527, a: 0.888059, b: 0.758296 } });
    await create({ kind: "color_range", copy_sample_from: { mask_id: id }, sliders: { "local.exposure": 1 } });
    expect(holder(masks()[1])).toMatchObject({ PointModels: ["0.522527 0.888059 0.758296 0.500000 0.250000 0"], ColorAmount: 0.3 });
    const err = await fails(create({ kind: "color_range", copy_sample_from: { mask_id: "nope" } }));
    expect(err.code).toBe("MASK_NOT_FOUND");
  });

  it("takes a depth range out again on a photo without a depth map: DEPTH_MAP_MISSING, the pass not used", async () => {
    clean();
    await begin();
    const err = await fails(create({ kind: "depth_range", geometry: { depth_range: [0, 0.1, 0.3, 0.5] } }));
    expect(err.code).toBe("DEPTH_MAP_MISSING");
    expect(masks()).toEqual([]);
    expect(lr.history.slice(-2)).toEqual([`AVG ${SHORT} pass 1/4 mask create`, `AVG ${SHORT} pass 1/4 mask depth revert`]);
    const next = await create({ kind: "brush", geometry: { strokes: [{ points: [{ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.2 }] }] } });
    expect(next.json["pass"]).toBe("1/4");
  });
});
