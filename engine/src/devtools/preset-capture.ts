// `npm run preset:capture` (PHASE4_PLAN row 9, decision 1A): pins the format of Lightroom's own
// preset file. Jim makes a reference preset in a new group "LrC-AVG" from the selected photo (Create
// Preset, Check All); this reads that photo's settings through the bridge, finds the preset's file
// under %APPDATA%\Adobe\CameraRaw\Settings\ (where S7 found user presets' files [handle:
// docs\reports\phase4\S7.md "Consequences", row 9]) and saves both as test fixtures, with the user
// folder written as %USERPROFILE%. `--precheck` only checks the selected photo, read-only.
// Two references [stated: Jim, 2026-09-28, "One more reference"]: the first, from a photo with an
// Adobe profile, wrote no camera profile, so the second is made from a photo with a Nikon Camera
// Matching profile (`--second`). The engine's writer is tested against these files
// (tests\presets-reference.test.ts).

import { readFileSync } from "node:fs";
import path from "node:path";
import { PROCESS_VERSION_KEY, WHITE_BALANCE_KEY, sdkKeysOf, type ParamMap, type SdkSettings } from "../params/index.js";
import { findPresetFiles } from "../presets/folder.js";
import { child, parseXml, presetDescription, seqItems, type XmlNode } from "../presets/xmp-parse.js";
import { groupOf, MASK_GROUPS } from "../sync/mask.js";

export const REFERENCE_GROUP = "LrC-AVG";
/** A reference preset: its name in Lightroom, its fixture files' prefix, and whether its photo must have an Adobe profile's Look. */
export type ReferenceSpec = { name: string; prefix: string; needLook: boolean };
export const REFERENCES: Readonly<Record<"first" | "second", ReferenceSpec>> = {
  first: { name: "AVG preset reference", prefix: "reference", needLook: true },
  second: { name: "AVG preset reference 2", prefix: "reference-2", needLook: false },
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

/** The SDK keys a preset of every group should carry, by group ("general": the process version). */
export function expectedKeys(map: ParamMap): Record<string, string[]> {
  const byGroup: Record<string, string[]> = { general: [PROCESS_VERSION_KEY] };
  for (const group of MASK_GROUPS) byGroup[group] = [];
  for (const name of map.names()) {
    const group = groupOf(name);
    if (group !== null) byGroup[group]?.push(...sdkKeysOf(map, name));
  }
  byGroup["white_balance"]?.push(WHITE_BALANCE_KEY);
  return byGroup;
}

/** Is the photo a good reference: a supported process version, a pinned profile (with a Look if asked), edits to read? */
export function checkPhoto(map: ParamMap, sdk: SdkSettings, needLook: boolean): { problems: string[]; facts: Record<string, unknown> } {
  const problems: string[] = [];
  let facts: Record<string, unknown> = {};
  try {
    const read = map.fromSdk(sdk);
    const edited = Object.entries(read.settings).filter(([, v]) => typeof v === "number" && v !== 0).length;
    facts = { process_version: read.process_version, camera_profile: read.camera_profile, nonzero_numbers: edited };
    if (needLook && read.camera_profile.look_name === null) problems.push("the photo's profile has no Look: pick a photo with an Adobe profile (e.g. Adobe Color)");
    else if (read.camera_profile.name === null) problems.push(`the photo's profile "${read.camera_profile.camera_profile ?? "?"}" is not one of the pinned profiles`);
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
export function checkReference(map: ParamMap, xmp: string, sdk: SdkSettings): { missing: Record<string, string[]>; differ: string[] } {
  const description = presetDescription(parseXml(xmp));
  const missing: Record<string, string[]> = {};
  const differ: string[] = [];
  for (const [group, keys] of Object.entries(expectedKeys(map))) {
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
  if (check.differ.length > 0) lines.push(`the preset's values differ from the photo's for ${check.differ.join(", ")}`);
  return lines;
}

export async function capturePreset(io: CaptureIo, map: ParamMap, options: { precheck: boolean; spec: ReferenceSpec }): Promise<Capture> {
  const { spec } = options;
  const photo = await io.photo();
  const sdk = await io.settings(photo.uuid);
  const { problems, facts } = checkPhoto(map, sdk, spec.needLook);
  const report: Record<string, unknown> = { reference_name: spec.name, photo: { filename: photo.filename, ...facts }, lrc_version: photo.lrc_version };
  if (options.precheck) return { worked: problems.length === 0, problems, findings: [], report };

  const found = findPresetFiles(io.settingsDir, spec.name);
  report["found"] = found;
  const only = found.length === 1 ? found[0] : undefined;
  if (!only) problems.push(`found ${found.length} preset files named "${spec.name}", need exactly 1 (${found.map((f) => f.file).join(", ") || "none"})`);
  if (problems.length > 0 || !only) return { worked: false, problems, findings: [], report };

  const xmp = readFileSync(path.join(io.settingsDir, only.file), "utf8");
  const check = checkReference(map, xmp, sdk);
  const findings = findingLines(only.group, check);
  Object.assign(report, { missing: check.missing, differ: check.differ });

  io.save(fixtureXmp(spec), xmp);
  const fixture = {
    schema_version: 1,
    generated_by: "engine/src/devtools/preset-capture.ts (npm run preset:capture)",
    captured_at: io.now().toISOString(),
    lrc_version: photo.lrc_version,
    photo: { filename: photo.filename },
    reference: { file: only.file, name: spec.name, group: only.group, bytes: Buffer.byteLength(xmp) },
    settings: sdk,
  };
  io.save(fixtureSettings(spec), `${JSON.stringify(fixture, null, 2)}\n`);
  return { worked: true, problems, findings, report };
}
