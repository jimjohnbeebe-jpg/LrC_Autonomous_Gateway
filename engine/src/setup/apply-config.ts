// The file work behind `lrc-avg-setup` and `npm run desktop:install` (the rules are in
// desktop-config.ts). Behaviour, as in the S3 installer: validates the file, writes a timestamped
// backup next to it before changing anything, reads the result back (and puts the original back if
// it does not match), and changes nothing the second time. When no config file exists but exactly
// one Claude Desktop folder does, the file is created there (PHASE6_PLAN row 1, decision D1). Which
// folders count (Claude-Data, the Packages folder unless marked as left, the classic one) is in
// desktop-config.ts.
// Results name servers only, never env values (another server's env may hold a token).

import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CONFIG_FILE, desktopConfigSchema, findClaudeFolders, findDesktopConfigs, planConfig, SERVER_NAME, type DesktopConfig, type ServerEntry } from "./desktop-config.js";

/** Why a setup failed, for `--installer`'s result file: no Claude Desktop (or no file) to work on, more than one candidate, anything else. */
export type SetupErrorKind = "not_found" | "ambiguous" | "error";

/** A failure that left the config as it was; the message says why. */
export class SetupError extends Error {
  readonly kind: SetupErrorKind;
  constructor(message: string, kind: SetupErrorKind = "error") {
    super(message);
    this.name = "SetupError";
    this.kind = kind;
  }
}

export type ApplyOptions = {
  /** The engine entry to set; null removes it (`--remove`). */
  entry: ServerEntry | null;
  /** `--config <path>`: use this existing file instead of looking for one. */
  configPath?: string | undefined;
  dryRun?: boolean;
  env?: NodeJS.ProcessEnv;
};

export type ApplyResult = {
  configPath: string;
  /** The file did not exist and was (or, in a dry run, would be) created. */
  created: boolean;
  before: string[];
  after: string[];
  /** What changed, e.g. `add "lrc-avg"`; empty when nothing did. */
  changes: string[];
  /** The "lrc-avg" entry itself was added, updated or (for `--remove`) taken out; false when only a retired server went or nothing did. */
  entryChanged: boolean;
  /** The backup's file name, when one was written. */
  backup: string | null;
};

function locate(explicit: string | undefined, env: NodeJS.ProcessEnv): { file: string; exists: boolean } {
  if (explicit !== undefined) {
    const file = path.resolve(explicit);
    if (!existsSync(file)) throw new SetupError(`config file not found: ${file}`, "not_found");
    return { file, exists: true };
  }
  const found = findDesktopConfigs(env);
  // Writing to the wrong one would "succeed" while Claude Desktop keeps reading the other.
  if (found.length > 1) throw new SetupError(`found ${found.length} Claude Desktop config files, so it is not clear which one Claude Desktop uses:\n  ${found.join("\n  ")}`, "ambiguous");
  if (found.length === 1) return { file: found[0] as string, exists: true };
  const folders = findClaudeFolders(env);
  if (folders.length === 0) throw new SetupError("Claude Desktop's folder was not found. Start Claude Desktop once in this Windows account, quit it, then run this again.", "not_found");
  if (folders.length > 1) throw new SetupError(`found ${folders.length} Claude Desktop folders and no config file, so it is not clear which one Claude Desktop uses:\n  ${folders.join("\n  ")}`, "ambiguous");
  return { file: path.join(folders[0] as string, CONFIG_FILE), exists: false };
}

function read(file: string): DesktopConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch (err) {
    throw new SetupError(`the config file is not valid JSON (${(err as Error).message}); it was left as it is.`);
  }
  const parsed = desktopConfigSchema.safeParse(raw);
  if (!parsed.success) throw new SetupError(`the config file has an unexpected shape; it was left as it is. (${parsed.error.issues[0]?.message ?? "invalid"})`);
  return parsed.data;
}

/** Sets (or removes) the engine entry in Claude Desktop's config. Throws SetupError, with the file unchanged. */
export function applyDesktopConfig(options: ApplyOptions): ApplyResult {
  const env = options.env ?? process.env;
  const { file, exists } = locate(options.configPath, env);
  const config: DesktopConfig = exists ? read(file) : {};
  const plan = planConfig(config, options.entry);
  const before = Object.keys(config.mcpServers ?? {});
  const after = Object.keys(plan.updated.mcpServers ?? {});
  const changes = [
    plan.added ? `add "${SERVER_NAME}"` : plan.updatedEntry ? `update "${SERVER_NAME}"` : null,
    ...plan.removed.map((name) => `remove "${name}"`),
  ].filter((c): c is string => c !== null);
  const entryChanged = plan.added || plan.updatedEntry || plan.removed.includes(SERVER_NAME);
  const result: ApplyResult = { configPath: file, created: !exists && !plan.unchanged, before, after, changes, entryChanged, backup: null };
  if (plan.unchanged || options.dryRun) return result;

  const text = JSON.stringify(plan.updated, null, 2) + "\n";
  if (exists) {
    const backup = `${path.basename(file)}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    try {
      copyFileSync(file, path.join(path.dirname(file), backup));
    } catch (err) {
      throw new SetupError(`could not write a backup next to the config (${(err as Error).message}); nothing was changed.`);
    }
    result.backup = backup;
  }
  // A failed or partial write must not leave a truncated config: put the original back on any error
  // as well as on a read-back that differs.
  let problem: string | null;
  try {
    writeFileSync(file, text);
    problem = readFileSync(file, "utf8") === text ? null : "the config did not read back as written";
  } catch (err) {
    problem = `writing the config failed (${(err as Error).message})`;
  }
  if (problem !== null) throw new SetupError(`${problem}; ${putBack(file, result.backup)}`);
  return result;
}

/** Restores the backup (or deletes a file that did not exist before) and says what happened. */
function putBack(file: string, backup: string | null): string {
  try {
    if (backup) copyFileSync(path.join(path.dirname(file), backup), file);
    else rmSync(file, { force: true });
    return "the original was put back.";
  } catch (err) {
    return `putting the original back failed too (${(err as Error).message}): ${backup ? `copy ${backup} over ${path.basename(file)} by hand` : `delete ${file}`}.`;
  }
}

/** The lines both commands print for a result. */
export function describeResult(r: ApplyResult, dryRun: boolean): string[] {
  const lines = [`Claude Desktop config: ${r.configPath}${r.created ? " (new file)" : ""}`, `MCP servers before: ${r.before.join(", ") || "(none)"}`];
  if (r.changes.length === 0) return [...lines, `Nothing to change: "${SERVER_NAME}" is already as wanted.`];
  if (dryRun) return [...lines, `--dry-run: would ${r.changes.join(", ")}; nothing was written.`];
  const backup = r.backup ? ` (backup of the old file: ${r.backup})` : "";
  return [...lines, `Done: ${r.changes.join(", ")}${backup}.`, `MCP servers now: ${r.after.join(", ") || "(none)"}`];
}
