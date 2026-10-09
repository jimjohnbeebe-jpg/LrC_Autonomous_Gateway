// Every bundled intent (engine\intents\, schema v2) on a raw photo and on a rendered one, against the
// simulated Lightroom: pass 0 sets the intent's profile for the photo's pipeline and its white-balance
// priors only on their own pipeline, one lr_step goes through, and the revert puts the photo back
// (PHASE8_PLAN acceptance: "All 11 bundled intents run on both pipelines in the simulator").

import { describe, expect, it } from "vitest";
import { IntentLibrary } from "../src/intents/index.js";
import { PIPELINES } from "../src/params/index.js";
import { ID, clean, lr, manager, map, useSessionHarness } from "./helpers/session-harness.js";

const bundled = [...new IntentLibrary({ map, userDir: "" }).load().intents.values()].map((l) => l.intent);

describe.each(PIPELINES)("the bundled intents (%s pipeline)", (pipeline) => {
  useSessionHarness(pipeline);

  it("finds all eleven", () => {
    expect(bundled).toHaveLength(11);
  });

  it.each(bundled.map((i) => [i.id, i] as const))("%s: pass 0, one step and an exact revert", async (_, intent) => {
    clean();
    const before = map.fromSdk(lr.settings).settings;
    const begun = await manager.begin({ intent_id: intent.id, return_image: "none" });
    expect(begun.json["ok"]).toBe(true);
    const after = map.fromSdk(lr.settings);
    expect(after.camera_profile.name).toBe(intent.profile?.[pipeline]);
    // White balance moves only by the photo's own pipeline's priors (none on rendered in the bundled set).
    const wb = intent.priors_by_pipeline?.[pipeline] ?? {};
    for (const name of ["temperature", "tint"]) {
      if (name in wb) expect(after.settings[name], name).toBe((before[name] as number) + (wb[name] as number));
      else expect(after.settings[name], name).toBe(before[name]);
    }
    const stepped = await manager.step({ session_id: ID, settings: { exposure: 0.1 }, rationale: "test", return_image: "none" });
    expect(stepped.json["ok"]).toBe(true);
    const end = await manager.end({ session_id: ID, outcome: "revert" });
    expect(end.json).toMatchObject({ outcome: "revert", revert: { differing: [] } });
  });
});
