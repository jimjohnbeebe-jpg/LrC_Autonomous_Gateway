// lr_probe and lr_set_regions (src/session/probe.ts, regions.ts, guardrail.ts regionDrift) against
// the simulated Lightroom in its "tonal" model (tests/helpers/session-harness.ts): slopes, putting
// the photo back (also after a failure), a step after a preview at another size, and preserved regions.

import { beforeEach, describe, expect, it } from "vitest";
import { ID, SHORT, clean, fails, lr, manager, plugin, readLog, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

describe("lr_probe and lr_set_regions", () => {
  beforeEach(() => clean());

  it("probes sliders, puts the photo back, and records the slopes", async () => {
    await manager.begin({ intent_id: "test_plain" });
    const before = structuredClone(lr.settings);
    const out = await manager.probe({ session_id: ID, sliders: ["exposure", "shadows"], magnitude: 0.5 });
    expect(lr.history).toEqual([`AVG ${SHORT} probe exposure`, `AVG ${SHORT} probe shadows`, `AVG ${SHORT} probe revert`]);
    expect(lr.settings["Exposure2012"]).toBe(before["Exposure2012"]);
    expect(lr.settings["Shadows2012"]).toBe(before["Shadows2012"]);
    const results = out.json["results"] as Array<{ name: string; delta_applied: number; per_unit: { luma_mean: number } }>;
    expect(results.map((r) => [r.name, r.delta_applied])).toEqual([["exposure", 0.5], ["shadows", 30]]);
    expect(results[0]?.per_unit.luma_mean).toBeGreaterThan(20); // the model adds 40 levels per EV, less the clipped end
    expect(readLog().probes).toHaveLength(1);
  });

  it("puts the probed sliders back when a probe fails half-way (Greptile, PR #23)", async () => {
    await manager.begin({ intent_id: "test_plain" });
    const before = lr.settings["Exposure2012"];
    lr.exportError = "disk full";
    const e = await fails(manager.probe({ session_id: ID, sliders: ["exposure", "shadows"] }));
    expect(e.message).toMatch(/still open/);
    expect(lr.settings["Exposure2012"]).toBe(before);
    expect(lr.history).toEqual([`AVG ${SHORT} probe exposure`, `AVG ${SHORT} probe revert`]);
    lr.exportError = null;
    expect(readLog().failures.map((f) => f.stage)).toEqual(["probe"]);
  });

  it("after a failed probe puts back only the sliders it changed, keeping an edit made meanwhile (Greptile, PR #23)", async () => {
    await manager.begin({ intent_id: "test_plain" });
    const exposure = lr.settings["Exposure2012"];
    const apply = plugin.handlers.get("apply_settings");
    plugin.handlers.set("apply_settings", (p, id) => {
      const reply = apply?.(p, id);
      if (String(p["history_name"]).endsWith("probe exposure")) {
        lr.settings["Shadows2012"] = 42; // Jim drags Shadows while the probe runs
        lr.exportError = "disk full"; // and the probe's render fails
      }
      return reply ?? "silent";
    });
    await fails(manager.probe({ session_id: ID, sliders: ["exposure", "shadows"] }));
    expect(lr.settings["Exposure2012"]).toBe(exposure);
    expect(lr.settings["Shadows2012"]).toBe(42);
    lr.exportError = null;
  });

  it("reports a probed slider changed in Lightroom after it was put back, without overwriting it (Greptile, PR #23)", async () => {
    await manager.begin({ intent_id: "test_plain" });
    const shadows = lr.settings["Shadows2012"];
    const apply = plugin.handlers.get("apply_settings");
    plugin.handlers.set("apply_settings", (p, id) => {
      const reply = apply?.(p, id);
      // The write that probes shadows also puts exposure back; then Jim drags Exposure.
      if (String(p["history_name"]).endsWith("probe shadows")) lr.settings["Exposure2012"] = 0.77;
      return reply ?? "silent";
    });
    const e = await fails(manager.probe({ session_id: ID, sliders: ["exposure", "shadows"] }));
    expect(e.code).toBe("PROBE_NOT_PUT_BACK");
    expect(e.details).toMatchObject({ differing: [{ name: "exposure", now: 0.77 }] });
    expect(lr.settings["Exposure2012"]).toBe(0.77);
    expect(lr.settings["Shadows2012"]).toBe(shadows);
  });

  it("renders at the session's size again before a step that follows a preview at another size (Greptile, PR #23)", async () => {
    await manager.begin({ intent_id: "test_plain" });
    const small = await manager.preview(ID, 800);
    expect(small.width).toBe(800);
    const out = await manager.step({ session_id: ID, settings: { shadows: 10 }, rationale: "r" });
    expect(out.json["metrics_refreshed"]).toBeDefined();
    expect(readLog().passes[1]?.metrics_before).toBeDefined();
    expect(out.json["width"]).toBe(1600);
  });

  it("refuses to probe when the intent does not allow it", async () => {
    await manager.begin({ intent_id: "test_prior" });
    expect((await fails(manager.probe({ session_id: ID, sliders: ["exposure"] }))).code).toBe("PROBE_NOT_ALLOWED");
  });

  it("measures regions from now on, and undoes a pass that drifts a preserved region", async () => {
    await manager.begin({ intent_id: "test_plain" });
    const set = await manager.setRegions({ session_id: ID, regions: [{ kind: "custom", label: "orange", box: { x: 0, y: 0.5, w: 1, h: 0.5 }, preserve: true }] });
    const region = (set.json["regions"] as Array<{ label: string; hue_mean: number }>)[0];
    expect(region?.label).toBe("orange");
    expect(Math.abs((region?.hue_mean ?? 0) - 30)).toBeLessThan(3);
    const kept = await manager.step({ session_id: ID, settings: { shadows: 10 }, rationale: "r" });
    expect((kept.json["metrics"] as { regions: Array<{ label: string }> }).regions.map((r) => r.label)).toEqual(["orange"]);
    const out = await manager.step({ session_id: ID, settings: { temperature: 1000 }, rationale: "warmer" });
    const actions = out.json["guardrail_actions"] as Array<{ kind: string; limit: string; reason: string }>;
    expect(actions.at(-1)).toMatchObject({ kind: "reverted", limit: "region" });
    expect(actions.at(-1)?.reason).toMatch(/region "orange" drifted/);
    expect(out.json["undone"]).toMatchObject({ limit: "region" }); // Greptile, PR #27
    expect(lr.settings["Temperature"]).toBe(5500);
    expect(lr.history.at(-1)).toBe(`AVG ${SHORT} pass 2/4 region revert`);
    expect(readLog().regions[0]).toMatchObject({ label: "orange", preserve: true, baselines: { master: { hue_mean: expect.any(Number) } } });
  });

  it("undoes a pass that takes a preserved region's hue away, even when its saturation moved little (Greptile, PR #23)", async () => {
    lr.settings["Saturation"] = -70; // the orange half is pale but still has a hue; -30 more makes it grey
    await manager.begin({ intent_id: "test_plain" });
    await manager.setRegions({ session_id: ID, regions: [{ kind: "custom", label: "pale", box: { x: 0, y: 0.5, w: 1, h: 0.5 }, preserve: true }] });
    const out = await manager.step({ session_id: ID, settings: { saturation: -30 }, rationale: "desaturate" });
    const actions = out.json["guardrail_actions"] as Array<{ kind: string; reason: string }>;
    expect(actions.at(-1)).toMatchObject({ kind: "reverted" });
    expect(actions.at(-1)?.reason).toMatch(/lost its hue/);
    expect(lr.settings["Saturation"]).toBe(-70);
  });

  it("refuses bad or duplicate region boxes", async () => {
    await manager.begin({ intent_id: "test_plain" });
    const box = { x: 0.8, y: 0, w: 0.5, h: 0.5 };
    expect((await fails(manager.setRegions({ session_id: ID, regions: [{ kind: "sky", label: "a", box }] }))).code).toBe("INVALID_ARGUMENTS");
    const ok = { x: 0, y: 0, w: 0.5, h: 0.5 };
    const dup = [{ kind: "sky" as const, label: "a", box: ok }, { kind: "sky" as const, label: "a", box: ok }];
    expect((await fails(manager.setRegions({ session_id: ID, regions: dup }))).message).toMatch(/labels must differ/);
  });
});
