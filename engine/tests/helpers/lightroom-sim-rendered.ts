// The simulated Lightroom's rendered photo (Phase 8 row 3): DSC_0031.JPG as spike S10's census read it,
// and what Lightroom did with writes to a rendered photo loaded in Develop [handle:
// docs\reports\phase8\S10.md "Observed"; LR_SDK_NOTES "Recorded in Phase 8"]:
//   - the raw profile pair is refused: CameraProfile stays "Embedded" and no Look is kept;
//   - IncrementalTemperature / IncrementalTint are ignored while WhiteBalance is "As Shot", and taken,
//     clamped to -100..100, with "Custom" (written with them or already set);
//   - Monochrome (ConvertToGrayscale true) drops the HSL keys, Saturation and Vibrance from the table
//     (the GrayMixer keys it brings in are left out here: the engine does not map them).
// The Kelvin Temperature / Tint are dropped too [inference: Lightroom's own Sync pastes them onto a JPEG
// and "it doesn't change anything", a community report, PHASE8_PLAN item 7]. Lightroom checks a write
// only on the photo in Develop (S10 run 1), so a write by uuid to an unselected photo is kept as sent.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const census = (file: string): { settings: Record<string, unknown> } =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../../docs/reports/phase8/S10/census/${file}`, import.meta.url)), "utf8")) as { settings: Record<string, unknown> };

/** DSC_0031.JPG on process version 15.4, and the other original of that name, on 11.0 (S10 census). */
export const renderedDumps = { "15.4": census("s10_DSC_0031.JPG__AAFDE261.json"), "11.0": census("s10_DSC_0031.JPG__81FFC502.json") } as const;

const RAW_ONLY = new Set(["Temperature", "Tint"]);
const INCREMENTAL = new Set(["IncrementalTemperature", "IncrementalTint"]);
const GRAYSCALE_DROPS = /^(HueAdjustment|SaturationAdjustment|LuminanceAdjustment)|^(Saturation|Vibrance)$/;

const emptyTable = (v: unknown): boolean => v === undefined || (Array.isArray(v) ? v.length === 0 : typeof v === "object" && v !== null && Object.keys(v).length === 0);

/** A rendered photo's settings carry the relative white balance and no Kelvin one. */
export const isRendered = (settings: Record<string, unknown>): boolean => "IncrementalTemperature" in settings && !("Temperature" in settings);

/** Apply `written` to a rendered photo loaded in Develop, as Lightroom did in S10; the keys Lightroom kept are changed in place. */
export function writeRendered(settings: Record<string, unknown>, written: Record<string, unknown>, ignored: ReadonlySet<string>): void {
  const custom = (written["WhiteBalance"] ?? settings["WhiteBalance"]) === "Custom";
  const rawPair = (written["CameraProfile"] !== undefined && written["CameraProfile"] !== "Embedded") || ("Look" in written && !emptyTable(written["Look"]));
  for (const [k, v] of Object.entries(written)) {
    if (ignored.has(k) || RAW_ONLY.has(k)) continue;
    if (rawPair && (k === "CameraProfile" || k === "Look")) continue;
    if (k === "Look") continue; // a rendered photo has no Look; Look {} reads back absent
    if (INCREMENTAL.has(k)) {
      if (custom && typeof v === "number") settings[k] = Math.max(-100, Math.min(100, v));
      continue;
    }
    settings[k] = structuredClone(v);
  }
  if (settings["ConvertToGrayscale"] === true) for (const k of Object.keys(settings)) if (GRAYSCALE_DROPS.test(k)) delete settings[k];
}
