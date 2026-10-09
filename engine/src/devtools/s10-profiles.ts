// Spike S10, the profile, lens and white-balance writes (s10-config.ts has the plan).
// - The profile pairs come from what S10Recorder.lua recorded while Jim clicked profiles on a
//   rendered photo (the S5 recorder, plugin\spikes\S5.lrplugin\S5Recorder.lua, pointed at S10's
//   folder): each (CameraProfile, Look) pair is written and read back, as spike S5 did for the raw
//   pairs [handle: docs\reports\phase0\S5.md "Part 2 analysis"]. The raw "Adobe Color" pair is written
//   too, as a control: on a rendered photo Lightroom kept "Embedded" [handle: logs\20261008-774c64.json].
// - The lens switches are written off then on through the params map (Phase 1 step 6).
// - A Custom white balance is written with the photo's own white-balance keys: Temperature/Tint on
//   raw (the Phase 4 WB check [handle: docs\reports\phase4\WB.md]), and on rendered the keys beyond
//   the raw pin whose names carry "Temperature" or "Tint" (read from the dump, never typed here).

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { CAMERA_PROFILE_KEY, CUSTOM_WHITE_BALANCE, PROFILE_KEYS, SUPPORTED_PROCESS_VERSIONS, WHITE_BALANCE_KEY, isEmptyLook, type SdkSettings } from "../params/index.js";
import { shifted } from "./wb-check.js";
import type { Json } from "./phase3-config.js";
import { answered, historyName, same, write, type Ctx, type Photo } from "./s10-config.js";

/** The raw pair written as the control, pinned by S5. */
export const RAW_CONTROL_PROFILE = "Adobe Color";
export const WB_SHIFT = { raw: { temperature: 300, tint: 5 }, rendered: 20 } as const;
const LOOK_KEY = PROFILE_KEYS[1] as string;

/**
 * The file S10Recorder.lua writes (S5Recorder.lua's shape). `profile_settings` is the table the
 * recorder read for the profile, written back verbatim: CameraProfile, Look (absent when the photo
 * had none: a nil field is no field in Lua) and ConvertToGrayscale, since on the rendered pipeline
 * Monochrome is ConvertToGrayscale = true with CameraProfile "Embedded" and no Look [handle: Jim's
 * run 1, %TEMP%\LrC-AVG\S10\run1\s10_profiles_recorded_2026-10-09T04_54_46.json, key_count 154 against
 * 172 in colour; census dump s10_DSC_0031.JPG__AAFDE261.json ConvertToGrayscale true, Look absent].
 */
const recordedSchema = z.object({
  recorder: z.string(),
  started_at: z.string(),
  captures: z.array(z.looseObject({ filename: z.string(), file_format: z.unknown(), camera_profile: z.unknown(), look: z.unknown().optional(), convert_to_grayscale: z.unknown().optional(), profile_settings: z.record(z.string(), z.unknown()).optional(), process_version: z.unknown() })),
});
export type RecordedPair = { name: string; camera_profile: string; look: Record<string, unknown> | null; look_uuid: string | null; grayscale: boolean; settings: SdkSettings; recorded_on: string };
export type Recorded = { file: string | null; pairs: RecordedPair[]; problems: string[] };

/** The newest recorder file in `dir`, its pairs deduplicated by (CameraProfile, Look UUID, ConvertToGrayscale). */
export function readRecorded(dir: string): Recorded {
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => /^s10_profiles_recorded_.*\.json$/.test(f)).sort();
  } catch {
    files = [];
  }
  const newest = files[files.length - 1];
  if (!newest) return { file: null, pairs: [], problems: [`no recorder file in ${dir}: run the S10 plugin's menu items 1 and 2 first (spikes\\S10\\README.md)`] };
  const file = path.join(dir, newest);
  const parsed = recordedSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (!parsed.success) return { file, pairs: [], problems: [`${newest} is not a recorder file: ${parsed.error.message}`] };
  const pairs: RecordedPair[] = [];
  const problems: string[] = [];
  for (const c of parsed.data.captures) {
    if (typeof c.camera_profile !== "string") {
      problems.push(`a capture on ${c.filename} has no CameraProfile string`);
      continue;
    }
    const look = isEmptyLook(c.look) ? null : (c.look as Record<string, unknown>);
    const uuid = typeof look?.["UUID"] === "string" ? (look["UUID"] as string) : null;
    const grayscale = c.convert_to_grayscale === true;
    if (pairs.some((p) => p.camera_profile === c.camera_profile && p.look_uuid === uuid && p.grayscale === grayscale)) continue;
    // The settings written back: the recorder's table, else (a file from before it carried one) the pair alone.
    const settings: SdkSettings = c.profile_settings ?? { [CAMERA_PROFILE_KEY]: c.camera_profile, [LOOK_KEY]: look ?? {} };
    const lookName = typeof look?.["Name"] === "string" ? (look["Name"] as string) : null;
    pairs.push({ name: lookName ?? (grayscale ? `${c.camera_profile} + ConvertToGrayscale` : c.camera_profile), camera_profile: c.camera_profile, look, look_uuid: uuid, grayscale, settings, recorded_on: c.filename });
  }
  return { file, pairs, problems };
}

/** Write one pair and read it back: taken when both the CameraProfile string and the Look UUID came back. */
async function tryPair(ctx: Ctx, photo: Photo, labelText: string, settings: SdkSettings, n: number, of: number): Promise<Json> {
  const { map } = ctx.deps;
  const lookUuid = (look: unknown): string | null => (typeof look === "object" && look !== null && typeof (look as Json)["UUID"] === "string" ? ((look as Json)["UUID"] as string) : null);
  const others = Object.entries(settings).filter(([k]) => k !== CAMERA_PROFILE_KEY && k !== LOOK_KEY);
  const w: Json = { label: labelText, written: { camera_profile: settings[CAMERA_PROFILE_KEY], look_uuid: lookUuid(settings[LOOK_KEY]), ...Object.fromEntries(others) } };
  const rb = await write(ctx, photo, settings, historyName("profile", n, of), w);
  if (!rb) return w;
  const id = map.cameraProfiles().identify(rb[CAMERA_PROFILE_KEY], rb[LOOK_KEY]);
  w["read_back"] = { camera_profile: id.camera_profile, look_name: id.look_name, look_uuid: id.look_uuid, pinned_name: id.name, ...Object.fromEntries(others.map(([k]) => [k, rb[k] ?? null])) };
  w["taken"] = rb[CAMERA_PROFILE_KEY] === settings[CAMERA_PROFILE_KEY] && id.look_uuid === lookUuid(settings[LOOK_KEY]) && others.every(([k, v]) => rb[k] === v);
  w["keys_dropped"] = Object.keys(photo.start).filter((k) => !(k in rb));
  w["keys_appeared"] = Object.keys(rb).filter((k) => !(k in photo.start));
  return w;
}

/** The recorded pairs, the raw control pair, then the Look cleared with the photo's own CameraProfile. */
export async function profileWrites(ctx: Ctx, photo: Photo, recorded: Recorded): Promise<Json> {
  const { map, ask } = ctx.deps;
  const of = recorded.pairs.length + 2;
  const pairs: Json[] = [];
  for (const [i, p] of recorded.pairs.entries()) {
    const w = await tryPair(ctx, photo, `recorded: ${p.name}`, p.settings, i + 1, of);
    if (photo.selected && w["taken"] !== undefined) w["jim"] = { panel_reads_name: answered(await ask(`  In Lightroom's Basic panel, does Profile read "${p.name}" now?`)) };
    pairs.push(w);
  }
  pairs.push(await tryPair(ctx, photo, `control: raw pair ${RAW_CONTROL_PROFILE}`, map.cameraProfiles().toSdk(RAW_CONTROL_PROFILE), of - 1, of));
  pairs.push(await tryPair(ctx, photo, "Look cleared, CameraProfile as at the start", { [CAMERA_PROFILE_KEY]: photo.start[CAMERA_PROFILE_KEY], [LOOK_KEY]: {} }, of, of));
  return { recorded_file: recorded.file, problems: recorded.problems, pairs };
}

/** The lens switches off, then on; which lens keys appear. */
export async function lensWrites(ctx: Ctx, photo: Photo): Promise<Json> {
  const { map } = ctx.deps;
  // toSdk only checks the version it is given (map.ts); the photo's own may be one this spike is recording (e.g. "11.0").
  const pv = SUPPORTED_PROCESS_VERSIONS[0] as string;
  const steps: Array<[string, SdkSettings]> = [
    ["lens off", map.toSdk({ "lens.corrections_enable": false, "lens.profile_enable": 0 }, { processVersion: pv })],
    ["lens on", map.toSdk({ "lens.corrections_enable": true, "lens.profile_enable": 1 }, { processVersion: pv })],
  ];
  const out: Json[] = [];
  for (const [i, [labelText, settings]] of steps.entries()) {
    const w: Json = { label: labelText, written: settings };
    const rb = await write(ctx, photo, settings, historyName("lens", i + 1, 2), w);
    if (rb) {
      w["mismatches"] = map.verifyReadback(settings, rb);
      w["taken"] = (w["mismatches"] as unknown[]).length === 0;
      w["keys_appeared"] = Object.keys(rb).filter((k) => !(k in photo.start));
      w["lens_keys"] = Object.fromEntries(Object.entries(rb).filter(([k]) => k.startsWith("Lens") || k.startsWith("EnableLens")));
    }
    out.push(w);
  }
  return { steps: out };
}

/** A Custom white balance with the photo's own white-balance keys moved; on the selected photo Jim reads the panel. */
export async function whiteBalanceWrite(ctx: Ctx, photo: Photo): Promise<Json> {
  const { map, ask } = ctx.deps;
  let values: SdkSettings;
  if (photo.pipeline === "raw") {
    const t = map.spec("temperature");
    const n = map.spec("tint");
    if (t?.kind !== "number" || n?.kind !== "number") throw new Error("the params map has no temperature/tint");
    values = { [t.sdkKey]: shifted(map, "temperature", Number(photo.start[t.sdkKey]), WB_SHIFT.raw.temperature), [n.sdkKey]: shifted(map, "tint", Number(photo.start[n.sdkKey]), WB_SHIFT.raw.tint) };
  } else {
    const keys = photo.extra_keys.filter((k) => /Temperature|Tint/.test(k) && typeof photo.start[k] === "number");
    if (keys.length === 0) return { keys: [], note: "no white-balance key beyond the raw pin on this photo" };
    values = Object.fromEntries(keys.map((k) => [k, Number(photo.start[k]) + WB_SHIFT.rendered]));
  }
  const settings = { ...values, [WHITE_BALANCE_KEY]: CUSTOM_WHITE_BALANCE };
  const w: Json = { keys: Object.keys(values), written: settings };
  const rb = await write(ctx, photo, settings, historyName("wb", 1, 1), w);
  if (!rb) return w;
  w["white_balance"] = rb[WHITE_BALANCE_KEY] ?? null;
  w["custom_taken"] = rb[WHITE_BALANCE_KEY] === CUSTOM_WHITE_BALANCE;
  w["values_taken"] = Object.entries(values).every(([k, v]) => same(rb[k], Number(v)));
  w["mismatches"] = map.verifyReadback(settings, rb);
  if (photo.selected) {
    const first = Object.entries(values)[0] as [string, unknown];
    w["jim"] = {
      panel_custom: answered(await ask(`  In the Basic panel, does WB read "${CUSTOM_WHITE_BALANCE}"?`)),
      temp_slider: answered(await ask(`  Does the Temp slider read ${String(first[1])}?`)),
    };
  }
  return w;
}
