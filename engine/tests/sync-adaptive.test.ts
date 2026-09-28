// lr_sync_series with adaptive exposure (src/sync/exposure.ts, target.ts; PRD 6.10, PHASE4_PLAN
// row 8 and decision 5) against the simulated Lightroom's "tonal" model: a made-up render, good for
// testing the search and the writes, not for claims about Lightroom's rendering.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { RECIPE_SCHEMA_ID } from "../src/log/index.js";
import { PreviewService } from "../src/preview/index.js";
import { acceptedSession, addCopy, clean, client, logDir, lr, map, plugin, sync, syncFails, tmp, useSyncHarness } from "./helpers/sync-harness.js";

useSyncHarness();

type TargetJson = { uuid: string; history_names: string[]; exposure: { start: number; final: number; offset: number }; luma: { goal: number; start: number; final: number; renders: number; met: boolean; tries: Array<{ exposure: number; luma: number }> } };
const targetsOf = (out: { json: Record<string, unknown> }) => out.json["targets"] as TargetJson[];
const settingsOf = (uuid: string): Record<string, unknown> => (lr.copies.get(uuid) as { settings: Record<string, unknown> }).settings;
const adaptive = { adaptive_exposure: true, return_image: "none" } as const;

describe("lr_sync_series: adaptive exposure", () => {
  it("finds each copy's exposure: copies at -1.0, +0.5 and +1.0 EV end within 2/255 of the source's mean luma (PHASE4_PLAN decision 5)", async () => {
    clean();
    const { id } = await acceptedSession([{ contrast: 15, vibrance: 10 }]);
    const uuids = [-1, 0.5, 1].map((ev, i) => addCopy(i + 1, { Exposure2012: ev, Contrast2012: 0, Vibrance: 0 }));
    const out = await sync({ source: { session_id: id }, targets: { uuids }, ...adaptive });
    const short = (out.json["sync_id"] as string).replace(/-/g, "").slice(0, 4);
    // Measured again, independently of the sync: the source and each copy as they are now.
    const previews = new PreviewService(client, { previewDir: path.join(tmp, "previews") });
    const luma = async (uuid: string): Promise<number> => (await previews.render({ longEdge: 1600, quality: 75, photoUuid: uuid })).metrics.luma_mean;
    const goal = await luma("SIM-UUID");
    expect(Math.abs((out.json["source_luma"] as number) - goal)).toBeLessThan(0.5);
    for (const uuid of uuids) {
      expect(Math.abs((await luma(uuid)) - goal), uuid).toBeLessThanOrEqual(2);
      expect([settingsOf(uuid)["Contrast2012"], settingsOf(uuid)["Vibrance"]]).toEqual([15, 10]);
    }
    expect(out.json["copied"]).not.toContain("exposure");
    const offsets = out.json["per_target_exposure_offsets"] as Record<string, number>;
    expect(uuids.map((u) => Math.abs(offsets[u] as number) <= 0.06)).toEqual([true, true, true]);
    for (const [i, t] of targetsOf(out).entries()) {
      expect(t.exposure.start).toBe([-1, 0.5, 1][i]);
      expect(t.luma.met).toBe(true);
      expect(t.luma.renders).toBeLessThanOrEqual(4);
      expect(t.history_names[0]).toBe(`AVG sync ${short}`);
      expect(t.history_names.slice(1).every((n) => new RegExp(`^AVG sync ${short} exposure \\d$`).test(n))).toBe(true);
    }
    expect(lr.selected).toBe("SIM-UUID");
  });

  it("refuses when the source photo no longer holds its recipe's settings, before writing; without adaptive exposure the sync goes ahead", async () => {
    clean();
    const { id } = await acceptedSession();
    lr.settings["Contrast2012"] = 33;
    const a = addCopy(1);
    const n0 = lr.writes.length;
    expect(await syncFails({ source: { session_id: id }, targets: { uuids: [a] }, ...adaptive })).toMatchObject({ code: "SOURCE_CHANGED", details: { differing: ["contrast"] } });
    expect([lr.writes.length, lr.snapshots.size]).toEqual([n0, 1]); // the session's own snapshot only
    const plain = await sync({ source: { session_id: id }, targets: { uuids: [a] }, adaptive_exposure: false, return_image: "none" });
    expect(plain.json["applied"]).toBe(1);
  });

  it("refuses when the source photo's camera profile changed and the recipe named none (Greptile, PR #35)", async () => {
    clean();
    // A recipe whose profile the map could not name has no camera_profile; the photo's is pinned.
    const { camera_profile: profile, ...settings } = map.fromSdk(lr.settings).settings;
    expect(profile).toBe("Camera Neutral");
    mkdirSync(logDir, { recursive: true });
    const recipe = { schema: RECIPE_SCHEMA_ID, session_id: "abc12300-0000-0000-0000-000000000000", created: "2026-09-27T00:00:00.000Z", intent_id: "test_plain", source: { uuid: "SIM-UUID", filename: null }, process_version: "15.4", settings };
    writeFileSync(path.join(logDir, "20260927-abc123.recipe.json"), JSON.stringify(recipe), "utf8");
    const a = addCopy(1);
    expect(await syncFails({ source: { recipe_path: "20260927-abc123.recipe.json" }, targets: { uuids: [a] }, ...adaptive })).toMatchObject({ code: "SOURCE_CHANGED", details: { differing: ["camera_profile"] } });
    expect(lr.writes).toEqual([]);
  });

  it("refuses more than three targets", async () => {
    clean();
    const { id } = await acceptedSession();
    const uuids = [1, 2, 3, 4].map((n) => addCopy(n));
    expect(await syncFails({ source: { session_id: id }, targets: { uuids }, ...adaptive })).toMatchObject({ code: "TOO_MANY_TARGETS", details: { targets: 4, cap: 3 } });
  });

  it("puts the best try back when the search ends on a worse one, and says the goal was not met", async () => {
    clean();
    const { id } = await acceptedSession();
    const a = addCopy(1);
    // Flat renders: the source at 118; the copy's renders, in order, at 100, 121, 125, 130.
    const script = [100, 121, 125, 130];
    const original = plugin.handlers.get("export_preview") as NonNullable<ReturnType<typeof plugin.handlers.get>>;
    plugin.handlers.set("export_preview", async (p, rid) => {
      const reply = await original(p, rid);
      if (reply === "silent" || !reply.ok) return reply;
      const level = p["photo_uuid"] === a ? (script.shift() ?? 130) : 118;
      const file = (reply.payload as { path: string }).path;
      await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: level, g: level, b: level } } }).jpeg({ quality: 100 }).toFile(file);
      return reply;
    });
    const out = await sync({ source: { session_id: id }, targets: { uuids: [a] }, ...adaptive });
    const t = targetsOf(out)[0] as TargetJson;
    const firstTry = t.luma.tries[1] as { exposure: number; luma: number };
    expect(t.luma.met).toBe(false);
    expect(Math.round(t.luma.final)).toBe(121);
    expect(t.exposure.final).toBe(firstTry.exposure);
    expect(settingsOf(a)["Exposure2012"]).toBe(firstTry.exposure);
    // The last write puts the best try back.
    expect(t.history_names.length).toBe(t.luma.tries.length + 1);
    expect(lr.writes.at(-1)).toEqual({ uuid: a, name: t.history_names.at(-1) });
  });
});
