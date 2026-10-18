// Once, when the user intents folder is the default <Documents>\LrC-AVG\intents (issue #180): copy the
// intents that are missing there from the two places the old default put them, the real
// %LOCALAPPDATA%\LrC-AVG\intents (written by programs that are not packaged) and the private copy of each
// Claude Desktop package, %LOCALAPPDATA%\Packages\Claude_*\LocalCache\Local\LrC-AVG\intents. Files are
// never overwritten and the old ones are never deleted. A marker file in the new folder lists what was
// copied and from where; while it exists, nothing is copied again. It is not a .json file, which the
// loader would read as an intent (loader.ts jsonFiles). A packaged engine is assumed to see the real
// folder too, as the doc in folder.ts describes the merged view [inference]; if it does not, the intents
// of the real folder are missing here and the marker blocks a second look: deleting it copies again.

import { constants, copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export const MIGRATION_MARKER = "migrated-from-appdata.txt";

export type Copied = { file: string; from: string };

export type OldFolder = { kind: "real" | "package"; dir: string };

/** The folders to copy from, in order: the real one, then each Claude package's (any letter case, as setup\desktop-config.ts matches them). */
export function oldIntentFolders(env: NodeJS.ProcessEnv): OldFolder[] {
  const local = env["LOCALAPPDATA"];
  if (!local) return [];
  const packages = path.join(local, "Packages");
  let claude: string[] = [];
  try {
    claude = readdirSync(packages).filter((n) => n.toLowerCase().startsWith("claude_")).sort();
  } catch {
    // no Packages folder
  }
  return [
    { kind: "real", dir: path.join(local, "LrC-AVG", "intents") },
    ...claude.map((pkg): OldFolder => ({ kind: "package", dir: path.join(packages, pkg, "LocalCache", "Local", "LrC-AVG", "intents") })),
  ];
}

/** Copy what `target` is missing; returns what was copied, or why it stopped. Does nothing once the marker exists. Never throws. */
export function migrateIntents(target: string, env: NodeJS.ProcessEnv = process.env, now: Date = new Date()): { copied: Copied[]; problem?: string } {
  const copied: Copied[] = [];
  try {
    if (existsSync(path.join(target, MIGRATION_MARKER))) return { copied };
    for (const { dir: from } of oldIntentFolders(env)) {
      if (path.resolve(from).toLowerCase() === path.resolve(target).toLowerCase() || !existsSync(from)) continue;
      for (const entry of readdirSync(from, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".json")) continue;
        mkdirSync(target, { recursive: true });
        try {
          copyFileSync(path.join(from, entry.name), path.join(target, entry.name), constants.COPYFILE_EXCL); // fails when the file is there
          copied.push({ file: entry.name, from });
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        }
      }
    }
    if (copied.length > 0) {
      const lines = copied.map((c) => `${c.file} <- ${c.from}`);
      writeFileSync(path.join(target, MIGRATION_MARKER), [`Copied by LrC-AVG on ${now.toISOString()} (issue #180). The old files were left where they are. Delete this file to copy again.`, ...lines, ""].join("\n"), "utf8");
    }
    return { copied };
  } catch (err) {
    return { copied, problem: `moving the intents of the older folders into ${target} stopped: ${err instanceof Error ? err.message : String(err)}` };
  }
}

const done = new Set<string>();
let pending: string[] = [];

/** `migrateIntents` once per process and folder; what it did is kept for takeMigrationNotes. */
export function migrateOnce(target: string, env: NodeJS.ProcessEnv = process.env): void {
  if (done.has(target)) return;
  done.add(target);
  const { copied, problem } = migrateIntents(target, env);
  if (copied.length > 0) pending.push(`Copied ${copied.length} intent file(s) into ${target} from the older folders: ${copied.map((c) => `${c.file} (from ${c.from})`).join(", ")}. The old files were left where they are.`);
  if (problem) pending.push(problem);
}

/** What migrateOnce did since the last call, for the tool that reports it; each line is returned once. */
export function takeMigrationNotes(): string[] {
  const notes = pending;
  pending = [];
  return notes;
}
