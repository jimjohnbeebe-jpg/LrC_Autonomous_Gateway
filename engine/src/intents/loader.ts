// The intent library (ARCHITECTURE section 7, PRD section 6.9).
//
// Intents come from two folders, read again on every call so that a file edited between calls is
// seen at once:
//   1. bundled: engine\intents\ (shipped with the engine);
//   2. user: %LOCALAPPDATA%\LrC-AVG\intents\ (PRD section 6.2), or LRC_AVG_INTENTS_DIR when set;
//      in the engine, the folder settings\folders.ts chooses (the variable, else the settings page's
//      folder, else the default), looked up again on every call (PHASE5_PLAN row 3).
// A user file with the same id replaces the bundled intent. A file that fails validation is
// skipped and reported as a warning, from either folder, so one bad file cannot stop the engine.
// [handle: tests\intents.test.ts "adds a user intent with a new id" (written after the library was
// created), "lets a user intent with the same id replace the bundled one", "skips invalid files with
// a warning each and keeps the rest"]
// The bundled set is read in place, from the repo or the installed package; it is not copied into
// the user folder on first run, so a later engine's intent fixes reach the user and only the user's
// own files show as overrides_bundled (PHASE6_PLAN decision 3 [stated: Jim, 2026-10-01, "go"]).
//
// Validation: the file must be <id>.json and match schema v2 (schema.ts; a v1 file is skipped with a
// warning saying how to rewrite it); every prior must name a canonical parameter, with a value valid
// on each pipeline it applies to (the shared priors on both); temperature and tint only per pipeline;
// profile.raw and profile.rendered must be pinned profiles of their pipeline, and a monochrome one
// takes no prior on the colour sliders it drops.
// What a prior means [inference: PRD 6.9 says only "settings applied at pass 0"; chosen so that an
// intent does not wipe edits the photo already has]:
//   - a number (exposure, vibrance, temperature, ...) is an offset added to the photo's current
//     value, so it must be finite and no larger than the parameter's whole range;
//   - a switch, a boolean or a curve is set as given, so it must be a value the params map writes.
//
// Claude-proposed intents are written only through save(), which the lr_save_intent tool calls
// after Jim approves in chat (the tool also requires `confirmed: true`).

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CAMERA_PROFILE_PARAM, CUSTOM_WHITE_BALANCE_PARAMS, PIPELINES, ParamError, SUPPORTED_PROCESS_VERSIONS, UnknownCameraProfileError, WHITE_BALANCE_UNITS, type ParamMap, type Pipeline } from "../params/index.js";
import { INTENT_SCHEMA_VERSION, intentSchema, type Intent, type PriorSet } from "./schema.js";

export type IntentSource = "bundled" | "user";
export type LoadedIntent = { intent: Intent; source: IntentSource; path: string; overrides_bundled: boolean };
export type IntentWarning = { source: IntentSource; file: string; problem: string };
export type IntentSummary = { id: string; label: string; category: string; source: IntentSource };

export type IntentErrorCode = "intent_not_found" | "invalid_intent" | "intent_exists";

/** A structured intent failure ({code, message, recoverable}, PRD NFR-7). */
export class IntentError extends Error {
  readonly code: IntentErrorCode;
  readonly problems: string[];

  constructor(code: IntentErrorCode, message: string, problems: string[] = []) {
    super(message);
    this.name = "IntentError";
    this.code = code;
    this.problems = problems;
  }
}

/** engine\intents\, next to src\ and dist\ (this file is <engine>\{src,dist}\intents\loader.*). */
export function bundledIntentsDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "intents");
}

export function defaultUserIntentsDir(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env["LRC_AVG_INTENTS_DIR"];
  if (explicit) return explicit;
  const localAppData = env["LOCALAPPDATA"];
  return localAppData ? path.join(localAppData, "LrC-AVG", "intents") : path.join(os.homedir(), ".lrc-avg", "intents");
}

export class IntentLibrary {
  private readonly bundledDir: string;
  private readonly userDirOf: () => string;
  private readonly map: ParamMap;

  /** `userDir`: a folder, or a function giving the folder at each call. */
  constructor(options: { map: ParamMap; bundledDir?: string; userDir?: string | (() => string) }) {
    this.map = options.map;
    this.bundledDir = options.bundledDir ?? bundledIntentsDir();
    const userDir = options.userDir ?? defaultUserIntentsDir();
    this.userDirOf = typeof userDir === "function" ? userDir : () => userDir;
  }

  private get userDir(): string {
    return this.userDirOf();
  }

  directories(): { bundled: string; user: string } {
    return { bundled: this.bundledDir, user: this.userDir };
  }

  /** Every valid intent by id (user over bundled), and a warning for each file skipped. */
  load(): { intents: Map<string, LoadedIntent>; warnings: IntentWarning[] } {
    const intents = new Map<string, LoadedIntent>();
    const warnings: IntentWarning[] = [];
    for (const source of ["bundled", "user"] as const) {
      const dir = source === "bundled" ? this.bundledDir : this.userDir;
      for (const file of this.jsonFiles(dir, source, warnings)) {
        const full = path.join(dir, file);
        try {
          const intent = this.parse(readFileSync(full, "utf8"));
          if (`${intent.id}.json` !== file) throw new IntentError("invalid_intent", `the file must be named ${intent.id}.json to match its id`);
          const bundled = intents.get(intent.id);
          intents.set(intent.id, { intent, source, path: full, overrides_bundled: source === "user" && bundled?.source === "bundled" });
        } catch (err) {
          warnings.push({ source, file, problem: problemText(err) });
        }
      }
    }
    return { intents, warnings };
  }

  list(): { intents: IntentSummary[]; warnings: IntentWarning[] } {
    const { intents, warnings } = this.load();
    const summaries = [...intents.values()]
      .map(({ intent, source }) => ({ id: intent.id, label: intent.label, category: intent.category, source }))
      .sort((a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id));
    return { intents: summaries, warnings };
  }

  get(id: string): LoadedIntent {
    const { intents, warnings } = this.load();
    const found = intents.get(id);
    if (found) return found;
    const skipped = warnings.find((w) => w.file === `${id}.json`);
    throw new IntentError(
      "intent_not_found",
      skipped
        ? `The intent "${id}" exists but was skipped: ${skipped.problem}`
        : `There is no intent "${id}" (intents: ${[...intents.keys()].sort().join(", ") || "none"}).`,
    );
  }

  /**
   * Validate an intent and write it to the user folder as <id>.json. An existing user file with that
   * id is replaced only when `replace` is true; a bundled intent of the same id is overridden, not changed.
   */
  save(candidate: unknown, options: { replace?: boolean } = {}): { path: string; replaced: boolean; overrides_bundled: boolean } {
    const intent = this.check(candidate);
    const file = `${intent.id}.json`;
    const dir = this.userDir;
    const target = path.join(dir, file);
    // The file on disk counts, valid or not: a user file the loader skipped is still the user's
    // (Greptile, PR #22) [handle: tests\intents.test.ts "keeps a user file the loader skipped"].
    const replaced = existsSync(target);
    // Overriding counts only a bundled intent the loader accepts, as get() reports it afterwards
    // (Greptile, PR #22): an invalid bundled file is not an intent [handle: tests\intents.test.ts
    // "reports overriding a bundled intent only when the bundled file is a valid intent"].
    const current = this.load().intents.get(intent.id);
    const overridesBundled = current?.source === "bundled" || current?.overrides_bundled === true;
    if (replaced && !options.replace) {
      throw new IntentError("intent_exists", `A user intent file ${target} already exists; pass replace: true to replace it.`);
    }
    mkdirSync(dir, { recursive: true });
    // Write a temporary file and rename it over the target, so the loader does not read a file that
    // is still being written [inference: a rename within one folder swaps the file in one step; the
    // behaviour on a crash mid-write is not tested]. The loader ignores the .tmp name.
    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(intent, null, 2)}\n`, "utf8");
    renameSync(temporary, target);
    return { path: target, replaced, overrides_bundled: overridesBundled };
  }

  /** Parse and validate the text of an intent file. */
  parse(text: string): Intent {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      throw new IntentError("invalid_intent", `not valid JSON: ${(err as Error).message}`);
    }
    return this.check(raw);
  }

  /** Validate an intent object: the schema, then priors and profiles against the params map, per pipeline. */
  check(candidate: unknown): Intent {
    const version = versionProblem(candidate);
    if (version !== null) throw new IntentError("invalid_intent", `the intent does not match the schema: ${version}`, [version]);
    const parsed = intentSchema.safeParse(candidate);
    if (!parsed.success) {
      const problems = parsed.error.issues.map((i) => `${i.path.length ? i.path.join(".") : "intent"}: ${i.message}`);
      throw new IntentError("invalid_intent", `the intent does not match the schema: ${problems.join("; ")}`, problems);
    }
    const intent = parsed.data;
    const problems: string[] = [];
    const profiles = this.map.cameraProfiles();
    const monochrome = (p: Pipeline): boolean => intent.profile !== undefined && profiles.names().includes(intent.profile[p]) && profiles.monochrome(intent.profile[p]);
    // `pipeline` null: the shared priors, checked on both pipelines.
    const checkPriors = (where: string, priors: Intent["priors"], pipeline: Pipeline | null): void => {
      for (const [name, value] of Object.entries(priors)) {
        const at = `${where}.${name}`;
        if (name === CAMERA_PROFILE_PARAM) {
          problems.push(`${at}: put the camera profile in profile, not in priors`);
          continue;
        }
        if (pipeline === null && CUSTOM_WHITE_BALANCE_PARAMS.includes(name)) {
          problems.push(`${at}: ${name} goes in priors_by_pipeline, as its unit differs (${PIPELINES.map((p) => `${WHITE_BALANCE_UNITS[p]} on ${p}`).join(", ")})`);
          continue;
        }
        const on = pipeline === null ? PIPELINES : [pipeline];
        const colourOn = on.find((p) => monochrome(p) && isColourParam(name));
        if (colourOn) problems.push(`${at}: the ${colourOn} profile "${intent.profile?.[colourOn]}" is monochrome and drops ${name}'s slider`);
        for (const p of on) {
          const problem = this.priorProblem(name, value, p);
          if (problem !== null) {
            problems.push(`${at}: ${problem}`);
            break;
          }
        }
      }
    };
    const checkSet = (where: string, set: PriorSet): void => {
      checkPriors(`${where}priors`, set.priors, null);
      for (const p of PIPELINES) {
        const own = set.priors_by_pipeline?.[p];
        if (!own) continue;
        checkPriors(`${where}priors_by_pipeline.${p}`, own, p);
        for (const name of Object.keys(own)) if (name in set.priors) problems.push(`${where}priors_by_pipeline.${p}.${name}: ${name} is also in ${where}priors; give it in one place`);
      }
    };
    checkSet("", intent);
    if (intent.variants) for (const key of ["A", "B", "C"] as const) checkSet(`variants.${key}.`, intent.variants[key]);
    if (intent.profile !== undefined) problems.push(...this.profileProblems(intent.profile));
    if (problems.length > 0) throw new IntentError("invalid_intent", `the intent has invalid values: ${problems.join("; ")}`, problems);
    return intent;
  }

  /** Each pipeline's profile must be a pinned profile of that pipeline. */
  private profileProblems(profile: Readonly<Record<Pipeline, string>>): string[] {
    const profiles = this.map.cameraProfiles();
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

  /** What is wrong with one prior on one pipeline, or null. */
  private priorProblem(name: string, value: unknown, pipeline: Pipeline): string | null {
    const spec = this.map.spec(name, pipeline);
    if (spec?.kind === "number") {
      const range = spec.max - spec.min;
      if (typeof value !== "number" || !Number.isFinite(value)) return "must be a number (an offset added to the photo's value)";
      if (Math.abs(value) > range) return `an offset of ${value} is larger than the whole range ${spec.min}..${spec.max} on the ${pipeline} pipeline`;
      return null;
    }
    try {
      this.map.toSdk({ [name]: value }, { processVersion: SUPPORTED_PROCESS_VERSIONS[0] as string, pipeline });
      return null;
    } catch (err) {
      if (!(err instanceof ParamError)) throw err;
      return err.message;
    }
  }

  private jsonFiles(dir: string, source: IntentSource, warnings: IntentWarning[]): string[] {
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".json"))
        .map((e) => e.name)
        .sort();
    } catch (err) {
      // No user folder yet is normal; a missing bundled folder is not.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT" || source === "bundled") {
        warnings.push({ source, file: dir, problem: `cannot read the folder: ${(err as Error).message}` });
      }
      return [];
    }
  }
}

/** Null for a schema v2 intent; else how to rewrite it (schema v1 is not read: decision I1 A [stated: Jim, 2026-10-09, "Go"]). */
function versionProblem(candidate: unknown): string | null {
  const version = typeof candidate === "object" && candidate !== null ? (candidate as Record<string, unknown>)["schema_version"] : undefined;
  if (version === INTENT_SCHEMA_VERSION) return null;
  const which = version === undefined ? "missing, so this is a schema v1 intent" : `${JSON.stringify(version)} is not supported`;
  return `schema_version: ${which}; write it as schema v2: "schema_version": 2, "default_camera_profile" becomes "profile": {"raw": …, "rendered": "Color" or "Monochrome"}, and temperature and tint priors move to "priors_by_pipeline": {"raw": {…}}`;
}

/**
 * The sliders a monochrome profile takes out of the settings table: Saturation, Vibrance and the HSL
 * keys, on rendered photos [handle: docs\reports\phase8\S10.md "Profiles", run 2 `keys_dropped`] and on
 * raw ones (159 keys against 177 [handle: docs\reports\phase0\S5\part1\s5_profiles.log]).
 */
function isColourParam(name: string): boolean {
  return name === "saturation" || name === "vibrance" || name.startsWith("hsl.");
}

function problemText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
