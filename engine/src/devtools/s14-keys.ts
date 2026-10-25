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
import { history, readOf, takenAll } from "./s14-config.js";

/** The Calibration panel's keys, as the pinned dumps name them. */
export const CALIBRATION_KEYS = ["ShadowTint", "RedHue", "RedSaturation", "GreenHue", "GreenSaturation", "BlueHue", "BlueSaturation"] as const;
/** The limit we expect of the Calibration and B&W sliders [unverified: Lightroom's slider ends, not observed]. */
export const CANDIDATE_LIMIT = 100;
const candidate = (key: string): Candidate => ({ name: key, sdkKey: key, min: -CANDIDATE_LIMIT, max: CANDIDATE_LIMIT });

export async function calibrationProbe(ctx: Ctx, photo: Photo): Promise<Json> {
  return rangeProbeOf(ctx, photo, CALIBRATION_KEYS.map(candidate), history("calibration"));
}

export const monochromeProfile = (photo: Photo): string => (photo.pipeline === "raw" ? "Adobe Monochrome" : "Monochrome");

export async function mixerProbe(ctx: Ctx, photo: Photo): Promise<Json> {
  const profile = monochromeProfile(photo);
  const settings: SdkSettings = ctx.deps.map.cameraProfiles().toSdk(profile);
  const out: Json = { profile };
  const rb = await write(ctx, photo, settings, history("monochrome")(1, 1), out);
  if (!rb) return { ...out, completed: false };
  const appeared = Object.keys(rb).filter((k) => !(k in photo.start)).sort();
  const mixer = appeared.filter((k) => k.startsWith("GrayMixer") && typeof rb[k] === "number");
  const dump = path.join(ctx.deps.dumpDir, dumpName(photo).replace(/^s10_/, "s14_monochrome_"));
  const meta = { spike: "S14", ...summary({ ...photo, start: rb }), profile, captured_at: (ctx.deps.now ?? (() => new Date()))().toISOString() };
  writeFileSync(dump, `${JSON.stringify({ meta, settings: rb }, null, 2)}\n`);
  const range = mixer.length > 0 ? await rangeProbeOf(ctx, { ...photo, start: rb }, mixer.map(candidate), history("mixer")) : { parameters: 0, completed: false, note: "no GrayMixer key appeared" };
  Object.assign(out, {
    taken: takenAll({ CameraProfile: settings["CameraProfile"], ...("ConvertToGrayscale" in settings ? { ConvertToGrayscale: settings["ConvertToGrayscale"] } : {}) }, rb),
    profile_read: readOf({ CameraProfile: 0, ConvertToGrayscale: 0 }, rb),
    keys_appeared: appeared,
    keys_dropped: Object.keys(photo.start).filter((k) => !(k in rb)).sort(),
    mixer_keys: mixer,
    mixer_start: Object.fromEntries(mixer.map((k) => [k, rb[k]])),
    dump: path.basename(dump),
    range,
  });
  return { ...out, completed: range["completed"] === true };
}
