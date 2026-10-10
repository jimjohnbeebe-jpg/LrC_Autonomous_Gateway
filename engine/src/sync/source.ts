// lr_sync_series' source (MCP_TOOLS lr_sync_series): the recipe of an accepted session, a recipe
// file, or canonical settings. A session's recipe is the file lr_end_session "accept" writes next to
// its log, <yyyymmdd>-<short id>.recipe.json (log\session-log.ts SessionLogFiles); in Variants mode
// it is the pick's (session\end.ts). A recipe path must name a .recipe.json file inside the log
// folder, as the preview reader only reads inside its own folder (preview\service.ts take())
// [inference: the engine reads no file a tool argument names elsewhere]. Settings are validated
// against the params map before anything is written.
// The log folders are the current one first, then the earlier ones a session log was written to
// (settings\log-folders.ts, Greptile PR #44): a recipe is looked up in each, and a recipe path is
// accepted inside any of them.

import { readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { recipeSchema, type Recipe } from "../log/index.js";
import { ToolError } from "../mcp/errors.js";
import { ParamError, SUPPORTED_PROCESS_VERSIONS, type CanonicalSettings, type ParamMap, type Pipeline } from "../params/index.js";

export type SyncSource = { session_id: string } | { recipe_path: string } | { settings: Record<string, unknown> };

export type ResolvedSource = {
  kind: "session" | "recipe" | "settings";
  settings: CanonicalSettings;
  /** The source photo's pipeline (a recipe from engine 0.21.0 on); null when unknown: bare settings, an older recipe (transfer.ts). */
  pipeline: Pipeline | null;
  /** The photo a recipe was taken from; null for bare settings. */
  photo: { uuid: string; filename: string | null } | null;
  session_id: string | null;
  recipe_path: string | null;
  /** How many masks the recipe's photo kept (engine 0.16.0 recipes); the sync copies none of them. */
  masks: number;
};

const RECIPE_SUFFIX = ".recipe.json";

/**
 * Refuse unknown names, wrong types and out-of-range values now, before any target is touched: valid
 * on either pipeline, as the source may be a JPEG or a raw file. Each target's write then checks the
 * values against the target's own pipeline (target.ts write) [stated: Jim, 2026-10-09, "Go" to the row 3
 * plan, decision R1 A].
 */
function validated(map: ParamMap, settings: Record<string, unknown>): CanonicalSettings {
  const processVersion = SUPPORTED_PROCESS_VERSIONS[0] as string;
  try {
    map.toSdk(settings, { processVersion, pipeline: "raw" });
  } catch (err) {
    if (!(err instanceof ParamError)) throw err;
    try {
      map.toSdk(settings, { processVersion, pipeline: "rendered" });
    } catch {
      throw err; // the raw pipeline's reason
    }
  }
  return settings as CanonicalSettings;
}

function parseRecipe(file: string): Recipe {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new ToolError("INVALID_RECIPE", `Cannot read the recipe ${file}: ${(err as Error).message}`, false);
  }
  const parsed = recipeSchema.safeParse(raw);
  if (!parsed.success) throw new ToolError("INVALID_RECIPE", `${file} is not an LrC-AVG recipe: ${parsed.error.issues[0]?.message ?? "invalid"}`, false);
  return parsed.data;
}

/** The recipe lr_end_session "accept" wrote for this session (same file naming as session\end.ts readSessionLog), in the first log folder that has it. */
function findRecipe(logDirs: readonly string[], sessionId: string): { file: string; recipe: Recipe } {
  const short = sessionId.replace(/-/g, "").slice(0, 6);
  for (const logDir of logDirs) {
    let names: string[] = [];
    try {
      names = readdirSync(logDir).filter((f) => f.endsWith(`-${short}${RECIPE_SUFFIX}`));
    } catch {
      // no such folder (yet, or any more)
    }
    for (const name of names) {
      const file = path.join(logDir, name);
      const recipe = parseRecipe(file);
      if (recipe.session_id === sessionId) return { file, recipe };
    }
  }
  throw new ToolError(
    "RECIPE_NOT_FOUND",
    `No recipe for session ${sessionId} in ${logDirs.join(", ")}. A session writes its recipe only when it ends with lr_end_session outcome "accept".`,
    false,
  );
}

function isInside(dir: string, file: string): boolean {
  const rel = path.relative(dir, file);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * A recipe file named by path (relative: to the current log folder): a .recipe.json inside one of
 * the log folders, also once links are resolved.
 */
function readRecipe(logDirs: readonly string[], recipePath: string): { file: string; recipe: Recipe } {
  const current = logDirs[0] as string;
  const file = path.resolve(current, recipePath);
  const refuse = (why: string): never => {
    throw new ToolError("RECIPE_PATH_REFUSED", `recipe_path ${why}: ${recipePath}. Recipes are read only from the log folders ${logDirs.join(", ")}.`, false);
  };
  const home = logDirs.find((dir) => isInside(path.resolve(dir), file));
  if (!file.toLowerCase().endsWith(RECIPE_SUFFIX) || home === undefined) refuse("is not a .recipe.json file in a log folder");
  let real: string;
  try {
    real = realpathSync(file);
  } catch {
    throw new ToolError("RECIPE_NOT_FOUND", `There is no recipe file ${file}.`, false);
  }
  if (!isInside(realpathSync(home as string), real)) refuse("resolves outside the log folder");
  return { file, recipe: parseRecipe(real) };
}

/** `logDirs`: the current log folder first, then earlier ones (at least one). */
export function resolveSource(logDirs: readonly string[], map: ParamMap, source: SyncSource): ResolvedSource {
  if ("settings" in source) {
    return { kind: "settings", settings: validated(map, source.settings), pipeline: null, photo: null, session_id: null, recipe_path: null, masks: 0 };
  }
  const { file, recipe } = "session_id" in source ? findRecipe(logDirs, source.session_id) : readRecipe(logDirs, source.recipe_path);
  return {
    kind: "session_id" in source ? "session" : "recipe",
    settings: validated(map, recipe.settings),
    pipeline: recipe.pipeline ?? null,
    photo: recipe.source,
    session_id: recipe.session_id,
    recipe_path: file,
    masks: recipe.masks ?? 0,
  };
}
