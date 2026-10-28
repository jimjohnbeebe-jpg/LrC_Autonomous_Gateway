// copy_sample_from with a `target` (src/session/masks.ts copySample; issue #210): in Variants mode the masked photo is
// the pick, selected by the pass, so the source photo is read by photo_uuid, not target_uuid, which the plugin
// refuses for a photo that is not selected (Develop.lua target(); the simulator's guard, lightroom-sim.ts).

import { describe, expect, it } from "vitest";
import { IDENTITY, MASK_TABLE_KEY, applyOp, type Correction } from "../src/params/index.js";
import { ID, clean, lr, manager, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

const SAMPLE = { l: 0.522527, a: 0.888059, b: 0.758296 };

describe("copy_sample_from another session target", () => {
  it("Variants mode: copies the master's colour range onto the pick B", async () => {
    clean();
    await manager.begin({ max_passes: 4, intent_id: "test_variants", mode: "variants", variant_count: 2, return_image: "none" });
    await manager.selectVariant({ session_id: ID, variant: "B" });
    const theirs = applyOp([], { op: "create", kind: "color_range", point: { x: 0.5, y: 0.25 }, geometry: { sample: SAMPLE, color_amount: 0.3 } }, IDENTITY);
    lr.settings[MASK_TABLE_KEY] = theirs.entries as Correction[]; // the master only, made after the copies
    const out = await manager.createMask({ session_id: ID, rationale: "test", return_image: "none", kind: "color_range", copy_sample_from: { mask_id: theirs.id, target: "master" }, sliders: { "local.exposure": 1 } });
    expect(out.json).toMatchObject({ target: "B", mask: { kind: "color_range", geometry: { sample: SAMPLE, color_amount: 0.3 } } });
  });
});
