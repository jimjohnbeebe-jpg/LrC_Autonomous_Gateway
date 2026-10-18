// Where the user intents folder is (issue #180). Under Claude Desktop from the Microsoft Store (MSIX)
// new files under %LOCALAPPDATA% and %APPDATA% go to a private folder of the package, so the old
// default %LOCALAPPDATA%\LrC-AVG\intents split between the packaged engine and every other program
// [handle: https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes,
// "Common file system operations", read 2026-10-18: on Windows 10 1903 and later, new files and folders
// under Local and Roaming are redirected to a per-user, per-package private location, and an open looks
// there first, then in the real folder; the user profile outside AppData is not in the list; observed:
// docs\reports\phase8.5\issue108\msix-intents-folder.txt:23-30]. So the default is now
// <Documents>\LrC-AVG\intents [stated: Jim, 2026-10-18], and this file also finds out whether the
// engine runs virtualized, to say where a folder under AppData really is.

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const SHELL_FOLDERS_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders";

/** The data of the value `name` in `reg query` output ("    Personal    REG_EXPAND_SZ    %USERPROFILE%\Documents"), or null. */
export function parseRegValue(output: string, name: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    const m = /^\s+(\S+)\s+REG_(?:EXPAND_)?SZ\s+(.*?)\s*$/.exec(line);
    if (m?.[1]?.toLowerCase() === name.toLowerCase() && m[2]) return m[2];
  }
  return null;
}

/** `value` with each %NAME% replaced by the variable of that name (any letter case); null when one is not set. */
export function expandEnv(value: string, env: NodeJS.ProcessEnv): string | null {
  let missing = false;
  const text = value.replace(/%([^%]+)%/g, (_all, name: string) => {
    const hit = Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
    if (hit === undefined) missing = true;
    return hit ?? "";
  });
  return missing ? null : text;
}

let documents: string | undefined;

/**
 * Windows' Documents folder, where OneDrive or the user may have moved it: the "Personal" value of
 * HKCU\...\User Shell Folders. Elsewhere, or when the value cannot be read or names a folder that is not
 * there, ~\Documents. Looked up once per process. That a read of HKCU from a packaged process gives the
 * real value follows from the doc above redirecting only writes under HKCU ("Registry") [inference];
 * non-ASCII characters in the value may come back garbled from reg.exe's code page, which the
 * existence check turns into the fallback [unverified].
 */
export function documentsFolder(): string {
  documents ??= lookupDocuments();
  return documents;
}

function lookupDocuments(): string {
  const fallback = path.join(os.homedir(), "Documents");
  if (process.platform !== "win32") return fallback;
  try {
    const out = execFileSync("reg.exe", ["query", SHELL_FOLDERS_KEY, "/v", "Personal"], { encoding: "utf8", windowsHide: true, timeout: 5000, stdio: ["ignore", "pipe", "ignore"] });
    const folder = expandEnv(parseRegValue(out, "Personal") ?? "", process.env);
    return folder && existsSync(folder) ? folder : fallback;
  } catch {
    return fallback;
  }
}

/** LRC_AVG_INTENTS_DIR when set, else <Documents>\LrC-AVG\intents. `documentsDir` is for the tests. */
export function defaultUserIntentsDir(env: NodeJS.ProcessEnv = process.env, documentsDir: () => string = documentsFolder): string {
  return env["LRC_AVG_INTENTS_DIR"] || path.join(documentsDir(), "LrC-AVG", "intents");
}

export type Virtualization = { virtualized: boolean; package?: string };

const detected = new Map<string, Virtualization>();

/**
 * Whether Windows redirects this process's new files under `local` (%LOCALAPPDATA%): write a probe
 * file there, look for it under Packages\*\LocalCache\Local\LrC-AVG\, and delete it wherever it landed.
 * Once per `local` and process; never throws. `create` is for the tests.
 */
export function detectVirtualization(local: string, create: (file: string) => void = (file) => writeFileSync(file, "")): Virtualization {
  let result = detected.get(local);
  if (!result) {
    result = probe(local, create);
    detected.set(local, result);
  }
  return result;
}

function probe(local: string, create: (file: string) => void): Virtualization {
  const name = `.probe-${process.pid}-${randomUUID().slice(0, 8)}.tmp`;
  const here = path.join(local, "LrC-AVG", name);
  const packages = path.join(local, "Packages");
  const inPackage = (pkg: string): string => path.join(packages, pkg, "LocalCache", "Local", "LrC-AVG", name);
  let found: string | undefined;
  try {
    mkdirSync(path.dirname(here), { recursive: true });
    create(here);
    found = readdirSync(packages).find((pkg) => existsSync(inPackage(pkg)));
    return found === undefined ? { virtualized: false } : { virtualized: true, package: found };
  } catch {
    return { virtualized: false };
  } finally {
    for (const file of found === undefined ? [here] : [here, inPackage(found)]) {
      try {
        rmSync(file, { force: true });
      } catch {
        // force ignores only a missing path [handle: https://nodejs.org/api/fs.html#fsrmsyncpath-options]; a probe left behind is harmless, a failed intent tool is not [inference]
      }
    }
  }
}

export type FolderLocation = { real_path: string; virtualized: boolean; package?: string; warning?: string };

/** The folder of `dir` below `root` (a Windows path), or null when `dir` is not below it. */
function below(dir: string, root: string | undefined): string | null {
  if (!root) return null;
  const rel = path.win32.relative(root, dir);
  return rel !== "" && !rel.startsWith("..") && !path.win32.isAbsolute(rel) ? rel : null;
}

/**
 * Where `dir` really is on disk for this engine, and whether it runs virtualized. A folder under
 * %LOCALAPPDATA% or %APPDATA% really is in the package's LocalCache\Local or \Roaming when virtualized,
 * and `warning` says so; any other folder (Documents) is where it says.
 */
export function locateFolder(dir: string, env: NodeJS.ProcessEnv = process.env): FolderLocation {
  const local = env["LOCALAPPDATA"];
  if (process.platform !== "win32" || !local) return { real_path: dir, virtualized: false };
  const { virtualized, package: pkg } = detectVirtualization(local);
  const found = { virtualized, ...(pkg ? { package: pkg } : {}) };
  if (!virtualized || !pkg) return { real_path: dir, ...found };
  const cache = path.win32.join(local, "Packages", pkg, "LocalCache");
  const underLocal = below(dir, local);
  const underRoaming = below(dir, env["APPDATA"]);
  const real = underLocal !== null ? path.win32.join(cache, "Local", underLocal) : underRoaming !== null ? path.win32.join(cache, "Roaming", underRoaming) : null;
  if (real === null) return { real_path: dir, ...found };
  const warning = `Windows keeps the files this engine saves in ${dir} inside its package, at ${real}: File Explorer and other programs do not see them in ${dir}. Set the Intents folder on the settings page to a folder outside AppData (for example Documents\\LrC-AVG\\intents).`;
  return { real_path: real, ...found, warning };
}
