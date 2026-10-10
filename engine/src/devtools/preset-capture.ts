// `npm run preset:capture` (PHASE4_PLAN row 9, decision 1A): pins the format of Lightroom's own
// preset file. Jim makes a reference preset in a new group "LrC-AVG" from the selected photo (Create
// Preset, Check All); this reads that photo's settings through the bridge, finds the preset's file
// under %APPDATA%\Adobe\CameraRaw\Settings\ (where S7 found user presets' files [handle:
// docs\reports\phase4\S7.md "Consequences", row 9]) and saves both as test fixtures, with the user
// folder written as %USERPROFILE%. `--precheck` only checks the selected photo, read-only.
// Two raw references [stated: Jim, 2026-09-28, "One more reference"]: the first, from a photo with an
// Adobe profile, wrote no camera profile, so the second is made from a photo with a Nikon Camera
// Matching profile (`--second`). Two rendered references (Phase 8 row 5, PHASE8_PLAN "Propagation"
// [stated: Jim, 2026-10-09, "Go" to the row 5 plan, decision P1 B]): from a JPEG with Custom white
// balance and the profile Color (`--rendered`), and Monochrome (`--rendered-mono`), so the files show
// how Lightroom writes IncrementalTemperature/IncrementalTint and ConvertToGrayscale, true and false,
// into a preset (presets\select.ts leaves both out until then). The engine's writer is tested against
// these files (tests\presets-reference.test.ts).

import { readFileSync } from "node:fs";
import path from "node:path";
import { CUSTOM_WHITE_BALANCE, PROCESS_VERSION_KEY, WHITE_BALANCE_KEY, sdkKeysOf, type ParamMap, type Pipeline, type SdkSettings } from "../params/index.js";
import { findPresetFiles } from "../presets/folder.js";
import { child, parseXml, presetDescription, seqItems, type XmlNode } from "../presets/xmp-parse.js";
import { groupOf, MASK_GROUPS } from "../sync/mask.js";

export const REFERENCE_GROUP = "LrC-AVG";
/**
 * A reference preset: its name in Lightroom, its fixture files' prefix, its photo's pipeline, whether
 * the photo must have an Adobe profile's Look (raw), and for a rendered one the profile it must have
 * and a Custom white balance with Temp and Tint above 0 (so the sign form is observed).
 */
export type ReferenceSpec = { name: string; prefix: string; pipeline: Pipeline; needLook: boolean; profile?: string; customWhiteBalance?: boolean };
export const REFERENCES: Readonly<Record<"first" | "second" | "rendered" | "renderedMono", ReferenceSpec>> = {
  first: { name: "AVG preset reference", prefix: "reference", pipeline: "raw", needLook: true },
  second: { name: "AVG preset reference 2", prefix: "reference-2", pipeline: "raw", needLook: false },
  rendered: { name: "AVG preset reference rendered", prefix: "reference-rendered", pipeline: "rendered", needLook: false, profile: "Color", customWhiteBalance: true },
  renderedMono: { name: "AVG preset reference rendered mono", prefix: "reference-rendered-mono", pipeline: "rendered", needLook: false, profile: "Monochrome", customWhiteBalance: true },
};
export const fixtureXmp = (spec: ReferenceSpec): string => `${spec.prefix}.lrc15.xmp`;
export const fixtureSettings = (spec: ReferenceSpec): string => `${spec.prefix}-settings.lrc15.json`;

export type PhotoInfo = { uuid: string; filename: string | null; lrc_version: string };
export type CaptureIo = {
  photo: () => Promise<PhotoInfo>;
  settings: (uuid: string) => Promise<SdkSettings>;
  /** %APPDATA%\Adobe\CameraRaw\Settings */
  settingsDir: string;
  save: (file: string, text: string) => void;
  now: () => Date;
};
/** worked: the fixtures were saved. problems: why not. findings: what the saved reference lacks or differs in. */
export type Capture = { worked: boolean; problems: string[]; findings: string[]; report: Record<string, unknown> };

/** The SDK keys a preset of every group should carry on a pipeline, by group ("general": the process version). */
export function expectedKeys(map: ParamMap, pipeline: Pipeline = "raw"): Record<string, string[]> {
  const byGroup: Record<string, string[]> = { general: [PROCESS_VERSION_KEY] };
  for (const group of MASK_GROUPS) byGroup[group] = [];
  for (const name of map.names()) {
    const group = groupOf(name);
    if (group !== null) byGroup[group]?.push(...sdkKeysOf(map, name, pipeline));
  }
  byGroup["white_balance"]?.push(WHITE_BALANCE_KEY);
  return byGroup;
}

/**
 * Is the photo a good reference: a supported process version, the spec's pipeline, a pinned profile
 * (with a Look if asked; the named one for a rendered spec), and for a rendered spec a Custom white
 * balance with Temp and Tint above 0?
 */
export function checkPhoto(map: ParamMap, sdk: SdkSettings, spec: Pick<ReferenceSpec, "pipeline" | "needLook" | "profile" | "customWhiteBalance">): { problems: string[]; facts: Record<string, unknown> } {
  const problems: string[] = [];
  let facts: Record<string, unknown> = {};
  try {
    const read = map.fromSdk(sdk);
    const edited = Object.entries(read.settings).filter(([, v]) => typeof v === "number" && v !== 0).length;
    facts = { process_version: read.process_version, pipeline: read.pipeline, camera_profile: read.camera_profile, white_balance: sdk[WHITE_BALANCE_KEY] ?? null, nonzero_numbers: edited };
    if (read.pipeline !== spec.pipeline) {
      problems.push(`the photo is on the ${read.pipeline} pipeline; this reference needs a ${spec.pipeline} one${spec.pipeline === "rendered" ? " (a JPEG)" : ""}`);
      return { problems, facts }; // the other checks would only say the same in other words
    }
    if (spec.needLook && read.camera_profile.look_name === null) problems.push("the photo's profile has no Look: pick a photo with an Adobe profile (e.g. Adobe Color)");
    else if (read.camera_profile.name === null) problems.push(`the photo's profile "${read.camera_profile.camera_profile ?? "?"}" is not one of the pinned profiles`);
    else if (spec.profile !== undefined && read.camera_profile.name !== spec.profile) problems.push(`the photo's profile is ${read.camera_profile.name}; this reference needs ${spec.profile} (Basic panel > Profile)`);
    if (spec.customWhiteBalance) {
      const [temperature, tint] = [read.settings["temperature"], read.settings["tint"]];
      if (sdk[WHITE_BALANCE_KEY] !== CUSTOM_WHITE_BALANCE || typeof temperature !== "number" || temperature <= 0 || typeof tint !== "number" || tint <= 0) {
        problems.push(`the white balance must be Custom with Temp and Tint above 0 (now ${String(sdk[WHITE_BALANCE_KEY])}, ${String(temperature)}, ${String(tint)}): move both sliders to the right`);
      }
    }
  } catch (err) {
    problems.push(`its settings cannot be read: ${(err as Error).message}`);
  }
  return { problems, facts };
}

/** The value Lightroom wrote for `key`, as text, when it is an attribute or a point list. */
function written(description: XmlNode, key: string): string | string[] | undefined {
  return description.attrs.get(`crs:${key}`) ?? seqItems(child(description, `crs:${key}`)) ?? undefined;
}

function sameValue(text: string | string[], value: unknown): boolean {
  if (Array.isArray(text)) return Array.isArray(value) && text.flatMap((p) => p.split(",").map(Number)).join() === value.join();
  if (typeof value === "number") return Number(text) === value;
  if (typeof value === "boolean") return text.toLowerCase() === String(value);
  return text === value;
}

/** Which expected keys the reference lacks (by group), and which differ from the photo's settings. */
export function checkReference(map: ParamMap, xmp: string, sdk: SdkSettings, pipeline: Pipeline = "raw"): { missing: Record<string, string[]>; differ: string[] } {
  const description = presetDescription(parseXml(xmp));
  const missing: Record<string, string[]> = {};
  const differ: string[] = [];
  for (const [group, keys] of Object.entries(expectedKeys(map, pipeline))) {
    for (const key of keys) {
      const present = description.attrs.has(`crs:${key}`) || child(description, `crs:${key}`) !== undefined;
      if (!present) (missing[group] ??= []).push(key);
      const text = written(description, key);
      if (text !== undefined && key in sdk && !sameValue(text, sdk[key])) differ.push(key);
    }
  }
  return { missing, differ };
}

/** What the saved reference lacks or differs in: Claude Code reads these before pinning anything. */
function findingLines(group: string | null, check: ReturnType<typeof checkReference>): string[] {
  const lines: string[] = [];
  if (group !== REFERENCE_GROUP) lines.push(`the preset is in group "${group ?? "(none)"}", not "${REFERENCE_GROUP}"`);
  for (const [name, keys] of Object.entries(check.missing)) lines.push(`the preset file has no ${keys.join(", ")} (group ${name})`);
  return lines;
}

export async function capturePreset(io: CaptureIo, map: ParamMap, options: { precheck: boolean; spec: ReferenceSpec }): Promise<Capture> {
  const { spec } = options;
  const photo = await io.photo();
  const sdk = await io.settings(photo.uuid);
  const { problems, facts } = checkPhoto(map, sdk, spec);
  const report: Record<string, unknown> = { reference_name: spec.name, photo: { filename: photo.filename, ...facts }, lrc_version: photo.lrc_version };
  if (options.precheck) return { worked: problems.length === 0, problems, findings: [], report };

  const found = findPresetFiles(io.settingsDir, spec.name);
  report["found"] = found;
  const only = found.length === 1 ? found[0] : undefined;
  if (!only) problems.push(`found ${found.length} preset files named "${spec.name}", need exactly 1 (${found.map((f) => f.file).join(", ") || "none"})`);
  else if (only.unreadable) problems.push(`${only.file} may be "${spec.name}", but this reader cannot parse it`);
  if (problems.length > 0 || !only) return { worked: false, problems, findings: [], report };

  const xmp = readFileSync(path.join(io.settingsDir, only.file), "utf8");
  const check = checkReference(map, xmp, sdk, spec.pipeline);
  Object.assign(report, { missing: check.missing, differ: check.differ });
  // A value that differs means the preset was made from another photo, or the photo changed since:
  // saving would pair the file with the wrong settings (Greptile, PR #36).
  if (check.differ.length > 0) {
    problems.push(`the preset's values differ from the selected photo's for ${check.differ.join(", ")}: select the photo the preset was made from, unchanged, or make the preset again`);
    return { worked: false, problems, findings: [], report };
  }
  const findings = findingLines(only.group, check);

  io.save(fixtureXmp(spec), xmp);
  const fixture = {
    schema_version: 1,
    generated_by: "engine/src/devtools/preset-capture.ts (npm run preset:capture)",
    captured_at: io.now().toISOString(),
    lrc_version: photo.lrc_version,
    photo: { filename: photo.filename, pipeline: spec.pipeline },
    reference: { file: only.file, name: spec.name, group: only.group, bytes: Buffer.byteLength(xmp) },
    settings: sdk,
  };
  io.save(fixtureSettings(spec), `${JSON.stringify(fixture, null, 2)}\n`);
  return { worked: true, problems, findings, report };
}
