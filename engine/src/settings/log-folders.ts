// The log folders session logs were written to, so that a session is still found after the settings
// page's log folder changes (Greptile, PR #44: lr_sync_series looked only in the current folder).
// Jim chose to keep them across Claude Desktop restarts [stated: 2026-09-29, "Remember folders
// (Recommended)"]: %USERPROFILE%\.lrc-avg\log_folders.json, next to the plugin's token and ports
// files, newest first, at most MAX_LOG_FOLDERS. lr_begin_session records its folder;
// lr_sync_series and lr_get_session_log search the current folder first, then these. A recipe path
// is accepted inside any of them (sync\source.ts), as it was inside the one log folder before.
// Only the engine that holds the instance lock begins sessions (mcp\bridge-gate.ts), so one engine
// writes the file at a time; it writes a temporary file and renames it over the old one.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

export const MAX_LOG_FOLDERS = 20;

export function defaultLogFoldersPath(): string {
  return path.join(os.homedir(), ".lrc-avg", "log_folders.json");
}

const fileSchema = z.looseObject({ folders: z.array(z.string().min(1)) });

/** Windows paths compare without case (NTFS default) [inference: case-sensitive folders are rare]. */
function sameFolder(a: string, b: string): boolean {
  const norm = (p: string) => (process.platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p));
  return norm(a) === norm(b);
}

/** `current` first, then each of `earlier` not already in the list. */
export function searchOrder(current: string, earlier: readonly string[]): string[] {
  const out = [current];
  for (const dir of earlier) if (!out.some((d) => sameFolder(d, dir))) out.push(dir);
  return out;
}

export class KnownLogFolders {
  private readonly file: string;

  constructor(file: string = defaultLogFoldersPath()) {
    this.file = file;
  }

  /** The folders recorded, newest first; none when the file is missing or unreadable. */
  list(): string[] {
    try {
      const parsed = fileSchema.safeParse(JSON.parse(readFileSync(this.file, "utf8")));
      return parsed.success ? parsed.data.folders.slice(0, MAX_LOG_FOLDERS) : [];
    } catch {
      return [];
    }
  }

  /**
   * Record `dir` as the newest folder. Returns false when the file cannot be written: a session is
   * never refused for that; only a later search misses the folder.
   */
  remember(dir: string): boolean {
    const resolved = path.resolve(dir);
    const current = this.list();
    if (current[0] !== undefined && sameFolder(current[0], resolved)) return true;
    const folders = [resolved, ...current.filter((d) => !sameFolder(d, resolved))].slice(0, MAX_LOG_FOLDERS);
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${process.pid}.tmp`;
      writeFileSync(temporary, `${JSON.stringify({ folders }, null, 2)}\n`, "utf8");
      renameSync(temporary, this.file);
      return true;
    } catch {
      return false;
    }
  }
}
