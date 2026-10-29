// lr_crop inside a session (src/session/crop.ts; GitHub issue #115) against the simulated Lightroom, whose
// apply_settings stores the Crop keys as written and whose get_context gives a 6000x4000 size: one pass and one
// History step, the log entry, the cap, regions cleared, NO_CHANGE, a crop not taken written back, Variants mode
// before the pick, and a revert that names the crop when it is not put back. In Lightroom [unverified] until
// `npm run crop:check`.

import { describe, expect, it } from "vitest";
import { CROP } from "../src/params/index.js";
import { ID, clean, fails, lr, manager, readLog, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

const begin = (extra: Record<string, unknown> = {}) => manager.begin({ max_passes: 3, intent_id: "test_plain", return_image: "none", ...extra });
const crop = (args: Record<string, unknown>) => manager.crop({ session_id: ID, rationale: "test", return_image: "none", ...args });
const cropOf = () => Object.fromEntries(Object.values(CROP).filter((k) => k !== "orientation").map((k) => [k, lr.settings[k]]));

describe("lr_crop (issue #115)", () => {
  it("writes the crop as one pass and one History step, logs it, and clears the regions", async () => {
    clean();
    await begin();
    await manager.setRegions({ session_id: ID, regions: [{ kind: "sky", label: "sky", box: { x: 0, y: 0, w: 1, h: 0.3 } }] });
    const writes = lr.history.length;
    const out = await crop({ aspect: "4:5", angle: 3 });
    expect(lr.history.slice(writes)).toEqual(["AVG abcdef pass 1/3 crop"]);
    expect(out.json).toMatchObject({ ok: true, pass: "1/3", cap_reached: false, passes_left: 2, regions_cleared: ["sky"], crop: { before: { box: { x: 0, y: 0, w: 1, h: 1 }, angle: 0, aspect: 1.5 }, after: { angle: 3, aspect: 0.8 } } });
    expect(lr.settings[CROP.angle]).toBe(3);
    expect(Number(lr.settings[CROP.left])).toBeGreaterThan(0);
    const entry = readLog().passes.at(-1);
    expect(entry).toMatchObject({ n: 1, kind: "crop", history_names: ["AVG abcdef pass 1/3 crop"], changes: [], requested: { aspect: "4:5", angle: 3 }, crop: { after: { angle: 3 } } });
    expect(readLog().regions).toEqual([]);
  });

  it("refuses the same crop again (NO_CHANGE), counts the cap, and resets", async () => {
    clean();
    await begin({ max_passes: 2 });
    await crop({ box: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } });
    const writes = lr.history.length;
    expect(await fails(crop({ box: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } }))).toMatchObject({ code: "NO_CHANGE" });
    expect(lr.history.length).toBe(writes);
    expect((await crop({ reset: true })).json).toMatchObject({ pass: "2/2", cap_reached: true });
    expect(cropOf()).toEqual({ CropLeft: 0, CropTop: 0, CropRight: 1, CropBottom: 1, CropAngle: 0 });
    expect(await fails(crop({ angle: 2 }))).toMatchObject({ code: "CAP_REACHED" });
  });

  it("writes the crop before back when Lightroom does not take it, and uses no pass", async () => {
    clean();
    await begin();
    lr.ignored.add(CROP.angle);
    expect(await fails(crop({ angle: 5 }))).toMatchObject({ code: "WRITE_NOT_TAKEN", message: expect.stringMatching(/pass 1\/3 crop revert/) });
    expect(lr.history.at(-1)).toBe("AVG abcdef pass 1/3 crop revert");
    expect(Number(lr.settings[CROP.left] ?? 0)).toBe(0);
    lr.ignored.delete(CROP.angle);
    expect((await crop({ angle: 5 })).json).toMatchObject({ pass: "1/3" });
  });

  it("Variants mode: refuses a crop before the pick", async () => {
    clean();
    await manager.begin({ max_passes: 4, intent_id: "test_variants", mode: "variants", variant_count: 2, return_image: "none" });
    expect(await fails(crop({ target: "A", angle: 2 }))).toMatchObject({ code: "CROP_AFTER_PICK" });
  });

  it("a revert names the crop when the snapshot does not put it back, and keeps the snapshot", async () => {
    clean();
    await begin();
    await crop({ angle: 4 });
    for (const snap of lr.snapshots.values()) snap[CROP.angle] = 4; // a snapshot that leaves the crop
    const out = await manager.end({ session_id: ID, outcome: "revert" });
    expect(out.json).toMatchObject({ revert: { differing: ["crop"] }, snapshot_removed: false });
    expect(lr.deletedSnapshots).toEqual([]);
  });

  it("a revert that puts the crop back differs in nothing", async () => {
    clean();
    await begin();
    await crop({ angle: 4 });
    expect((await manager.end({ session_id: ID, outcome: "revert" })).json).toMatchObject({ revert: { differing: [] }, snapshot_removed: true });
  });
});
