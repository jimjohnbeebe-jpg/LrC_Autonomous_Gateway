// Spike S14, parts d and e (s14-config.ts has the plan). e: the seven Calibration keys, pinned in
// both dumps [handle: engine\src\params\sdk-keys.lrc15.json, sdk-keys.lrc15.rendered.json] but with
// no pinned limits, probed at CANDIDATE_LIMIT and 1 % beyond (s10-probe.ts rangeProbeOf). d: the
// photo set to its pipeline's Monochrome profile (the pinned pair: Adobe Monochrome on raw,
// Monochrome = "Embedded" + ConvertToGrayscale on rendered [handle: camera-profiles.lrc15.json]);
// the settings it then carries are saved as a dump in the S5 shape, so row 2 can pin the GrayMixer*
// keys from it (S10 saw eight appear on rendered Monochrome [handle: docs\reports\phase8\S10.md
// "Profiles"]), and the keys that appeared are probed the same way. Monochrome runs last on a photo:
// it drops the colour keys (S10).

import { writeFileSync } from "node:fs";
import path from "node:path";
import type { SdkSettings } from "../params/index.js";
import type { Json } from "./phase3-config.js";
import { dumpName, summary } from "./s10-census.js";
import { write, type Ctx, type Photo } from "./s10-config.js";
import { rangeProbeOf, type Candidate } from "./s10-probe.js";
import { rgbToHs } from "./s14-charts.js";
import { history, readOf, renderGrid, takenAll } from "./s14-config.js";

/** The Calibration panel's keys, as the pinned dumps name them. */
export const CALIBRATION_KEYS = ["ShadowTint", "RedHue", "RedSaturation", "GreenHue", "GreenSaturation", "BlueHue", "BlueSaturation"] as const;
/** The limit we expect of the Calibration and B&W sliders [unverified: Lightroom's slider ends, not observed]. */
export const CANDIDATE_LIMIT = 100;
const candidate = (key: string): Candidate => ({ name: key, sdkKey: key, min: -CANDIDATE_LIMIT, max: CANDIDATE_LIMIT });

export async function calibrationProbe(ctx: Ctx, photo: Photo): Promise<Json> {
  return rangeProbeOf(ctx, photo, CALIBRATION_KEYS.map(candidate), history("calibration"));
}

export const monochromeProfile = (photo: Photo): string => (photo.pipeline === "raw" ? "Adobe Monochrome" : "Monochrome");

const mixerKeys = (s: SdkSettings): string[] => Object.keys(s).filter((k) => k.startsWith("GrayMixer") && typeof s[k] === "number").sort();

/** The mean HSV saturation of the photo's render (8 x 8 cells): near 0 once it renders in black and white. */
async function renderSat(ctx: Ctx, photo: Photo): Promise<number> {
  const cells = await renderGrid(ctx, photo, 8, 8);
  return Math.round((cells.reduce((s, c) => s + rgbToHs(c).sat, 0) / cells.length) * 1000) / 1000;
}

/** One monochrome write: what was read back, and how saturated the render is after it. */
async function monoStep(ctx: Ctx, photo: Photo, settings: SdkSettings, n: number, steps: Json[]): Promise<SdkSettings | null> {
  const step: Json = { written_keys: Object.keys(settings) };
  steps.push(step);
  const rb = await write(ctx, photo, settings, history("monochrome")(n, 2), step);
  if (!rb) return null;
  const { Look: _look, ...plain } = settings;
  Object.assign(step, { taken: takenAll(plain, rb), profile_read: readOf({ CameraProfile: 0, ConvertToGrayscale: 0 }, rb), mixer_keys: mixerKeys(rb), render_sat: await renderSat(ctx, photo) });
  return rb;
}

/**
 * The pinned pair first, as the engine writes it. On the raw NEF in Jim's first run it was taken but
 * left ConvertToGrayscale false and brought no GrayMixer key [handle: docs\reports\phase10\S14\run1\
 * s14_check_2026-10-25T22-59-10-152Z.json photos[0].mixer]; so when no GrayMixer key appears,
 * ConvertToGrayscale true is written as well, and each step's render saturation says whether the
 * photo turned black and white.
 */
export async function mixerProbe(ctx: Ctx, photo: Photo): Promise<Json> {
  const profile = monochromeProfile(photo);
  const steps: Json[] = [];
  const out: Json = { profile, start_render_sat: await renderSat(ctx, photo), steps };
  let rb = await monoStep(ctx, photo, ctx.deps.map.cameraProfiles().toSdk(profile), 1, steps);
  if (rb && mixerKeys(rb).length === 0) rb = await monoStep(ctx, photo, { ConvertToGrayscale: true }, 2, steps);
  if (!rb) return { ...out, completed: false };
  // From the read-back, not the keys that appeared: a photo already on a monochrome profile carries them from the start (Greptile, PR #197).
  const mixer = mixerKeys(rb);
  const dump = path.join(ctx.deps.dumpDir, dumpName(photo).replace(/^s10_/, "s14_monochrome_"));
  const meta = { spike: "S14", ...summary({ ...photo, start: rb }), profile, captured_at: (ctx.deps.now ?? (() => new Date()))().toISOString() };
  writeFileSync(dump, `${JSON.stringify({ meta, settings: rb }, null, 2)}\n`);
  const range = mixer.length > 0 ? await rangeProbeOf(ctx, { ...photo, start: rb }, mixer.map(candidate), history("mixer")) : { parameters: 0, completed: false, note: "no GrayMixer key appeared" };
  Object.assign(out, {
    keys_appeared: Object.keys(rb).filter((k) => !(k in photo.start)).sort(),
    keys_dropped: Object.keys(photo.start).filter((k) => !(k in rb)).sort(),
    mixer_keys: mixer,
    mixer_start: Object.fromEntries(mixer.map((k) => [k, rb[k]])),
    dump: path.basename(dump),
    range,
  });
  return { ...out, completed: range["completed"] === true };
}
