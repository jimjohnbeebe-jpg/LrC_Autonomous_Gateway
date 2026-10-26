// Value checks for the canonical map (map.ts toSdk and fromSdk): each spec kind's type and range.
// Unknown names, wrong types and out-of-range values are rejected, never guessed (PRD FR-4.2).

import type { ParamSpec } from "./canonical.js";
import { ParamError } from "./param-error.js";
import type { SdkValueType } from "./sdk-keys.js";

export const EXPECTED_SDK_TYPE: Record<ParamSpec["kind"], SdkValueType> = {
  number: "number",
  switch: "number",
  boolean: "boolean",
  curve: "array",
};

export function describe(value: unknown): string {
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

export function validate(name: string, spec: ParamSpec, value: unknown): unknown {
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
