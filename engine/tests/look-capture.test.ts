// "Save this edit as a look" (Phase 10 row 5): lr_save_intent with from_photo and dry_run against the
// simulated Lightroom, then the saved v3 look at pass 0 on a photo with other settings, on both pipelines:
// the tone, presence and white balance come along as absolute values, detail and lens corrections do not.

import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PIPELINES } from "../src/params/index.js";
import { intent, userDir, wb } from "./helpers/session-harness.js";
import { clean, lr, map, tools, useSyncHarness } from "./helpers/sync-harness.js";

const candidate = { id: "my_edit", label: "My edit", category: "look", brief: "Jim's edit, as a look." };

describe.each(PIPELINES)("save this edit as a look (%s pipeline)", (pipeline) => {
  useSyncHarness(pipeline);
  const temperature = pipeline === "raw" ? 5200 : 15;

  const edit = (): void => {
    clean();
    Object.assign(lr.settings, { Exposure2012: 0.85, Contrast2012: 25, Clarity2012: 12, WhiteBalance: "Custom", [wb(pipeline).key]: temperature });
  };

  it("returns the whole global edit in set, white balance in set_by_pipeline, and writes nothing on a dry run", async () => {
    edit();
    const out = await tools.saveIntent({ intent: candidate, confirmed: false, from_photo: true, dry_run: true });
    expect(out.json).toMatchObject({ ok: true, dry_run: true, written: false, from_photo: { pipeline } });
    const intent = out.json["intent"] as { schema_version: number; set: Record<string, unknown>; set_by_pipeline: Record<string, Record<string, unknown>>; profile?: unknown };
    expect(intent.schema_version).toBe(3);
    expect(intent.set).toMatchObject({ exposure: 0.85, contrast: 25, clarity: 12 });
    expect(Object.keys(intent.set_by_pipeline)).toEqual([pipeline]);
    expect(intent.set_by_pipeline[pipeline]).toMatchObject({ temperature });
    expect(Object.keys(intent.set).filter((n) => n.startsWith("sharpening.") || n.startsWith("noise.") || n.startsWith("lens."))).toEqual([]);
    expect(existsSync(path.join(userDir, "my_edit.json"))).toBe(false);
  });

  it("saves the previewed look unchanged, refuses a capture that would save at once, and pass 0 writes its values as given", async () => {
    edit();
    const preview = (await tools.saveIntent({ intent: candidate, confirmed: false, from_photo: true, dry_run: true })).json["intent"] as Record<string, unknown>;
    await expect(tools.saveIntent({ intent: candidate, confirmed: true, from_photo: true })).rejects.toMatchObject({ code: "INVALID_ARGUMENTS" });
    Object.assign(lr.settings, { Exposure2012: 2 }); // changed after the preview: not saved
    await tools.saveIntent({ intent: preview, confirmed: true });
    clean();
    Object.assign(lr.settings, { Exposure2012: -0.4, Contrast2012: -10, Clarity2012: 0 });
    const begun = await tools.beginSession({ intent_id: "my_edit", return_image: "none" });
    expect(begun.json["ok"]).toBe(true);
    const after = map.fromSdk(lr.settings).settings;
    expect(after).toMatchObject({ exposure: 0.85, contrast: 25, clarity: 12, temperature });
  });

  it("adds a variant's prior on top of the look's set value, not the photo's old one", async () => {
    clean();
    intent("look_variants", {
      schema_version: 3,
      set: { exposure: 0.5 },
      variants: { A: { label: "a", priors: {} }, B: { label: "b", priors: { exposure: 0.3 } }, C: { label: "c", priors: { exposure: -0.2 } } },
    });
    Object.assign(lr.settings, { Exposure2012: -1 });
    await tools.beginSession({ intent_id: "look_variants", mode: "variants", return_image: "none" });
    const exposure = (n: number) => (lr.copies.get(`SIM-COPY-${n}`) as { settings: Record<string, unknown> }).settings["Exposure2012"];
    expect([exposure(1), exposure(2), exposure(3)]).toEqual([0.5, 0.8, 0.3]);
  });
});
