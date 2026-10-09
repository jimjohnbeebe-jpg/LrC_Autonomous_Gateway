// The preset in the Phase 4 check (phase4-check.ts; PHASES.md Phase 4: "a preset appears in the
// Develop Presets panel after Lightroom restart at most"). lr_create_preset_from_active writes an
// .xmp preset file that Lightroom lists only after it restarts [handle: docs\reports\phase4\S7.md
// Verdict 1]. Row 9 left [unverified]: that the file shows and applies, CameraProfile without its
// digest, and Temperature/Tint with a Custom white balance. So:
//   1. the pick of the Variants session gets the photo's own profile back, Camera Neutral [handle:
//      docs\reports\phase3\PHASE3.md:213] (the intent's pass 0 gave it Adobe Landscape [handle:
//      engine\intents\landscape_golden_hour.json profile.raw], an Adobe profile, which a
//      preset leaves out: presets\select.ts), and a custom white balance (+300 K); then the preset is
//      saved from it. It writes the Nikon profile as CameraProfile without a digest [handle:
//      engine\src\presets\select.ts entryOf];
//   2. Jim restarts Lightroom; the check waits for the plugin to connect again;
//   3. Jim says whether the preset is listed (y/n);
//   4. the check selects a copy whose settings differ from the preset's (it gives the copy another
//      Nikon profile first, so the profile must change too), Jim clicks the preset once, and
//      the check reads the copy back: every setting the preset wrote must now match [stated: Jim,
//      2026-09-28, plan decision 2: Jim's click and a read-back, no plugin command].

import { WHITE_BALANCE_KEY, type CanonicalSettings } from "../params/index.js";
import { yn } from "./phase3-config.js";
import type { Picked } from "./phase4-variants.js";
import {
  PREPARE_HISTORY_NAME,
  RESTART_TIMEOUT_MS,
  WB_SHIFT,
  WRITE_TIMEOUT_MS,
  copyOf,
  differingIn,
  errorBody,
  failLine,
  ms,
  select,
  settingsOf,
  type Json,
  type Phase4Deps,
  type Photo,
  type Run,
} from "./phase4-config.js";

/** The preset as written: its name, the canonical names it carries and their values on the photo it came from. */
export type PresetMade = { name: string; written: string[]; source: CanonicalSettings };
/** The copy the preset is applied to. */
export type ApplyTarget = { uuid: string; copy_name: string };

const PROFILE_HISTORY_NAME = "AVG P4check preset target profile";
/** The preset's profile: the photo's own (above). */
const PRESET_PROFILE = "Camera Neutral";
/** The target's profile before the click: a Nikon profile whose write S5 verified [handle: engine\src\params\camera-profiles.lrc15.json "Camera Landscape" write_verified]. */
const TARGET_PROFILE = "Camera Landscape";

export const presetName = (stamp: string): string => `AVG P4check ${stamp}`;

/** 1. A custom white balance on the pick, then the preset from it (the pick is the selected photo). */
export async function makePreset(deps: Phase4Deps, run: Run, photo: Photo, pick: Picked): Promise<PresetMade | null> {
  const out: Json = { ok: false };
  run.results["preset"] = out;
  try {
    out["source_prepared"] = await prepareSource(deps, photo, pick);
    const active = await deps.client.request("get_context", {});
    if (active.uuid !== pick.uuid) await select(deps, pick.uuid, copyOf(photo, pick.copy_name));
    const name = presetName(deps.stamp);
    const res = (await deps.tools.createPresetFromActive({ name })).json;
    run.preset = { name, path: String(res["path"]) };
    const written = (res["written"] as string[] | undefined) ?? [];
    const source = (await settingsOf(deps, pick.uuid)).settings;
    Object.assign(out, { ok: true, name, path: res["path"], group: res["group"], written, left_out: res["left_out"], camera_profile_written: written.includes("camera_profile"), temperature_written: written.includes("temperature") });
    deps.say(`  Preset "${name}" written (${written.length} settings; camera profile: ${yn(written.includes("camera_profile"))}; temperature and tint: ${yn(written.includes("temperature"))}).`);
    return { name, written, source };
  } catch (err) {
    out["error"] = errorBody(err);
    run.fail(failLine("the preset", err));
    return null;
  }
}

/**
 * The pick's profile set to PRESET_PROFILE and its temperature moved by WB_SHIFT. In the Phase 4 run
 * the temperature went alone and Lightroom kept "As Shot" [handle: docs\reports\phase4\PHASE4.md
 * "Numbers", the preset row]; from engine 0.6.1 toSdk writes WhiteBalance "Custom" with it, which
 * Lightroom takes [handle: docs\reports\phase4\WB.md "Observed"]. `white_balance_after` records it.
 */
async function prepareSource(deps: Phase4Deps, photo: Photo, pick: Picked): Promise<Json> {
  const now = (await settingsOf(deps, pick.uuid)).settings;
  const spec = deps.map.spec("temperature");
  const from = now["temperature"];
  const temperature = typeof from === "number" && spec?.kind === "number" ? (from + WB_SHIFT <= spec.max ? from + WB_SHIFT : from - WB_SHIFT) : null;
  const values = { camera_profile: PRESET_PROFILE, ...(temperature !== null ? { temperature } : {}) };
  const settings = deps.map.toSdk(values, { processVersion: photo.process_version, pipeline: "raw" });
  const res = await deps.client.request("apply_settings", { photo_uuid: pick.uuid, settings, history_name: PREPARE_HISTORY_NAME }, { timeoutMs: WRITE_TIMEOUT_MS });
  return { camera_profile: { from: now["camera_profile"] ?? null, to: PRESET_PROFILE }, temperature: { from: from ?? null, to: temperature }, white_balance_after: res.read_back[WHITE_BALANCE_KEY] ?? null };
}

/** 2. Jim quits and starts Lightroom; true once the plugin has connected again. */
export async function restartLightroom(deps: Phase4Deps, run: Run): Promise<boolean> {
  const out: Json = { ok: false };
  run.results["restart"] = out;
  deps.say("");
  deps.say("Lightroom restart: Lightroom lists a new preset only after it starts again.");
  deps.say("  1. In Lightroom: File > Exit. Wait until Lightroom has closed.");
  deps.say("  2. Start Lightroom again (Start menu > Adobe Lightroom Classic) and open the Develop module.");
  const before = deps.client.stats.connects;
  if ((await deps.prompt("  3. Then press Enter here.")) === null) {
    run.fail("input ended before Lightroom was restarted");
    return false;
  }
  deps.say("  Waiting for the LrC-AVG plugin to connect again (up to 3 minutes)...");
  const started = performance.now();
  const ok = await waitForNewConnection(deps, before, deps.restartTimeoutMs ?? RESTART_TIMEOUT_MS);
  Object.assign(out, { ok, connects_before: before, connects_after: deps.client.stats.connects, wait_ms: ms(started), plugin_version: deps.client.hello()?.plugin_version ?? null });
  deps.say(ok ? `  Connected again (plugin ${String(out["plugin_version"])}).` : "  The plugin did not connect again.");
  if (!ok) run.fail("the LrC-AVG plugin did not connect again after the restart. Check that Lightroom is running with the Develop module open, then tell Claude Code.");
  return ok;
}

/** A connection made after `before` (the client counts each handshake), within `timeoutMs`. */
async function waitForNewConnection(deps: Phase4Deps, before: number, timeoutMs: number): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (deps.client.stats.connects > before && deps.client.getState() === "connected") return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

/** 3. Jim: is the preset listed? */
export async function presetListed(deps: Phase4Deps, run: Run, preset: PresetMade): Promise<boolean> {
  const answer = await deps.ask(`2. In the Develop module's Presets panel (left side), open the group "LrC-AVG". Is a preset named "${preset.name}" listed?`);
  Object.assign(run.results["preset"] as Json, { listed_after_restart: answer });
  return answer === "y";
}

/** 4. Jim clicks the preset on the copy; every setting it wrote must then read back as the preset's photo had it. */
export async function presetApplies(deps: Phase4Deps, run: Run, photo: Photo, preset: PresetMade, target: ApplyTarget): Promise<boolean> {
  const out: Json = { ok: false, target };
  (run.results["preset"] as Json)["apply"] = out;
  try {
    await select(deps, target.uuid, copyOf(photo, target.copy_name));
    out["profile_moved"] = await moveProfile(deps, photo, preset, target);
    const before = differingIn(preset.written, (await settingsOf(deps, target.uuid)).settings, preset.source);
    if ((await deps.prompt(`  Lightroom now shows the copy "${target.copy_name}". In the Presets panel, click "${preset.name}" once. Then press Enter here.`)) === null) throw new Error("input ended before the preset was clicked");
    const differing = differingIn(preset.written, (await settingsOf(deps, target.uuid)).settings, preset.source);
    const ok = before.length > 0 && differing.length === 0;
    Object.assign(out, { ok, differed_before: before, differing });
    deps.say(`  The preset applied: every setting it carries now matches: ${yn(ok)}${before.length === 0 ? " (not conclusive: nothing differed before the click)" : ` (${before.length} differed before the click)`}.`);
    if (!ok) run.fail(`the preset did not apply as written${differing.length ? ` (${differing.join(", ")} differ)` : ""}`);
    return ok;
  } catch (err) {
    out["error"] = errorBody(err);
    run.fail(failLine("applying the preset", err));
    return false;
  }
}

/** Steps 1-4 in order; each needs the one before. `target`: the copy to apply the preset to (null when the check has none). */
export async function presetCheck(deps: Phase4Deps, run: Run, photo: Photo, pick: Picked, target: ApplyTarget | null): Promise<{ made: boolean; listed: boolean; applies: boolean }> {
  const preset = await makePreset(deps, run, photo, pick);
  if (!preset) return { made: false, listed: false, applies: false };
  if (!(await restartLightroom(deps, run))) return { made: true, listed: false, applies: false };
  const listed = await presetListed(deps, run, preset);
  if (!listed || !target) {
    if (!target) run.fail("the preset could not be applied: the check has no copy to apply it to");
    return { made: true, listed, applies: false };
  }
  return { made: true, listed, applies: await presetApplies(deps, run, photo, preset, target) };
}

/** The target takes TARGET_PROFILE when the preset carries a profile, so the click must change the profile too. */
async function moveProfile(deps: Phase4Deps, photo: Photo, preset: PresetMade, target: ApplyTarget): Promise<Json | null> {
  if (!preset.written.includes("camera_profile")) return null;
  const settings = deps.map.toSdk({ camera_profile: TARGET_PROFILE }, { processVersion: photo.process_version, pipeline: "raw" });
  await deps.client.request("apply_settings", { photo_uuid: target.uuid, settings, history_name: PROFILE_HISTORY_NAME }, { timeoutMs: WRITE_TIMEOUT_MS });
  return { to: TARGET_PROFILE, preset: preset.source["camera_profile"] ?? null };
}
