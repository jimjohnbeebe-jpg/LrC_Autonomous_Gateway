// The intents and log folders (PRD section 6.2; PHASE5_PLAN decision 2d): the environment variable
// when it is set, else the settings page's folder when it holds a full path, else the default
// (<Documents>\LrC-AVG\intents since issue #180, intents\folder.ts; %LOCALAPPDATA%\LrC-AVG\logs). The dev Claude Desktop entry sets LRC_AVG_LOG_DIR
// to the repo's logs\ folder [handle: engine\src\devtools\install-desktop-config-cli.ts, the
// engineEntry call], so there the variable wins, as decided; the user entry written by
// `lrc-avg-setup` sets no variable (setup\setup-cli.ts). A page folder applies from the next read
// of the page: every lr_begin_session reads it, and the intent tools, lr_get_session_log and lr_sync_series too
// (decision 2A of the row 3 plan [stated: Jim, 2026-09-28, "Go with recommendations"]). The engine's
// own tool log stays where it opened at start (mcp\main.ts).

import { defaultLogDir } from "../log/index.js";
import { defaultUserIntentsDir, documentsFolder, locateFolder, type FolderLocation } from "../intents/index.js";
import type { PageValues } from "./page.js";

export type FolderFrom = "environment" | "page" | "default";
export type FolderChoice = { path: string; from: FolderFrom; problem?: string };

/** A full path, as Prefs.lua checks it: a drive letter and a separator, or a network share. */
export function isFullPath(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p) || /^[\\/]{2}[^\\/]/.test(p);
}

function choose(envValue: string | undefined, pageValue: string | undefined, fallback: string): FolderChoice {
  if (envValue) return { path: envValue, from: "environment" };
  const page = pageValue?.trim() ?? "";
  if (page !== "" && isFullPath(page)) return { path: page, from: "page" };
  if (page !== "") return { path: fallback, from: "default", problem: `the page's folder "${page}" is not a full path` };
  return { path: fallback, from: "default" };
}

export class EngineFolders {
  private readonly env: NodeJS.ProcessEnv;
  private readonly documents: () => string;
  private page: { intents: string | undefined; log: string | undefined } = { intents: undefined, log: undefined };

  /** `documents`: Windows' Documents folder, for the tests. */
  constructor(env: NodeJS.ProcessEnv = process.env, documents: () => string = documentsFolder) {
    this.env = env;
    this.documents = documents;
  }

  /** Take the folders of a page read; a failed read keeps the ones read before. */
  update(read: { read: boolean; values: Partial<PageValues> }): void {
    if (read.read) this.page = { intents: read.values.intents_dir, log: read.values.log_dir };
  }

  intents(): FolderChoice {
    const fallback = defaultUserIntentsDir({ ...this.env, LRC_AVG_INTENTS_DIR: undefined }, this.documents);
    return choose(this.env["LRC_AVG_INTENTS_DIR"], this.page.intents, fallback);
  }

  /** Where `dir` really is on disk for this engine, and whether Windows redirects it (intents\folder.ts locateFolder). */
  locate(dir: string): FolderLocation {
    return locateFolder(dir, this.env);
  }

  log(): FolderChoice {
    const fallback = defaultLogDir({ ...this.env, LRC_AVG_LOG_DIR: undefined });
    return choose(this.env["LRC_AVG_LOG_DIR"], this.page.log, fallback);
  }

  intentsDir(): string {
    return this.intents().path;
  }

  logDir(): string {
    return this.log().path;
  }
}
