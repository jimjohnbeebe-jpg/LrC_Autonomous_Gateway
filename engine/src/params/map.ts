// The canonical parameter map (ARCHITECTURE section 5, PRD FR-4.2): canonical settings <-> SDK keys.
//
// - toSdk() validates canonical settings and returns the SDK table to write. Unknown names,
//   wrong types and out-of-range values are rejected, never guessed.
// - fromSdk() turns a getDevelopSettings() table into canonical settings and names the camera profile.
// - verifyReadback() compares what was written with what Lightroom reports afterwards. Every write
//   is read back (Phase 0, P-12): Lightroom silently ignored a malformed CameraProfile
//   [handle: docs/reports/phase0/S5.md "Part 1 analysis"].
// A process version other than the ones observed is refused (canonical.ts), and so is a photo whose
// settings match neither pipeline (pipeline.ts). Each pipeline has its own specs and its own pinned
// key dump: they differ only in white balance (canonical.ts RENDERED_PARAMS).

import { isDeepStrictEqual } from "node:util";
import { isEmptyLook, type CameraProfiles, type ProfileIdentity } from "./camera-profiles.js";
import { CAMERA_PROFILE_PARAM, CANONICAL_PARAMS, RENDERED_PARAMS, type ParamSpec } from "./canonical.js";
import { tableInfo } from "./mask-table.js";
import { ParamError } from "./param-error.js";
import { PIPELINES, checkProcessVersion, describeSignals, pipelineOf, type Pipeline } from "./pipeline.js";
import { COMPANION_KEYS, CUSTOM_WHITE_BALANCE, WHITE_BALANCE_KEY } from "./preset-keys.js";
import type { SdkKeyMap } from "./sdk-keys.js";
import { EXPECTED_SDK_TYPE, describe, validate } from "./validate.js";

export { ParamError, type ParamErrorCode } from "./param-error.js";

export type CanonicalValue = number | boolean | string | number[];
export type CanonicalSettings = Record<string, CanonicalValue>;
export type SdkSettings = Record<string, unknown>;

/** What a write is for: the photo's process version, pipeline and HDR edit mode (all from its fromSdk read; no `hdr`: off). */
export type WriteContext = { processVersion: string; pipeline: Pipeline; hdr?: boolean };

/**
 * Lightroom's HDR edit mode: 1 on the HDR DNG of issue #187, whose point curves are the ExtendedToneCurvePV2012
 * keys (canonical.ts "Point curves") [handle: docs\reports\phase10\curve-probe\run2\curve_probe_settings_20220828-_DSC1159-HDR.dng__65937445.json];
 * 0 in the raw pin's other four sources (sdk-keys.lrc15.json "sources"). In the S10 census the four dumps with 1 are
 * the four with the extended keys [handle: grep of docs\reports\phase8\S10\census\*.json, 2026-10-25].
 */
const HDR_EDIT_MODE_KEY = "HDREditMode";

/** The SDK key a spec writes and reads: a point curve's extended key on a photo in HDR edit mode. */
function keyOf(spec: ParamSpec, hdr: boolean): string {
  return hdr && spec.kind === "curve" ? spec.hdrSdkKey : spec.sdkKey;
}

const SPECS: Readonly<Record<Pipeline, ReadonlyMap<string, ParamSpec>>> = { raw: CANONICAL_PARAMS, rendered: RENDERED_PARAMS };

export type FromSdkResult = {
  process_version: string;
  /** The photo's pipeline, from its settings (pipeline.ts). */
  pipeline: Pipeline;
  /** HDREditMode is 1: the point curves are read from, and written to, the extended keys (WriteContext.hdr). */
  hdr: boolean;
  /** Canonical settings for every mapped key present; camera_profile only when the pair is pinned. */
  settings: CanonicalSettings;
  camera_profile: ProfileIdentity;
  /**
   * The COMPANION_KEYS Lightroom reported (profile pair, ConvertToGrayscale, WhiteBalance), as read: what no
   * canonical name holds, e.g. an unpinned profile's pair, for a revert to put back (put-back.ts companionsBack).
   */
  companions: SdkSettings;
  /** Keys Lightroom returned that are not in the pinned dump (reported, not fatal). */
  unpinned_keys: string[];
  /** The mask table: how many masks, and a fingerprint that changes when any of it does (mask-table.ts tableInfo). */
  masks: { count: number; fingerprint: string };
};

export type ReadbackMismatch = { sdk_key: string; written: unknown; read_back: unknown };

/** Largest difference between a written and a read-back number that still counts as equal. */
export const READBACK_TOLERANCE = 1e-6;

/**
 * Canonical names whose write also sets the white balance mode to "Custom". Lightroom keeps "As Shot"
 * after a Temperature written alone, so a preset of the photo then leaves its white balance out;
 * written with Temperature or with Tint, "Custom" is taken, the values too, and a Tint write keeps
 * the As Shot temperature [handle: docs\reports\phase4\WB.md "Observed";
 * docs\reports\phase4\WB\wb_check_2026-09-28T12-19-08-508Z.json temperature_alone, temperature_custom, tint_custom].
 */
export const CUSTOM_WHITE_BALANCE_PARAMS: readonly string[] = ["temperature", "tint"];

function isTable(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Equality for values that crossed Lua and JSON. An empty table can arrive as [] or {}. Every field
 * written must read back equal (a missing one is a mismatch), except an empty table inside a table:
 * Lightroom leaves out a Look's empty Parameters.PointColors, so Adobe Landscape on a raw photo failed
 * pass 0 with WRITE_NOT_TAKEN although it was applied [handle: docs\reports\phase8.5\issue108\engine-20261009-excerpt.jsonl,
 * 2026-10-10T05:18:58Z lr_begin_session, details.mismatches; issue #108]. Fields Lightroom adds to a
 * table are its own, not a failed write: it stamps a Look's Parameters.Version with its own version (written
 * "18.5.1", read back "18.7" on LrC 15.6 [handle: https://github.com/jimjohnbeebe-jpg/LrC_Autonomous_Gateway/issues/67
 * "Evidence"; docs\reports\phase6\lrc-version-check\check.txt section 2 "2_look"]).
 * Arrays (curves) compare element by element, length included.
 */
function sdkValuesEqual(written: unknown, readBack: unknown): boolean {
  if (typeof written === "number" && typeof readBack === "number") {
    return Math.abs(written - readBack) <= READBACK_TOLERANCE;
  }
  if (isTable(written) && isTable(readBack)) {
    const writtenEmpty = isEmptyLook(written);
    const readEmpty = isEmptyLook(readBack);
    if (writtenEmpty || readEmpty) return writtenEmpty && readEmpty;
    if (Array.isArray(written) !== Array.isArray(readBack)) return false;
    if (Array.isArray(written) && Array.isArray(readBack) && written.length !== readBack.length) return false;
    for (const k of Object.keys(written)) {
      if (!(k in readBack)) {
        if (isEmptyLook(written[k])) continue;
        return false;
      }
      if (!sdkValuesEqual(written[k], readBack[k])) return false;
    }
    return true;
  }
  return isDeepStrictEqual(written, readBack);
}

/**
 * Equality of two canonical values, numbers (also inside curves) within READBACK_TOLERANCE, so float
 * noise such as 0.83 vs 0.8300000000000001 is not a difference (Greptile, PR #24).
 */
export function canonicalValuesEqual(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= READBACK_TOLERANCE;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => canonicalValuesEqual(v, b[i]));
  return isDeepStrictEqual(a, b);
}

/** The canonical names whose values differ between two settings tables (a name missing on one side differs). */
export function differingSettings(a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => !canonicalValuesEqual(a[k], b[k])).sort();
}

/** Each spec's keys (a point curve's HDR key too) in the pipeline's pinned dump with the expected type, and no key mapped twice. */
function checkSpecs(params: ReadonlyMap<string, ParamSpec>, sdkKeys: SdkKeyMap): void {
  const seen = new Map<string, string>();
  for (const [name, spec] of params) {
    for (const key of new Set([keyOf(spec, false), keyOf(spec, true)])) {
      const entry = sdkKeys.get(key); // throws UnknownSdkKeyError: the key is not in the live dump
      const expected = EXPECTED_SDK_TYPE[spec.kind];
      if (entry.type !== expected) throw new Error(`${name} -> ${key}: the pinned dump has type ${entry.type}, the map expects ${expected}`);
      const other = seen.get(key);
      if (other) throw new Error(`${other} and ${name} both map to ${key}`);
      seen.set(key, name);
    }
  }
}

export class ParamMap {
  private readonly sdkKeys: Readonly<Record<Pipeline, SdkKeyMap>>;
  private readonly profiles: CameraProfiles;

  /** `sdkKeys`: each pipeline's pinned dump (sdk-keys.lrc15.json, sdk-keys.lrc15.rendered.json). */
  constructor(sdkKeys: Readonly<Record<Pipeline, SdkKeyMap>>, profiles: CameraProfiles) {
    for (const p of PIPELINES) {
      checkSpecs(SPECS[p], sdkKeys[p]);
      for (const key of ["CameraProfile", "ProcessVersion", "ConvertToGrayscale", WHITE_BALANCE_KEY, HDR_EDIT_MODE_KEY]) sdkKeys[p].get(key);
    }
    sdkKeys.raw.get("Look"); // rendered photos carry no Look (sdk-keys.lrc15.rendered.json)
    this.sdkKeys = sdkKeys;
    this.profiles = profiles;
  }

  /** Canonical names this map accepts, camera_profile included (the same on both pipelines). */
  names(): string[] {
    return [...CANONICAL_PARAMS.keys(), CAMERA_PROFILE_PARAM];
  }

  /**
   * The spec of a canonical name on a pipeline, or undefined (camera_profile has none: see
   * cameraProfiles()). Only temperature and tint differ between the pipelines.
   */
  spec(name: string, pipeline: Pipeline = "raw"): ParamSpec | undefined {
    return SPECS[pipeline].get(name);
  }

  /** The SDK key a canonical name writes and reads on a photo of `pipeline`, in HDR edit mode or not; undefined for none. */
  sdkKey(name: string, pipeline: Pipeline = "raw", hdr = false): string | undefined {
    const spec = SPECS[pipeline].get(name);
    return spec ? keyOf(spec, hdr) : undefined;
  }

  cameraProfiles(): CameraProfiles {
    return this.profiles;
  }

  /**
   * Validate canonical settings for a photo of `context.pipeline` and return the SDK table to write.
   * A temperature or tint also writes WhiteBalance "Custom" (CUSTOM_WHITE_BALANCE_PARAMS), read back
   * like every other key. A profile of the other pipeline is refused: Lightroom checks that only on
   * the photo loaded in Develop, and stored the raw pair on 30 unselected photos [handle:
   * docs/reports/phase8/S10.md "Observed", "Run 1"], so the engine checks it for every write. With
   * `context.hdr` the point curves go to their extended keys (canonical.ts "Point curves", issue #187).
   */
  toSdk(settings: Readonly<Record<string, unknown>>, context: WriteContext): SdkSettings {
    checkProcessVersion(context.processVersion);
    const out: SdkSettings = {};
    for (const [name, value] of Object.entries(settings)) {
      if (name === CAMERA_PROFILE_PARAM) {
        if (typeof value !== "string") throw new ParamError("wrong_type", `${name} must be a profile name`, name);
        const sdk = this.profiles.toSdk(value); // throws UnknownCameraProfileError
        const its = this.profiles.pipeline(value);
        if (its !== context.pipeline) {
          throw new ParamError("wrong_pipeline", `"${value}" is a ${its}-pipeline profile; this photo is on the ${context.pipeline} pipeline (${this.profileNames(context.pipeline)})`, name);
        }
        Object.assign(out, sdk);
        continue;
      }
      const spec = SPECS[context.pipeline].get(name);
      if (!spec) throw new ParamError("unknown_parameter", `Unknown parameter "${name}"`, name);
      out[keyOf(spec, context.hdr === true)] = validate(name, spec, value);
    }
    if (CUSTOM_WHITE_BALANCE_PARAMS.some((name) => name in settings)) out[WHITE_BALANCE_KEY] = CUSTOM_WHITE_BALANCE;
    return out;
  }

  /** "its profiles: Color, Monochrome" (few) or "N profiles" (many), for messages. */
  private profileNames(pipeline: Pipeline): string {
    const names = this.profiles.names().filter((n) => this.profiles.pipeline(n) === pipeline);
    return names.length <= 4 ? `its profiles: ${names.join(", ")}` : `${names.length} pinned profiles`;
  }

  /** Canonical view of a getDevelopSettings() table. */
  fromSdk(sdk: Readonly<SdkSettings>): FromSdkResult {
    const pv = sdk["ProcessVersion"];
    if (typeof pv !== "string") {
      throw new ParamError("unsupported_process_version", "The settings carry no ProcessVersion string");
    }
    checkProcessVersion(pv);
    const { pipeline, signals } = pipelineOf(sdk);
    if (pipeline === "unknown") {
      throw new ParamError("pipeline_unknown", `This photo's settings match neither the raw nor the rendered pipeline (${describeSignals(signals)}), so the engine does not edit it.`);
    }

    const hdr = sdk[HDR_EDIT_MODE_KEY] === 1;
    const settings: CanonicalSettings = {};
    for (const [name, spec] of SPECS[pipeline]) {
      const key = keyOf(spec, hdr);
      if (!(key in sdk)) continue; // e.g. monochrome profiles drop 18 keys (S5.md "Numbers")
      let value = sdk[key];
      if (spec.kind === "curve" && isEmptyLook(value)) value = []; // Lua's empty table may arrive as {}
      if (describe(value) !== EXPECTED_SDK_TYPE[spec.kind]) {
        throw new ParamError(
          "wrong_type",
          `Lightroom returned ${describe(value)} for ${key}; the pinned dump has ${EXPECTED_SDK_TYPE[spec.kind]}`,
          name,
        );
      }
      settings[name] = value as CanonicalValue;
    }

    // ConvertToGrayscale tells the rendered Monochrome from Color [handle: camera-profiles.lrc15.json
    // "Color", "Monochrome" convert_to_grayscale; docs/reports/phase8/S10.md "Observed"]. A pinned pair of the other
    // pipeline (a raw DNG set to "Embedded") is not named: it was recorded on the other pipeline.
    const identified = this.profiles.identify(sdk["CameraProfile"], sdk["Look"], sdk["ConvertToGrayscale"]);
    const cameraProfile = identified.name !== null && this.profiles.pipeline(identified.name) !== pipeline ? { ...identified, name: null } : identified;
    if (cameraProfile.name !== null) settings[CAMERA_PROFILE_PARAM] = cameraProfile.name;

    return {
      process_version: pv,
      pipeline,
      hdr,
      settings,
      camera_profile: cameraProfile,
      companions: Object.fromEntries(COMPANION_KEYS.filter((k) => k in sdk).map((k) => [k, sdk[k]])),
      unpinned_keys: Object.keys(sdk).filter((k) => !this.sdkKeys[pipeline].has(k)).sort(),
      masks: tableInfo(sdk),
    };
  }

  /** Every written key whose read-back value differs; empty means the write took effect as sent. */
  verifyReadback(written: Readonly<SdkSettings>, readBack: Readonly<SdkSettings>): ReadbackMismatch[] {
    const mismatches: ReadbackMismatch[] = [];
    for (const [key, value] of Object.entries(written)) {
      const got = readBack[key];
      // Writing Look = {} clears the Look, and it then reads back absent
      // [handle: docs/reports/phase0/S5.md "Part 2 analysis"]. Only this top-level Look may be absent.
      const clearedLook = key === "Look" && got === undefined && isEmptyLook(value);
      if (!clearedLook && !sdkValuesEqual(value, got)) {
        mismatches.push({ sdk_key: key, written: value, read_back: got ?? null });
      }
    }
    return mismatches;
  }
}
