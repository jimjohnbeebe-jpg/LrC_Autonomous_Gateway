// The Phase 8 check (devtools\phase8-check.ts, `npm run phase8:check`) against the simulated plugin
// (helpers\phase8-harness.ts): both pipelines, process versions 15.4 and 11.0, a virtual copy, a
// missing original.

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ringTargets } from "../src/devtools/phase8-photos.js";
import { presetFileProblems } from "../src/devtools/phase8-presets.js";
import { canonicalValuesEqual } from "../src/params/index.js";
import { failures, h, map, runCheck, saved, userIntentsDir, usePhase8Harness, UUIDS, YES } from "./helpers/phase8-harness.js";
import { nefDump } from "./helpers/lightroom-sim.js";
import { renderedDumps } from "./helpers/lightroom-sim-rendered.js";

usePhase8Harness();

type J = Record<string, unknown>;
const sent = (name: string): J[] => h.plugin.received.filter((r) => r.name === name).map((r) => r.payload);
const asBefore = (uuid: string, start: Record<string, unknown>): boolean => {
  const now = map.fromSdk(h.lr.settingsOf(uuid)).settings;
  const was = map.fromSdk(start).settings;
  return Object.keys({ ...now, ...was }).every((k) => canonicalValuesEqual(now[k], was[k]));
};

describe("npm run phase8:check", () => {
  it("runs every part on both pipelines, puts every photo back, and finishes WORKED", { timeout: 120000 }, async () => {
    const { accepted, finished, results } = await runCheck(YES);
    expect(failures()).toEqual([]);
    expect(finished).toBe(true);
    expect(accepted).toBe(true);
    const s = saved();
    expect(s.photos.map((p) => [p.label, p.ok])).toEqual([
      ["20260907-_OZ80093.NEF", true],
      ["_DSC0103.NEF", true],
      ["DSC_0031.JPG", true],
      ["DSC_0031.JPG", true],
      ["DSC_0031.JPG (Copy 1)", true],
      ["20260907-_OZ80099-Edit.tif", true],
    ]);
    // The missing original was refused before anything was written.
    expect(s.photos[5]?.summary["missing"]).toEqual({ refused: true, code: "ORIGINAL_MISSING" });
    expect(s.intents).toHaveLength(11);
    expect(s.intents.every((i) => i.ok)).toBe(true);
    expect((s.cross?.summary["not_transferable"] as J[]).map((g) => [g["group"], g["names"]]).sort()).toEqual([["camera_profile", ["camera_profile"]], ["white_balance", ["temperature", "tint"]]]);
    expect(h.clicked).toBe(true);
    expect(s.pending).toEqual([]);
    expect(results["summary"]).toMatchObject({ acceptance_suggestion: "WORKED", cleanup: { presetsGone: 3, presets: 3, snapshotGone: true } });
    // Every photo is as it was; Part 1's presets were deleted by the check.
    expect(asBefore(h.lr.uuid, nefDump.settings)).toBe(true);
    expect(asBefore(UUIDS.nef2, nefDump.settings)).toBe(true);
    expect(asBefore(UUIDS.jpg, renderedDumps["15.4"].settings)).toBe(true);
    expect(asBefore(UUIDS.jpg11, renderedDumps["11.0"].settings)).toBe(true);
    expect(asBefore(UUIDS.copy1, renderedDumps["15.4"].settings)).toBe(true);
    expect(existsSync(h.presetDir)).toBe(true);
    expect(sent("apply_settings").filter((p) => p["photo_uuid"] === UUIDS.tif)).toEqual([]);
  });
});

describe("npm run phase8:check, resumed", () => {
  it("after a stop mid-chat, puts the JPEG back first, skips what is done, and finishes", { timeout: 120000 }, async () => {
    h.stopAt = /6\. Come back to this window/;
    const first = await runCheck(["y"]);
    expect(first.finished).toBe(false);
    expect(first.results["summary"]).toMatchObject({ acceptance_suggestion: "NOT FINISHED", pending: ["DSC_0031.JPG (Copy 1)"] });
    const begins = sent("create_snapshot").length;
    h.stopAt = null;
    h.said.length = 0;
    const second = await runCheck(["y", "y", "y", "y"]);
    expect(failures()).toEqual([]);
    expect(h.said).toContain("  DSC_0031.JPG (Copy 1) put back as before the check: YES");
    expect(second).toMatchObject({ finished: true, accepted: true });
    expect(saved().runs).toHaveLength(2);
    // The second run took snapshots of the JPEG only (the check's before the chat, the chat session's): no photo of Parts 1-3 was edited again.
    const later = sent("create_snapshot").slice(begins);
    expect(later).toHaveLength(2);
    expect(later.every((p) => (p["photo_uuid"] ?? p["target_uuid"]) === UUIDS.copy1)).toBe(true);
  });
});

describe("the check's parts", () => {
  it("ringTargets: each available photo syncs onto the next of its pipeline, round the collection", () => {
    const f = (uuid: string, pipeline: "raw" | "rendered", available = true) => ({ uuid, label: uuid, filename: uuid, copy_name: null, file_format: null, pipeline, process_version: "15.4", available });
    const t = ringTargets([f("a", "raw"), f("b", "rendered"), f("c", "raw"), f("d", "rendered", false), f("e", "rendered")]);
    expect([...t].map(([k, v]) => [k, v?.uuid ?? null])).toEqual([["a", "c"], ["c", "a"], ["b", "e"], ["e", "b"]]);
    expect(ringTargets([f("a", "raw")]).get("a")).toBeNull();
  });

  it("presetFileProblems: names the white balance or profile in the other pipeline's form", () => {
    const file = path.join(h.presetDir, "AVG preset reference rendered.xmp");
    const source = { camera_profile: "Color" };
    expect(presetFileProblems(map, file, "rendered", ["temperature", "camera_profile"], source)).toEqual([]);
    expect(presetFileProblems(map, file, "raw", ["temperature"], source)).toEqual(["no crs:Temperature", "crs:IncrementalTemperature on a raw photo"]);
    expect(presetFileProblems(map, file, "rendered", ["camera_profile"], { camera_profile: "Monochrome" })).toEqual(["crs:CameraProfile is Default Color, not Default Monochrome"]);
  });
});

describe("npm run phase8:check, Greptile PR #106", () => {
  it("input ending at the restart leaves Part 4 to do; the next run does it and finishes", { timeout: 120000 }, async () => {
    h.stopAt = /3\. Then press Enter here/;
    const first = await runCheck([]);
    expect(first.finished).toBe(false);
    expect(saved().preset).toBeNull();
    h.stopAt = null;
    const second = await runCheck(YES);
    expect(second).toMatchObject({ finished: true, accepted: true });
    expect(saved().preset?.ok).toBe(true);
  });

  it("a user intent overriding a bundled one fails that intent, so the check cannot pass on 10", { timeout: 120000 }, async () => {
    mkdirSync(userIntentsDir(), { recursive: true });
    copyFileSync(new URL("../intents/portrait_natural_light.json", import.meta.url), path.join(userIntentsDir(), "portrait_natural_light.json"));
    const { accepted } = await runCheck(YES);
    expect(accepted).toBe(false);
    expect(saved().intents).toHaveLength(11);
    expect(saved().intents.find((i) => i.intent === "portrait_natural_light")).toMatchObject({ ok: false, summary: { error: expect.objectContaining({ message: expect.stringContaining("a user intent overrides") }) } });
  });

  it("a chat that edited another DSC_0031.JPG fails, and the JPEG held back is put back", { timeout: 120000 }, async () => {
    h.chatOn = UUIDS.jpg;
    const { accepted } = await runCheck(YES);
    expect(accepted).toBe(false);
    expect(saved().chat?.summary["lines"]).toMatchObject({ session_on_the_jpeg: false });
    expect(saved().pending).toEqual([]);
  });

  it("chat logs that cannot be read still let the check take the bridge back and put the JPEG back", { timeout: 120000 }, async () => {
    h.chatLogsThrow = true;
    const { accepted, finished } = await runCheck(YES);
    expect(finished).toBe(true);
    expect(accepted).toBe(false);
    expect(saved().chat?.summary).toMatchObject({ judge_error: expect.anything(), put_back_differing: [] });
    expect(saved().pending).toEqual([]);
    expect(asBefore(UUIDS.copy1, renderedDumps["15.4"].settings)).toBe(true);
  });
});
