// The intent library (ARCHITECTURE section 7, PRD section 6.9).
//
// Intents come from two folders, read again on every call so that a file edited between calls is
// seen at once:
//   1. bundled: engine\intents\ (shipped with the engine);
//   2. user: %LOCALAPPDATA%\LrC-AVG\intents\ (PRD section 6.2), or LRC_AVG_INTENTS_DIR when set.
// A user file with the same id replaces the bundled intent. A file that fails validation is
// skipped and reported as a warning, from either folder, so one bad file cannot stop the engine.
// Copying the bundled set into the user folder on first run is packaging work (PHASES.md Phase 6).
//
// Validation: the file must be <id>.json and match the schema (schema.ts); every prior must name a
// canonical parameter; default_camera_profile must be a pinned profile name.
// What a prior means [inference: PRD 6.9 says only "settings applied at pass 0"; chosen so that an
// intent does not wipe edits the photo already has]:
//   - a number (exposure, vibrance, temperature, ...) is an offset added to the photo's current
//     value, so it must be finite and no larger than the parameter's whole range;
//   - a switch, a boolean or a curve is set as given, so it must be a value the params map writes.
//
// Claude-proposed intents are written only through save(), which the lr_save_intent tool calls
// after Jim approves in chat (the tool also requires `confirmed: true`).

import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CAMERA_PROFILE_PARAM, ParamError, SUPPORTED_PROCESS_VERSIONS, UnknownCameraProfileError, type ParamMap } from "../params/index.js";
import { intentSchema, type Intent } from "./schema.js";

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
  private readonly userDir: string;
  private readonly map: ParamMap;

  constructor(options: { map: ParamMap; bundledDir?: string; userDir?: string }) {
    this.map = options.map;
    this.bundledDir = options.bundledDir ?? bundledIntentsDir();
    this.userDir = options.userDir ?? defaultUserIntentsDir();
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
    const { intents } = this.load();
    const existing = intents.get(intent.id);
    const replaced = existing?.source === "user";
    if (replaced && !options.replace) {
      throw new IntentError("intent_exists", `A user intent "${intent.id}" already exists (${existing?.path ?? this.userDir}); pass replace: true to replace it.`);
    }
    mkdirSync(this.userDir, { recursive: true });
    const target = path.join(this.userDir, `${intent.id}.json`);
    // Write a temporary file and rename it, so a crash never leaves half a file for the loader.
    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(intent, null, 2)}\n`, "utf8");
    renameSync(temporary, target);
    return { path: target, replaced, overrides_bundled: existing?.source === "bundled" || (existing?.overrides_bundled ?? false) };
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

  /** Validate an intent object: the schema, then priors and profile against the params map. */
  check(candidate: unknown): Intent {
    const parsed = intentSchema.safeParse(candidate);
    if (!parsed.success) {
      const problems = parsed.error.issues.map((i) => `${i.path.length ? i.path.join(".") : "intent"}: ${i.message}`);
      throw new IntentError("invalid_intent", `the intent does not match the schema: ${problems.join("; ")}`, problems);
    }
    const intent = parsed.data;
    const problems: string[] = [];
    const checkPriors = (where: string, priors: Intent["priors"]): void => {
      for (const [name, value] of Object.entries(priors)) {
        if (name === CAMERA_PROFILE_PARAM) {
          problems.push(`${where}.${name}: put the camera profile in default_camera_profile, not in priors`);
          continue;
        }
        const spec = this.map.spec(name);
        if (spec?.kind === "number") {
          const range = spec.max - spec.min;
          if (typeof value !== "number" || !Number.isFinite(value)) problems.push(`${where}.${name}: must be a number (an offset added to the photo's value)`);
          else if (Math.abs(value) > range) problems.push(`${where}.${name}: an offset of ${value} is larger than the whole range ${spec.min}..${spec.max}`);
          continue;
        }
        try {
          this.map.toSdk({ [name]: value }, { processVersion: SUPPORTED_PROCESS_VERSIONS[0] as string });
        } catch (err) {
          if (!(err instanceof ParamError)) throw err;
          problems.push(`${where}.${name}: ${err.message}`);
        }
      }
    };
    checkPriors("priors", intent.priors);
    if (intent.variants) for (const key of ["A", "B", "C"] as const) checkPriors(`variants.${key}.priors`, intent.variants[key].priors);
    if (intent.default_camera_profile !== undefined) {
      try {
        this.map.cameraProfiles().toSdk(intent.default_camera_profile);
      } catch (err) {
        if (!(err instanceof UnknownCameraProfileError)) throw err;
        problems.push(`default_camera_profile: ${err.message}`);
      }
    }
    if (problems.length > 0) throw new IntentError("invalid_intent", `the intent has invalid values: ${problems.join("; ")}`, problems);
    return intent;
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

function problemText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
