// The settings page's values as the engine takes them from get_prefs (PRD section 6.2, AVG-006,
// PHASE5_PLAN decision 2 and row 3). The plugin checks every value before it sends it
// (plugin\LrC-AVG.lrplugin\Prefs.lua); the engine checks each field again here, at the boundary
// (rule 01), so a field that fails costs only itself: it is left out, and the session takes the
// default for it.
//
// PAGE_SPECS mirrors Prefs.lua SPECS line by line: engine\tests\lua-plugin.test.ts fails when the
// keys, wire names, kinds, defaults or ranges differ, and engine\tests\settings.test.ts when a
// default differs from the session's built-in one (session\rules.ts SESSION_DEFAULTS).

import { z } from "zod";

/** The page's settings under their get_prefs names. */
export type PageValues = {
  mode: "autonomous" | "approve_each_pass";
  max_passes: number;
  variant_count: number;
  long_edge: number;
  quality: number;
  clip_high_pct: number;
  clip_low_pct: number;
  decay: number[];
  intents_dir: string;
  log_dir: string;
  receive_port: number;
  send_port: number;
};
export type WireKey = keyof PageValues;

type Spec =
  | { key: string; wire: WireKey; kind: "choice"; default: string; choices: readonly string[] }
  | { key: string; wire: WireKey; kind: "int" | "number" | "port"; default: number; min: number; max: number }
  | { key: string; wire: WireKey; kind: "decay" | "folder"; default: string };

/** The engine's instance lock port (mcp\instance-lock.ts lockPortFor, 8766 + 1): no bridge port may take it. */
export const LOCK_PORT = 8767;
/** At most this many decay multipliers (Prefs.lua DECAY_MAX_VALUES). */
export const DECAY_MAX_VALUES = 8;

/** `key` is the plugin's LrPrefs key, `wire` the get_prefs field; `default` is as the page stores it. */
export const PAGE_SPECS: readonly Spec[] = [
  { key: "mode", wire: "mode", kind: "choice", default: "autonomous", choices: ["autonomous", "approve_each_pass"] },
  { key: "maxPasses", wire: "max_passes", kind: "int", default: 4, min: 1, max: 8 },
  { key: "variantCount", wire: "variant_count", kind: "int", default: 3, min: 2, max: 3 },
  { key: "previewLongEdge", wire: "long_edge", kind: "int", default: 1600, min: 800, max: 1920 },
  { key: "previewQuality", wire: "quality", kind: "int", default: 75, min: 60, max: 90 },
  { key: "clipHighPct", wire: "clip_high_pct", kind: "number", default: 0.5, min: 0, max: 100 },
  { key: "clipLowPct", wire: "clip_low_pct", kind: "number", default: 1.0, min: 0, max: 100 },
  { key: "decay", wire: "decay", kind: "decay", default: "1.0, 0.6, 0.4, 0.25" },
  { key: "intentsFolder", wire: "intents_dir", kind: "folder", default: "" },
  { key: "logFolder", wire: "log_dir", kind: "folder", default: "" },
  { key: "receivePort", wire: "receive_port", kind: "port", default: 8765, min: 1024, max: 65535 },
  { key: "sendPort", wire: "send_port", kind: "port", default: 8766, min: 1024, max: 65535 },
];

function schemaFor(spec: Spec): z.ZodType {
  switch (spec.kind) {
    case "choice":
      return z.enum(spec.choices as [string, ...string[]]);
    case "int":
      return z.number().int().min(spec.min).max(spec.max);
    case "number":
      return z.number().min(spec.min).max(spec.max);
    case "port":
      return z.number().int().min(spec.min).max(spec.max).refine((p) => p !== LOCK_PORT, `${LOCK_PORT} is the engine's own port`);
    case "decay":
      return z.array(z.number().gt(0).max(1)).min(1).max(DECAY_MAX_VALUES);
    case "folder":
      return z.string();
  }
}

const invalidEntry = z.looseObject({ key: z.string(), reason: z.string(), value: z.unknown().optional() });

/**
 * The valid fields of a get_prefs result, and a line for each field left out: one the plugin
 * listed in `invalid` (it sent the default in its place, so the value is not the page's), one that
 * fails its check here, or one that is missing.
 */
export function parsePage(raw: Record<string, unknown>): { values: Partial<PageValues>; problems: string[] } {
  const problems: string[] = [];
  const replaced = new Set<string>();
  const invalid = z.array(invalidEntry).safeParse(raw["invalid"]);
  for (const entry of invalid.success ? invalid.data : []) {
    replaced.add(entry.key);
    problems.push(`${entry.key} = ${String(entry.value ?? "?")}: ${entry.reason} (the page's value is not used)`);
  }
  const values: Record<string, unknown> = {};
  for (const spec of PAGE_SPECS) {
    if (replaced.has(spec.key)) continue;
    const parsed = schemaFor(spec).safeParse(raw[spec.wire]);
    if (parsed.success) values[spec.wire] = parsed.data;
    else problems.push(`${spec.wire}: ${raw[spec.wire] === undefined ? "missing" : parsed.error.issues.map((i) => i.message).join("; ")}`);
  }
  if (values["receive_port"] !== undefined && values["receive_port"] === values["send_port"]) {
    problems.push("receive_port and send_port are the same port");
    delete values["receive_port"];
    delete values["send_port"];
  }
  return { values: values as Partial<PageValues>, problems };
}
