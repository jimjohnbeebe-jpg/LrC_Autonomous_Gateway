// Validation of an intent object (loader.ts check; split out of loader.ts for Phase 10 row 5): the
// schema version, the shape (schema.ts), then every prior and set value against the params map, per
// pipeline, and each profile against the pinned profiles of its pipeline.
// What a value means [inference: PRD 6.9 says only "settings applied at pass 0"; chosen so that an
// intent does not wipe edits the photo already has]:
//   - a number in `priors` (exposure, vibrance, temperature, ...) is an offset added to the photo's
//     current value, so it must be finite and no larger than the parameter's whole range;
//   - a number in `set` (schema v3) is the value itself, so it must be within the range;
//   - a switch, a boolean or a curve is set as given, so it must be a value the params map writes.

import { CAMERA_PROFILE_PARAM, CUSTOM_WHITE_BALANCE_PARAMS, LOCAL_PARAMS, PIPELINES, ParamError, SUPPORTED_PROCESS_VERSIONS, UnknownCameraProfileError, WHITE_BALANCE_UNITS, type ParamMap, type Pipeline } from "../params/index.js";
import { IntentError } from "./errors.js";
import { intentSchema, type Intent, type PriorSet } from "./schema.js";
import { versionProblem } from "./version.js";

type Values = Intent["priors"];
type Kind = "offset" | "absolute";

/** Validate an intent object: the schema, then priors, set values and profiles against the params map, per pipeline. */
export function checkIntent(candidate: unknown, map: ParamMap): Intent {
  const version = versionProblem(candidate);
  if (version !== null) throw new IntentError("invalid_intent", `the intent does not match the schema: ${version}`, [version]);
  const parsed = intentSchema.safeParse(candidate);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.length ? i.path.join(".") : "intent"}: ${i.message}`);
    throw new IntentError("invalid_intent", `the intent does not match the schema: ${problems.join("; ")}`, problems);
  }
  const intent = parsed.data;
  const problems: string[] = [];
  const profiles = map.cameraProfiles();
  const monochrome = (p: Pipeline): boolean => intent.profile !== undefined && profiles.names().includes(intent.profile[p]) && profiles.monochrome(intent.profile[p]);
  // `pipeline` null: the shared values, checked on both pipelines.
  const checkValues = (where: string, values: Values, pipeline: Pipeline | null, kind: Kind): void => {
    for (const [name, value] of Object.entries(values)) {
      const at = `${where}.${name}`;
      if (name === CAMERA_PROFILE_PARAM) {
        problems.push(`${at}: put the camera profile in profile, not in ${where.split(".")[0]}`);
        continue;
      }
      if (pipeline === null && CUSTOM_WHITE_BALANCE_PARAMS.includes(name)) {
        const own = kind === "offset" ? "priors_by_pipeline" : "set_by_pipeline";
        problems.push(`${at}: ${name} goes in ${own}, as its unit differs (${PIPELINES.map((p) => `${WHITE_BALANCE_UNITS[p]} on ${p}`).join(", ")})`);
        continue;
      }
      const on = pipeline === null ? PIPELINES : [pipeline];
      const colourOn = on.find((p) => monochrome(p) && isColourParam(name));
      if (colourOn) problems.push(`${at}: the ${colourOn} profile "${intent.profile?.[colourOn]}" is monochrome and drops ${name}'s slider`);
      for (const p of on) {
        const problem = valueProblem(map, name, value, p, kind);
        if (problem !== null) {
          problems.push(`${at}: ${problem}`);
          break;
        }
      }
    }
  };
  const checkSet = (where: string, set: PriorSet): void => {
    checkValues(`${where}priors`, set.priors, null, "offset");
    for (const p of PIPELINES) {
      const own = set.priors_by_pipeline?.[p];
      if (!own) continue;
      checkValues(`${where}priors_by_pipeline.${p}`, own, p, "offset");
      for (const name of Object.keys(own)) if (name in set.priors) problems.push(`${where}priors_by_pipeline.${p}.${name}: ${name} is also in ${where}priors; give it in one place`);
    }
  };
  checkSet("", intent);
  if (intent.variants) for (const key of ["A", "B", "C"] as const) checkSet(`variants.${key}.`, intent.variants[key]);
  problems.push(...setProblems(intent, checkValues));
  for (const field of ["references", "tone_mode", "masks"] as const) {
    if (intent[field] !== undefined && intent.schema_version < 3) problems.push(`schema_version: ${field} ${field === "tone_mode" ? "needs" : "need"} schema_version 3`);
  }
  problems.push(...maskProblems(intent.masks ?? []));
  if (intent.profile !== undefined) problems.push(...profileProblems(map, intent.profile));
  if (problems.length > 0) throw new IntentError("invalid_intent", `the intent has invalid values: ${problems.join("; ")}`, problems);
  return intent;
}

/** `set` and `set_by_pipeline` (schema v3 only): each value checked, and no name also in the priors or in both places. */
function setProblems(intent: Intent, checkValues: (where: string, values: Values, pipeline: Pipeline | null, kind: Kind) => void): string[] {
  if (intent.set === undefined && intent.set_by_pipeline === undefined) return [];
  if (intent.schema_version < 3) return ["schema_version: set and set_by_pipeline need schema_version 3"];
  const problems: string[] = [];
  const shared = intent.set ?? {};
  checkValues("set", shared, null, "absolute");
  for (const p of PIPELINES) {
    const own = intent.set_by_pipeline?.[p];
    if (!own) continue;
    checkValues(`set_by_pipeline.${p}`, own, p, "absolute");
    for (const name of Object.keys(own)) if (name in shared) problems.push(`set_by_pipeline.${p}.${name}: ${name} is also in set; give it in one place`);
  }
  const priorNames = new Set([...Object.keys(intent.priors), ...PIPELINES.flatMap((p) => Object.keys(intent.priors_by_pipeline?.[p] ?? {}))]);
  const setNames = new Set([...Object.keys(shared), ...PIPELINES.flatMap((p) => Object.keys(intent.set_by_pipeline?.[p] ?? {}))]);
  for (const name of setNames) if (priorNames.has(name)) problems.push(`set.${name}: ${name} is also a prior; a value is either set (absolute) or a prior (added), not both`);
  return problems;
}

/** A look's masks: each slider a local slider (params\mask-table.ts LOCAL_PARAMS) within the panel's range, as lr_create_mask takes it. */
function maskProblems(masks: NonNullable<Intent["masks"]>): string[] {
  const problems: string[] = [];
  masks.forEach((m, i) => {
    for (const [name, value] of Object.entries(m.sliders)) {
      const p = LOCAL_PARAMS.get(name);
      if (!p) problems.push(`masks.${i}.sliders.${name}: not a local slider (${[...LOCAL_PARAMS.keys()].join(", ")})`);
      else if (!Number.isFinite(value) || value < p.min || value > p.max) problems.push(`masks.${i}.sliders.${name}: ${value} is outside ${p.min}..${p.max}`);
    }
  });
  return problems;
}

/** Each pipeline's profile must be a pinned profile of that pipeline. */
function profileProblems(map: ParamMap, profile: Readonly<Record<Pipeline, string>>): string[] {
  const profiles = map.cameraProfiles();
  const problems: string[] = [];
  for (const p of PIPELINES) {
    const name = profile[p];
    try {
      const of = profiles.pipeline(name);
      if (of !== p) problems.push(`profile.${p}: "${name}" is a ${of}-pipeline profile (${p} profiles: ${profiles.names().filter((n) => profiles.pipeline(n) === p).join(", ")})`);
    } catch (err) {
      if (!(err instanceof UnknownCameraProfileError)) throw err;
      problems.push(`profile.${p}: ${err.message}`);
    }
  }
  return problems;
}

/** What is wrong with one value on one pipeline, or null. */
function valueProblem(map: ParamMap, name: string, value: unknown, pipeline: Pipeline, kind: Kind): string | null {
  const spec = map.spec(name, pipeline);
  if (spec?.kind === "number") {
    if (kind === "absolute") {
      if (typeof value !== "number" || !Number.isFinite(value)) return "must be a number (the value itself)";
      if (value < spec.min || value > spec.max) return `${value} is outside the range ${spec.min}..${spec.max} on the ${pipeline} pipeline`;
      return null;
    }
    const range = spec.max - spec.min;
    if (typeof value !== "number" || !Number.isFinite(value)) return "must be a number (an offset added to the photo's value)";
    if (Math.abs(value) > range) return `an offset of ${value} is larger than the whole range ${spec.min}..${spec.max} on the ${pipeline} pipeline`;
    return null;
  }
  try {
    map.toSdk({ [name]: value }, { processVersion: SUPPORTED_PROCESS_VERSIONS[0] as string, pipeline });
    return null;
  } catch (err) {
    if (!(err instanceof ParamError)) throw err;
    return err.message;
  }
}

/**
 * The sliders a monochrome profile takes out of the settings table: Saturation, Vibrance and the HSL
 * keys, on rendered photos [handle: docs\reports\phase8\S10.md "Profiles", run 2 `keys_dropped`] and on
 * raw ones (159 keys against 177 [handle: docs\reports\phase0\S5\part1\s5_profiles.log]).
 */
export function isColourParam(name: string): boolean {
  return name === "saturation" || name === "vibrance" || name.startsWith("hsl.");
}
