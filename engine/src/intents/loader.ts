// The intent library (ARCHITECTURE section 7, PRD section 6.9).
//
// Intents come from two folders, read again on every call so that a file edited between calls is
// seen at once:
//   1. bundled: engine\intents\ (shipped with the engine);
//   2. user: <Documents>\LrC-AVG\intents\ (folder.ts; issue #180 moved it out of %LOCALAPPDATA%, which
//      Claude Desktop from the Microsoft Store redirects), or LRC_AVG_INTENTS_DIR when set;
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
// Validation (validate.ts): the file must be <id>.json and match schema v2 or v3 (schema.ts; a v1 file
// is skipped with a warning saying how to rewrite it); every prior and set value must name a canonical
// parameter, with a value valid on each pipeline it applies to; profiles must be pinned profiles of
// their pipeline.
//
// Claude-proposed intents are written only through save(), which the lr_save_intent tool calls
// after Jim approves in chat (the tool also requires `confirmed: true`).

import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ParamMap } from "../params/index.js";
import { IntentError } from "./errors.js";
import { defaultUserIntentsDir } from "./folder.js";
import { INTENT_ID_PATTERN, type Intent } from "./schema.js";
import { checkIntent } from "./validate.js";

export { IntentError, type IntentErrorCode } from "./errors.js";
export { isColourParam } from "./validate.js";

export type IntentSource = "bundled" | "user";
/** "none": a session begun without an intent (session\begin.ts NO_INTENT). */
export type LoadedIntent = { intent: Intent; source: IntentSource | "none"; path: string; overrides_bundled: boolean };
export type IntentWarning = { source: IntentSource; file: string; problem: string };
export type IntentSummary = { id: string; label: string; category: string; source: LoadedIntent["source"] };

/** engine\intents\, next to src\ and dist\ (this file is <engine>\{src,dist}\intents\loader.*). */
export function bundledIntentsDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "intents");
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

  /**
   * Delete the user file <id>.json, valid or skipped (issue #108). Bundled intents are never deleted;
   * a bundled intent the file overrode is used again.
   */
  delete(id: string): { path: string; restores_bundled: boolean } {
    if (!INTENT_ID_PATTERN.test(id)) throw new IntentError("intent_not_found", `"${id}" is not an intent id (lower case letters, digits and _).`);
    // The user folder may be set to the bundled folder itself (Greptile, PR #120): its files are never deleted.
    if (sameFolder(this.userDir, this.bundledDir)) {
      throw new IntentError("intent_not_found", `The intents folder is the engine's bundled folder (${this.bundledDir}); bundled intents cannot be deleted.`);
    }
    const target = path.join(this.userDir, `${id}.json`);
    if (!existsSync(target)) {
      const bundled = existsSync(path.join(this.bundledDir, `${id}.json`));
      throw new IntentError("intent_not_found", bundled ? `"${id}" is a bundled intent; only the user's own intents can be deleted.` : `There is no user intent "${id}" in ${this.userDir}.`);
    }
    rmSync(target);
    return { path: target, restores_bundled: this.load().intents.get(id)?.source === "bundled" };
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

  /** Validate an intent object (validate.ts). */
  check(candidate: unknown): Intent {
    return checkIntent(candidate, this.map);
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

/** Two paths to one folder, after links; Windows paths compare without case. */
function sameFolder(a: string, b: string): boolean {
  try {
    return realpathSync.native(a).toLowerCase() === realpathSync.native(b).toLowerCase();
  } catch {
    return false; // a folder that does not exist yet is not the bundled one
  }
}

function problemText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
