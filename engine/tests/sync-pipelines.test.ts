// lr_sync_series across pipelines (Phase 8 row 5, PHASE8_PLAN "Propagation"; src/sync/transfer.ts)
// against the simulated Lightroom: a raw recipe onto a rendered photo writes the shared groups and
// reports white_balance and camera_profile as not_transferable; the reverse too; bare settings check
// the white balance against each target's own range (decision P2 A); a target that can take nothing is
// skipped before its snapshot.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RECIPE_SCHEMA_ID } from "../src/log/index.js";
import { renderedDumps } from "./helpers/lightroom-sim-rendered.js";
import { acceptedSession, addCopy, clean, logDir, lr, sent, sync, useSyncHarness } from "./helpers/sync-harness.js";

useSyncHarness();

const quiet = { adaptive_exposure: false, return_image: "none" } as const;
const JPEG = "SIM-LIB-2";
const targetsOf = (out: { json: Record<string, unknown> }) => out.json["targets"] as Array<Record<string, unknown>>;
const skippedOf = (out: { json: Record<string, unknown> }) => out.json["skipped"] as Array<Record<string, unknown>>;

/** The sim's second library photo becomes DSC_0031.JPG as S10's census read it (rendered, process version 15.4). */
function renderedPhoto(): Record<string, unknown> {
  const photo = lr.library.photos[1] as { settings?: Record<string, unknown>; file_format?: string };
  photo.settings = structuredClone(renderedDumps["15.4"].settings) as Record<string, unknown>;
  photo.file_format = "JPG";
  return photo.settings;
}

/** A rendered photo's recipe written by hand (engine 0.21.0 recipes carry `pipeline`). */
function renderedRecipe(settings: Record<string, unknown>): string {
  mkdirSync(logDir, { recursive: true });
  const name = "20261009-rend01.recipe.json";
  const recipe = { schema: RECIPE_SCHEMA_ID, session_id: "rend01", created: "2026-10-09T00:00:00Z", intent_id: "test", source: { uuid: JPEG, filename: "DSC_0031.JPG" }, process_version: "15.4", pipeline: "rendered", settings };
  writeFileSync(path.join(logDir, name), JSON.stringify(recipe), "utf8");
  return name;
}

describe("lr_sync_series across pipelines", () => {
  it("raw recipe onto a rendered photo: the shared groups are written, white balance and profile reported", async () => {
    clean();
    const jpeg = renderedPhoto();
    const { id } = await acceptedSession([{ contrast: 15 }]); // the recipe carries the master's Kelvin white balance and its pinned raw profile too
    const out = await sync({ source: { session_id: id }, targets: { uuids: [JPEG] }, ...quiet });
    expect(out.json).toMatchObject({ applied: 1, skipped: [], source: { pipeline: "raw" } });
    const t = targetsOf(out)[0] as Record<string, unknown>;
    expect(t["pipeline"]).toBe("rendered");
    expect(t["changed"]).toContain("contrast");
    expect(t["not_transferable"]).toEqual([
      { group: "white_balance", names: ["temperature", "tint"], reason: expect.stringContaining("kelvin units") },
      { group: "camera_profile", names: ["camera_profile"], reason: expect.stringContaining("is a raw-pipeline profile and this photo is on the rendered pipeline") },
    ]);
    expect([jpeg["Contrast2012"], jpeg["CameraProfile"], jpeg["IncrementalTemperature"], jpeg["WhiteBalance"]]).toEqual([15, "Embedded", 0, "As Shot"]);
    expect("Look" in jpeg).toBe(false);
    const written = sent("apply_settings").find((p) => p["photo_uuid"] === JPEG)?.["settings"] as Record<string, unknown>;
    expect(Object.keys(written)).not.toContain("Temperature");
    expect(Object.keys(written)).not.toContain("Look");
  });

  it("rendered recipe onto a raw photo: the reverse", async () => {
    clean();
    const a = addCopy(1);
    const name = renderedRecipe({ temperature: 20, tint: -5, contrast: 7, camera_profile: "Monochrome" });
    const out = await sync({ source: { recipe_path: name }, targets: { uuids: [a] }, ...quiet });
    expect(out.json).toMatchObject({ applied: 1, source: { pipeline: "rendered" } });
    const t = targetsOf(out)[0] as Record<string, unknown>;
    expect(t["pipeline"]).toBe("raw");
    expect(t["changed"]).toEqual(["contrast"]);
    expect((t["not_transferable"] as Array<{ group: string }>).map((n) => n.group)).toEqual(["white_balance", "camera_profile"]);
    const copy = (lr.copies.get(a) as { settings: Record<string, unknown> }).settings;
    expect([copy["Contrast2012"], copy["Temperature"], copy["ConvertToGrayscale"]]).toEqual([7, lr.settings["Temperature"], false]); // the raw photo keeps its own profile
  });

  it("bare settings (pipeline unknown): each target checks the white balance against its own range (P2 A)", async () => {
    clean();
    const jpeg = renderedPhoto();
    const a = addCopy(1);
    const out = await sync({ source: { settings: { temperature: 50, contrast: 10 } }, targets: { uuids: [JPEG, a] }, ...quiet });
    expect(out.json).toMatchObject({ applied: 2, skipped: [], source: { pipeline: null } });
    const [onJpeg, onRaw] = targetsOf(out) as [Record<string, unknown>, Record<string, unknown>];
    expect(onJpeg["not_transferable"]).toEqual([]);
    expect([jpeg["IncrementalTemperature"], jpeg["WhiteBalance"], jpeg["Contrast2012"]]).toEqual([50, "Custom", 10]);
    expect(onRaw["not_transferable"]).toEqual([{ group: "white_balance", names: ["temperature"], reason: expect.stringContaining("source's pipeline is not known") }]);
    expect(onRaw["changed"]).toEqual(["contrast"]);
  });

  it("a target that can take nothing is skipped before its snapshot (NOTHING_TRANSFERABLE)", async () => {
    clean();
    renderedPhoto();
    const { id } = await acceptedSession([{ temperature: 5500 }]);
    const out = await sync({ source: { session_id: id }, targets: { uuids: [JPEG] }, parameter_mask: ["white_balance"], ...quiet });
    expect(out.json).toMatchObject({ applied: 0 });
    expect(skippedOf(out)).toEqual([
      {
        uuid: JPEG,
        filename: "20260907-_OZ80099.NEF",
        code: "NOTHING_TRANSFERABLE",
        reason: expect.stringContaining("white_balance (temperature, tint)"),
        not_transferable: [{ group: "white_balance", names: ["temperature", "tint"], reason: expect.any(String) }],
      },
    ]);
    expect(sent("create_snapshot").filter((p) => p["photo_uuid"] === JPEG)).toEqual([]);
    expect(lr.writes.filter((w) => w.uuid === JPEG)).toEqual([]);
  });
});
