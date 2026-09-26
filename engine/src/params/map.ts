// The canonical parameter map (ARCHITECTURE section 5, PRD FR-4.2): canonical settings <-> SDK keys.
//
// - toSdk() validates canonical settings and returns the SDK table to write. Unknown names,
//   wrong types and out-of-range values are rejected, never guessed.
// - fromSdk() turns a getDevelopSettings() table into canonical settings and names the camera profile.
// - verifyReadback() compares what was written with what Lightroom reports afterwards. Every write
//   is read back (Phase 0, P-12): Lightroom silently ignored a malformed CameraProfile
//   [handle: docs/reports/phase0/S5.md "Part 1 analysis"].
// A process version other than the ones observed is refused (canonical.ts).

import { isDeepStrictEqual } from "node:util";
import { isEmptyLook, type CameraProfiles, type ProfileIdentity } from "./camera-profiles.js";
import {
  CAMERA_PROFILE_PARAM,
  CANONICAL_PARAMS,
  SUPPORTED_PROCESS_VERSIONS,
  type ParamSpec,
} from "./canonical.js";
import type { SdkKeyMap, SdkValueType } from "./sdk-keys.js";

export type CanonicalValue = number | boolean | string | number[];
export type CanonicalSettings = Record<string, CanonicalValue>;
export type SdkSettings = Record<string, unknown>;

export type ParamErrorCode =
  | "unknown_parameter"
  | "wrong_type"
  | "out_of_range"
  | "unsupported_process_version";

/** A structured error ({code, message, recoverable}, PRD NFR-7). */
export class ParamError extends Error {
  readonly code: ParamErrorCode;
  readonly parameter: string | null;
  readonly recoverable = false;

  constructor(code: ParamErrorCode, message: string, parameter: string | null = null) {
    super(message);
    this.name = "ParamError";
    this.code = code;
    this.parameter = parameter;
  }
}

export type FromSdkResult = {
  process_version: string;
  /** Canonical settings for every mapped key present; camera_profile only when the pair is pinned. */
  settings: CanonicalSettings;
  camera_profile: ProfileIdentity;
  /** Keys Lightroom returned that are not in the pinned dump (reported, not fatal). */
  unpinned_keys: string[];
};

export type ReadbackMismatch = { sdk_key: string; written: unknown; read_back: unknown };

/** Largest difference between a written and a read-back number that still counts as equal. */
export const READBACK_TOLERANCE = 1e-6;

const EXPECTED_SDK_TYPE: Record<ParamSpec["kind"], SdkValueType> = {
  number: "number",
  switch: "number",
  boolean: "boolean",
  curve: "array",
};

function describe(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function validateCurve(name: string, value: unknown): number[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === "number" && Number.isFinite(v))) {
    throw new ParamError("wrong_type", `${name} must be an array of numbers [x0, y0, x1, y1, ...]`, name);
  }
  const points = value as number[];
  // Shape rules inferred from the dump samples ([0, 0, 255, 255] and the Adobe Landscape Look's
  // [0, 0, 64, 60, ...]) [inference]: pairs on 0..255 with strictly increasing x.
  if (points.length < 4 || points.length % 2 !== 0) {
    throw new ParamError("wrong_type", `${name} needs at least two (x, y) points`, name);
  }
  for (let i = 0; i < points.length; i++) {
    const v = points[i] as number;
    if (v < 0 || v > 255) throw new ParamError("out_of_range", `${name}[${i}] = ${v} is outside 0..255`, name);
    if (i % 2 === 0 && i > 0 && v <= (points[i - 2] as number)) {
      throw new ParamError("wrong_type", `${name}: x values must increase (index ${i})`, name);
    }
  }
  return [...points];
}

function validate(name: string, spec: ParamSpec, value: unknown): unknown {
  switch (spec.kind) {
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new ParamError("wrong_type", `${name} must be a finite number, got ${describe(value)}`, name);
      }
      if (value < spec.min || value > spec.max) {
        throw new ParamError("out_of_range", `${name} = ${value} is outside ${spec.min}..${spec.max}`, name);
      }
      return value;
    case "switch":
      if (value !== 0 && value !== 1) throw new ParamError("wrong_type", `${name} must be 0 or 1`, name);
      return value;
    case "boolean":
      if (typeof value !== "boolean") throw new ParamError("wrong_type", `${name} must be true or false`, name);
      return value;
    case "curve":
      return validateCurve(name, value);
  }
}

function isTable(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Equality for values that crossed Lua and JSON. The one allowance: an empty table can arrive as
 * [] or {}. Inside tables every key must be present on both sides; a missing nested key is a mismatch.
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
    const keys = new Set([...Object.keys(written), ...Object.keys(readBack)]);
    for (const k of keys) {
      if (!(k in written) || !(k in readBack)) return false;
      if (!sdkValuesEqual(written[k], readBack[k])) return false;
    }
    return true;
  }
  return isDeepStrictEqual(written, readBack);
}

export class ParamMap {
  private readonly sdkKeys: SdkKeyMap;
  private readonly profiles: CameraProfiles;
  private readonly params: ReadonlyMap<string, ParamSpec>;

  constructor(sdkKeys: SdkKeyMap, profiles: CameraProfiles, params: ReadonlyMap<string, ParamSpec> = CANONICAL_PARAMS) {
    const seen = new Map<string, string>();
    for (const [name, spec] of params) {
      const entry = sdkKeys.get(spec.sdkKey); // throws UnknownSdkKeyError: the key is not in the live dump
      const expected = EXPECTED_SDK_TYPE[spec.kind];
      if (entry.type !== expected) {
        throw new Error(`${name} -> ${spec.sdkKey}: the pinned dump has type ${entry.type}, the map expects ${expected}`);
      }
      const other = seen.get(spec.sdkKey);
      if (other) throw new Error(`${other} and ${name} both map to ${spec.sdkKey}`);
      seen.set(spec.sdkKey, name);
    }
    for (const key of ["CameraProfile", "Look", "ProcessVersion"]) sdkKeys.get(key);
    this.sdkKeys = sdkKeys;
    this.profiles = profiles;
    this.params = params;
  }

  /** Canonical names this map accepts, camera_profile included. */
  names(): string[] {
    return [...this.params.keys(), CAMERA_PROFILE_PARAM];
  }

  /** The spec of a canonical name, or undefined (camera_profile has none: see cameraProfiles()). */
  spec(name: string): ParamSpec | undefined {
    return this.params.get(name);
  }

  cameraProfiles(): CameraProfiles {
    return this.profiles;
  }

  /** Validate canonical settings and return the SDK table to write. */
  toSdk(settings: Readonly<Record<string, unknown>>, context: { processVersion: string }): SdkSettings {
    this.checkProcessVersion(context.processVersion);
    const out: SdkSettings = {};
    for (const [name, value] of Object.entries(settings)) {
      if (name === CAMERA_PROFILE_PARAM) {
        if (typeof value !== "string") throw new ParamError("wrong_type", `${name} must be a profile name`, name);
        Object.assign(out, this.profiles.toSdk(value)); // throws UnknownCameraProfileError
        continue;
      }
      const spec = this.params.get(name);
      if (!spec) throw new ParamError("unknown_parameter", `Unknown parameter "${name}"`, name);
      out[spec.sdkKey] = validate(name, spec, value);
    }
    return out;
  }

  /** Canonical view of a getDevelopSettings() table. */
  fromSdk(sdk: Readonly<SdkSettings>): FromSdkResult {
    const pv = sdk["ProcessVersion"];
    if (typeof pv !== "string") {
      throw new ParamError("unsupported_process_version", "The settings carry no ProcessVersion string");
    }
    this.checkProcessVersion(pv);

    const settings: CanonicalSettings = {};
    for (const [name, spec] of this.params) {
      if (!(spec.sdkKey in sdk)) continue; // e.g. monochrome profiles drop 18 keys (S5.md "Numbers")
      let value = sdk[spec.sdkKey];
      if (spec.kind === "curve" && isEmptyLook(value)) value = []; // Lua's empty table may arrive as {}
      if (describe(value) !== EXPECTED_SDK_TYPE[spec.kind]) {
        throw new ParamError(
          "wrong_type",
          `Lightroom returned ${describe(value)} for ${spec.sdkKey}; the pinned dump has ${EXPECTED_SDK_TYPE[spec.kind]}`,
          name,
        );
      }
      settings[name] = value as CanonicalValue;
    }

    const cameraProfile = this.profiles.identify(sdk["CameraProfile"], sdk["Look"]);
    if (cameraProfile.name !== null) settings[CAMERA_PROFILE_PARAM] = cameraProfile.name;

    return {
      process_version: pv,
      settings,
      camera_profile: cameraProfile,
      unpinned_keys: Object.keys(sdk).filter((k) => !this.sdkKeys.has(k)).sort(),
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

  private checkProcessVersion(pv: string): void {
    if (!SUPPORTED_PROCESS_VERSIONS.includes(pv)) {
      throw new ParamError(
        "unsupported_process_version",
        `Process version ${pv} is not supported (supported: ${SUPPORTED_PROCESS_VERSIONS.join(", ")}); update the photo's process version in Lightroom first`,
      );
    }
  }
}
