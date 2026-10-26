// A mask pass's converged_by_metrics (issue #130 item 4) [stated: Jim, 2026-10-11, "Region deltas", "Signal
// only"]: true when every region's change is under the convergence thresholds (plan.ts convergedByRegions),
// false without regions or when the pass was undone, and it never ends the session. The sim renders global
// settings only, so a mask changes no region unless a test brightens the render while masks exist.
// Known gap [inference]: a mask that overlaps no region reads as converged, as here.

import { describe, expect, it } from "vitest";
import { MASK_TABLE_KEY } from "../src/params/index.js";
import type { FakeHandler } from "./helpers/fake-plugin.js";
import { ID, clean, lr, manager, plugin, readLog, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

const pass = { session_id: ID, rationale: "test", return_image: "none" as const };
const LINEAR = { kind: "linear", name: "AVG bottom", geometry: { zero: { x: 0.5, y: 0.67 }, full: { x: 0.5, y: 0.9 } }, sliders: { "local.exposure": 1 } };
const REGIONS = { session_id: ID, regions: [{ kind: "custom" as const, label: "top", box: { x: 0, y: 0, w: 1, h: 0.3 } }] };

async function begin(regions: boolean): Promise<void> {
  clean();
  await manager.begin({ max_passes: 4, intent_id: "test_plain", return_image: "none" });
  if (regions) await manager.setRegions(REGIONS);
}

/** While the photo has masks, render it `ev` brighter, or darker when negative (the sim renders global settings only). */
function masksBrighten(ev: number): void {
  const real = plugin.handlers.get("export_preview") as FakeHandler;
  plugin.handlers.set("export_preview", async (p, id) => {
    const saved = lr.settings["Exposure2012"];
    if (((lr.settings[MASK_TABLE_KEY] ?? []) as unknown[]).length > 0) lr.settings["Exposure2012"] = Number(saved) + ev;
    try {
      return await real(p, id);
    } finally {
      lr.settings["Exposure2012"] = saved;
    }
  });
}

describe("mask pass: converged_by_metrics from the regions (issue #130 item 4)", () => {
  it("is true when no region moved, in the result and the log; lr_step still works afterwards", async () => {
    await begin(true);
    const out = await manager.createMask({ ...pass, ...LINEAR });
    expect(out.json).toMatchObject({ converged_by_metrics: true, cap_reached: false });
    expect(readLog().passes.at(-1)).toMatchObject({ kind: "mask", converged_by_metrics: true });
    expect((await manager.step({ session_id: ID, settings: { exposure: 0.3 }, rationale: "test", return_image: "none" })).json).toMatchObject({ pass: "2/4" });
  });

  it("is false without regions", async () => {
    await begin(false);
    expect((await manager.createMask({ ...pass, ...LINEAR })).json).toMatchObject({ converged_by_metrics: false });
    expect(readLog().passes.at(-1)).toMatchObject({ converged_by_metrics: false });
  });

  it("is false when a region moved", async () => {
    await begin(true);
    masksBrighten(-0.2);
    const out = await manager.createMask({ ...pass, ...LINEAR });
    expect(out.json["undone"]).toBeUndefined();
    expect(out.json).toMatchObject({ converged_by_metrics: false });
  });

  it("is false when the pass was undone", async () => {
    await begin(true);
    masksBrighten(3);
    const out = await manager.createMask({ ...pass, ...LINEAR });
    expect(out.json).toMatchObject({ undone: { limit: "clip_high" }, converged_by_metrics: false });
    expect(readLog().passes.at(-1)).toMatchObject({ converged_by_metrics: false });
  });
});
