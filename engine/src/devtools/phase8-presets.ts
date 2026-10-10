// The presets of the Phase 8 check (phase8-check.ts; decision D3 A [stated: Jim, 2026-10-10, "Go"]):
//   - every preset Part 1 makes is checked in its file for the form Lightroom writes on the photo's
//     pipeline [handle: docs\reports\phase8\presets-rendered.md "Verdict": a rendered photo's white
//     balance as IncrementalTemperature/IncrementalTint with WhiteBalance "Custom", its profile as
//     CameraProfile "Default Color"/"Default Monochrome" (camera-profiles.lrc15.json
//     preset_camera_profile) with ConvertToGrayscale; a raw photo's as Temperature/Tint], then deleted;
//   - Part 4: the preset Part 3 made from the JPEG is kept, Lightroom restarts once (a new preset file
//     is listed only after a restart [handle: docs\reports\phase4\S7.md Verdict 1]), Jim says whether
//     it is listed, clicks it once on the JPEG, and the check reads the photo back: every setting the
//     preset carries must then match (row 5 left this [unverified]), and the photo is put back.

import { readdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import type { CanonicalSettings, ParamMap, Pipeline } from "../params/index.js";
import { presetIdentity, presetText } from "../presets/index.js";
import { describeError } from "./phase1-check.js";
import { differingIn, errorBody, settingsOf } from "./phase4-config.js";
import { restartLightroom } from "./phase4-preset.js";
import { JPEG, PRESET_PREFIX, holdBack, putBack, selectSettled, yes, type Json, type Phase8Deps, type Run } from "./phase8-config.js";
import { partOf } from "./phase8-state.js";

const has = (text: string, key: string): boolean => new RegExp(`\\bcrs:${key}="`).test(text);
const value = (text: string, key: string): string | null => new RegExp(`\\bcrs:${key}="([^"]*)"`).exec(text)?.[1] ?? null;

/** What in a preset file differs from the form Lightroom writes for the photo's pipeline; empty when none does. */
export function presetFileProblems(map: ParamMap, file: string, pipeline: Pipeline, written: readonly string[], source: Readonly<CanonicalSettings>): string[] {
  const text = presetText(file);
  if (text === null) return ["the preset file cannot be read"];
  const problems: string[] = [];
  if (written.includes("temperature")) {
    const [wb, other] = pipeline === "rendered" ? ["IncrementalTemperature", "Temperature"] : ["Temperature", "IncrementalTemperature"];
    if (!has(text, wb)) problems.push(`no crs:${wb}`);
    if (has(text, other)) problems.push(`crs:${other} on a ${pipeline} photo`);
    if (value(text, "WhiteBalance") !== "Custom") problems.push(`crs:WhiteBalance is ${value(text, "WhiteBalance") ?? "absent"}, not Custom`);
  }
  if (written.includes("camera_profile") && pipeline === "rendered") {
    const profile = source["camera_profile"];
    const expected = typeof profile === "string" ? map.cameraProfiles().get(profile).preset_camera_profile : undefined;
    if (value(text, "CameraProfile") !== expected) problems.push(`crs:CameraProfile is ${value(text, "CameraProfile") ?? "absent"}, not ${String(expected)}`);
    if (!has(text, "ConvertToGrayscale")) problems.push("no crs:ConvertToGrayscale");
  }
  return problems;
}

/** Preset files of the check (names starting PRESET_PREFIX) other than `keep`, deleted before Lightroom restarts and lists them. */
export function deleteStrayPresets(dir: string, keep: string | null): string[] {
  const deleted: string[] = [];
  for (const rel of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
    const text = rel.toLowerCase().endsWith(".xmp") ? presetText(path.join(dir, rel)) : null;
    if (text === null) continue;
    try {
      const { name } = presetIdentity(text);
      if (name !== null && name.startsWith(PRESET_PREFIX) && name !== keep) {
        unlinkSync(path.join(dir, rel));
        deleted.push(name);
      }
    } catch {
      // not a preset this reader parses: not the check's
    }
  }
  return deleted;
}

/** Part 4: the restart, Jim's y/n and click, the read-back, the JPEG put back. */
/** Part 4; false when input ended (the part stays to do). */
export async function presetPart(deps: Phase8Deps, run: Run): Promise<boolean> {
  const kept = run.state.kept_preset;
  const out: Json = { preset: kept?.name ?? null };
  run.results["preset"] = out;
  deps.say("");
  deps.say("Part 4: the preset made from the JPEG, listed after a Lightroom restart and applied by your click.");
  let ok = false;
  // Input that ends (the window closed) is a pause, not a result: Part 4 stays to do, and the next run
  // asks again without repeating Parts 1-3 (Greptile, PR #106).
  let ended = false;
  const watched: Phase8Deps = { ...deps, prompt: async (text) => {
    const line = await deps.prompt(text);
    if (line === null) ended = true;
    return line;
  } };
  try {
    if (!kept) throw new Error("Part 3 made no preset to apply");
    out["stray_deleted"] = deleteStrayPresets(deps.presetDir, kept.name);
    if (await restartLightroom(watched, run)) {
      const listed = await deps.ask(`In the Develop module's Presets panel (left side), open the group "LrC-AVG". Is a preset named "${kept.name}" listed?`);
      out["listed"] = listed;
      ended ||= listed === "no answer";
      ok = listed === "y" && (await clickApplies(watched, run, kept, out));
    }
  } catch (err) {
    out["error"] = errorBody(err);
    run.fail(`Part 4: ${describeError(err)}`);
  }
  if (ended) {
    deps.say("Part 4 stopped: input ended. Run the command again to continue with it.");
    return false;
  }
  out["ok"] = ok;
  run.state.preset = partOf(ok, out);
  run.save();
  deps.say(`Part 4, the preset listed and applied by a click: ${ok ? "WORKED" : "FAILED"}`);
  return true;
}

async function clickApplies(deps: Phase8Deps, run: Run, kept: NonNullable<Run["state"]["kept_preset"]>, out: Json): Promise<boolean> {
  await selectSettled(deps, kept.uuid);
  const held = await holdBack(deps, run, kept.uuid, `${JPEG.filename} (${JPEG.copy_name})`);
  const before = differingIn(kept.written, held.start, kept.source);
  if ((await deps.prompt(`  Lightroom now shows ${held.label}. In the Presets panel, click "${kept.name}" once. Then press Enter here.`)) === null) throw new Error("input ended before the preset was clicked");
  const differing = differingIn(kept.written, (await settingsOf(deps, kept.uuid)).settings, kept.source);
  const back = await putBack(deps, run, held);
  const applies = before.length > 0 && differing.length === 0;
  Object.assign(out, { differed_before: before, differing, applies, put_back_differing: back });
  deps.say(`  Every setting the preset carries matches after the click: ${yes(applies)}${before.length === 0 ? " (not conclusive: nothing differed before)" : ""}; the JPEG put back: ${yes(back.length === 0)}.`);
  if (!applies) run.fail(`the preset did not apply as written${differing.length ? ` (${differing.join(", ")} differ)` : ""}`);
  if (back.length > 0) run.fail(`${held.label} is not back after the click (${back.join(", ")} differ): in the Snapshots panel, click "${held.snapshot_name}"`);
  return applies && back.length === 0;
}
