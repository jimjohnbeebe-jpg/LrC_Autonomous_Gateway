// Hands-on batch 1, item 1 and 6 (src/session/begin.ts, end.ts, log/session-log.ts): the begin result
// names the session's log_path and the zero-neutral sliders already off 0 (start_off_zero); a session
// the AI ends logs ended_by.source "ai", and a log written before the rename ("claude") still parses.

import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { sessionLogSchema } from "../src/log/index.js";
import { startOffZero } from "../src/session/begin.js";
import { ID, clean, logFile, lr, manager, readLog, useSessionHarness } from "./helpers/session-harness.js";

describe("start_off_zero", () => {
  it("is empty when every zero-neutral slider is 0, whatever the others hold", () => {
    const zero = { exposure: 0, contrast: 0, texture: 0, clarity: 0, "hsl.orange.sat": 0, "grading.shadows.sat": 0, "grading.balance": 0, "vignette.amount": 0, "grain.amount": 0 };
    const others = { temperature: 5500, tint: 10, "grading.blending": 50, "grading.midtones.hue": 30, "vignette.midpoint": 50, "sharpening.amount": 40, "noise.color": 25, "lens.ca_remove": 1, camera_profile: "Adobe Color" };
    expect(startOffZero({ ...zero, ...others })).toEqual({});
  });

  it("lists the zero-neutral sliders off 0 with their values", () => {
    expect(startOffZero({ exposure: 0.33, shadows: 10, highlights: -21, texture: 4, clarity: 0, "hsl.blue.lum": -5, "grading.highlights.sat": 12, "grain.amount": 20, temperature: 5500 })).toEqual({
      exposure: 0.33,
      shadows: 10,
      highlights: -21,
      texture: 4,
      "hsl.blue.lum": -5,
      "grading.highlights.sat": 12,
      "grain.amount": 20,
    });
  });
});

describe("the begin result and the log", () => {
  useSessionHarness("raw");
  beforeEach(() => clean());

  it("names the log_path and the settings found on the photo", async () => {
    Object.assign(lr.settings, { Texture: 8, Clarity2012: 4 });
    const out = await manager.begin({ intent_id: "test_plain" });
    expect(out.json["log_path"]).toBe(logFile());
    expect(out.json["start_off_zero"]).toMatchObject({ texture: 8, clarity: 4 });
  });

  it("logs ended_by.source \"ai\" when the AI ends the session", async () => {
    await manager.begin({ intent_id: "test_plain" });
    const out = await manager.end({ session_id: ID, outcome: "revert" });
    expect(out.json["ended_by"]).toEqual({ source: "ai" });
    expect(readLog().ended_by).toEqual({ source: "ai" });
  });

  it("still reads a log written before the rename, with \"claude\" as the source", async () => {
    await manager.begin({ intent_id: "test_plain" });
    await manager.end({ session_id: ID, outcome: "revert" });
    const old = JSON.parse(readFileSync(logFile(), "utf8")) as Record<string, unknown>;
    old["ended_by"] = { source: "claude" };
    old["approvals"] = [{ at: new Date().toISOString(), target: "master", pass: 1, by: "claude" }];
    expect(sessionLogSchema.parse(old)).toMatchObject({ ended_by: { source: "claude" }, approvals: [{ by: "claude" }] });
  });
});
