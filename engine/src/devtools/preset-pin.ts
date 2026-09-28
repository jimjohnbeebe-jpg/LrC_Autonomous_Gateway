// Derives params\preset-format.lrc15.json from the reference presets Lightroom wrote
// (preset-capture.ts; `npm run preset:pin` writes it, tests\presets-format.test.ts checks it is
// current). Everything comes from the files except a number's sign when Lightroom only wrote it as 0
// or below: then it follows the slider's range, a rule the pin checks against every key it did see.

import { PROCESS_VERSION_KEY, type ParamMap } from "../params/index.js";
import type { NumberFormat, PresetFormat } from "../params/preset-format.js";
import { parseXml, presetDescription } from "../presets/xmp-parse.js";

/** The references, repo-relative, the fullest first (preset-capture.ts REFERENCES). */
export const PRESET_SOURCES = ["engine/tests/fixtures/presets/reference-2.lrc15.xmp", "engine/tests/fixtures/presets/reference.lrc15.xmp"];
/** Attributes after the settings that every preset keeps: without HasSettings a preset may be read as empty [inference]. */
const TRAILER_KEYS = ["HasSettings"];
const XMPTK = "x:xmptk";

type Reference = { xmptk: string; attrs: Array<[string, string]> };

function reference(text: string): Reference {
  const root = parseXml(text);
  const attrs = [...presetDescription(root).attrs].filter(([k]) => k.startsWith("crs:")).map(([k, v]): [string, string] => [k.slice(4), v]);
  return { xmptk: root.attrs.get(XMPTK) ?? "", attrs };
}

function same<T>(what: string, values: T[]): T {
  const text = values.map((v) => JSON.stringify(v));
  if (new Set(text).size !== 1) throw new Error(`the references differ in ${what}: ${text.join(" vs ")}`);
  return values[0] as T;
}

/** The attributes before the settings (up to ProcessVersion), with UUID emptied: the writer gives each preset its own. */
function envelope(ref: Reference): Array<[string, string]> {
  const end = ref.attrs.findIndex(([k]) => k === PROCESS_VERSION_KEY);
  if (end < 0) throw new Error(`a reference has no crs:${PROCESS_VERSION_KEY}`);
  return ref.attrs.slice(0, end).map(([k, v]): [string, string] => [k, k === "UUID" ? "" : v]);
}

/** Every settings attribute in the order Lightroom wrote it; a name only a later reference has goes after its predecessor there. */
function settingsOrder(refs: Reference[]): string[] {
  const order: string[] = [];
  for (const ref of refs) {
    const names = ref.attrs.map(([k]) => k).slice(envelope(ref).length);
    names.forEach((name, i) => {
      if (order.includes(name) || TRAILER_KEYS.includes(name)) return;
      const before = names.slice(0, i).reverse().find((n) => order.includes(n));
      order.splice(before === undefined ? order.length : order.indexOf(before) + 1, 0, name);
    });
  }
  return order;
}

const decimalsOf = (text: string): number => text.split(".")[1]?.length ?? 0;
const positiveUnsigned = (text: string): boolean => /^\d/.test(text) && Number(text) > 0;

function numberFormat(observed: string[], min: number, max: number): NumberFormat {
  const decimals = Math.max(0, ...observed.map(decimalsOf));
  if (observed.some((t) => t.startsWith("+"))) return { signed: true, decimals, observed, basis: "observed" };
  if (observed.some(positiveUnsigned)) return { signed: false, decimals, observed, basis: "observed" };
  const seen = observed.length > 0 ? `only ${observed.join(", ")} observed` : "not observed";
  return { signed: min < 0, decimals, observed, basis: `inference: ${seen}; range ${min}..${max}, signed when it goes below 0` };
}

/** The range rule must hold for every key whose sign was observed, or the pin stops. */
function checkRangeRule(numbers: Record<string, NumberFormat>, ranges: Map<string, number>): void {
  for (const [key, f] of Object.entries(numbers)) {
    const min = ranges.get(key) ?? 0;
    if (f.basis === "observed" && !f.signed && min < 0) throw new Error(`${key}: its range goes below 0, yet Lightroom wrote it unsigned; the range rule does not hold`);
  }
}

export function derivePresetFormat(map: ParamMap, texts: string[]): PresetFormat {
  const refs = texts.map(reference);
  const numbers: Record<string, NumberFormat> = {};
  const mins = new Map<string, number>();
  for (const name of map.names()) {
    const spec = map.spec(name);
    if (!spec || (spec.kind !== "number" && spec.kind !== "switch")) continue;
    const [min, max] = spec.kind === "number" ? [spec.min, spec.max] : [0, 1];
    const observed = [...new Set(refs.flatMap((r) => r.attrs.filter(([k]) => k === spec.sdkKey).map(([, v]) => v)))];
    numbers[spec.sdkKey] = numberFormat(observed, min, max);
    mins.set(spec.sdkKey, min);
  }
  checkRangeRule(numbers, mins);
  return {
    schema_version: 1,
    generated_by: "engine/src/devtools/preset-pin.ts (npm run preset:pin)",
    sources: PRESET_SOURCES,
    xmptk: same("x:xmptk", refs.map((r) => r.xmptk)),
    envelope: same("the preset attributes before the settings", refs.map(envelope)),
    trailer: same("the trailer", refs.map((r) => r.attrs.filter(([k]) => TRAILER_KEYS.includes(k)))),
    order: settingsOrder(refs),
    numbers,
  };
}
