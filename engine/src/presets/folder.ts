// Where preset files go and how they are named. Lightroom keeps a user preset's file in
// %APPDATA%\Adobe\CameraRaw\Settings\ as "<name>.xmp", with its group only inside the file, even
// for a new group [handle: docs\reports\phase4\S7.md "Consequences", row 9;
// engine\tests\fixtures\presets\reference-settings.lrc15.json `reference.file` "AVG preset
// reference.xmp", group "LrC-AVG"]. LRC_AVG_PRESET_DIR overrides the folder (tests, dry runs).
// A preset is never written over another file, and never under a name another preset already has.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ToolError } from "../mcp/errors.js";
import { presetIdentity } from "./xmp-parse.js";
import { escapeXml } from "./xmp-write.js";

/** The group presets go in unless the call names another [stated: Jim, 2026-09-28, plan decision 4]. */
export const DEFAULT_GROUP = "LrC-AVG";
export const MAX_NAME_LENGTH = 100;

export function defaultPresetDir(env: NodeJS.ProcessEnv = process.env): string | null {
  const override = env["LRC_AVG_PRESET_DIR"];
  if (override) return override;
  const appData = env["APPDATA"];
  return appData ? path.join(appData, "Adobe", "CameraRaw", "Settings") : null;
}

/**
 * Windows' reserved device names, also with an extension (NUL.txt), and with the superscript digits
 * ¹ ² ³; forbidden characters; no space or period at the end [handle:
 * https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file, read 2026-09-28].
 */
const RESERVED = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(\..*)?$/i;

/** A preset name that is also a Windows file name; `what` names the argument in the message. */
export function checkPresetName(name: string, what: "name" | "folder"): string {
  const bad = (why: string): never => {
    throw new ToolError("INVALID_PRESET_NAME", `The preset ${what} "${name}" ${why}.`, false);
  };
  if (name.trim() === "") bad("is empty");
  if (name.length > MAX_NAME_LENGTH) bad(`is longer than ${MAX_NAME_LENGTH} characters`);
  if (name !== name.trim()) bad("starts or ends with a space");
  if (/[\u0000-\u001f]/.test(name)) bad("contains a control character");
  if (what === "name") {
    if (/[<>:"/\\|?*]/.test(name)) bad('contains one of < > : " / \\ | ? *, which a file name cannot hold');
    if (name.endsWith(".")) bad("ends with a dot");
    if (RESERVED.test(name)) bad("is a name Windows reserves");
  }
  return name;
}

/** A preset file that holds the name; `unreadable`: the reader could not parse it, so its name is not known for sure. */
export type PresetFile = { file: string; group: string | null; unreadable?: true };

/**
 * A file's text, or null for what cannot be a preset Lightroom lists: a folder, a link to nothing,
 * a file that cannot be read (Greptile, PR #36 round 2: a dangling link stopped every call)
 * [inference: Lightroom, running as the same user, cannot read such a file either].
 */
export function presetText(file: string): string | null {
  try {
    return statSync(file).isFile() ? readFileSync(file, "utf8") : null;
  } catch {
    return null;
  }
}

/**
 * Whether a file this reader cannot parse may be a preset of that name: it holds the name as text,
 * as is or XML-escaped. A file that does not parse never counts as proof that a name is free
 * (Greptile, PR #36). A name written with numeric character references would be missed
 * [inference: Lightroom's two files use none, engine\tests\fixtures\presets\].
 */
const mayHoldName = (text: string, name: string): boolean => text.includes(name) || text.includes(escapeXml(name));

/** Every preset file under `dir` whose crs:Name is `name` (or may be), as paths relative to `dir`, with its group. */
export function findPresetFiles(dir: string, name: string): PresetFile[] {
  const found: PresetFile[] = [];
  for (const rel of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
    const text = rel.toLowerCase().endsWith(".xmp") ? presetText(path.join(dir, rel)) : null;
    if (text === null) continue;
    try {
      const id = presetIdentity(text);
      if (id.name === name) found.push({ file: rel, group: id.group });
    } catch {
      if (mayHoldName(text, name)) found.push({ file: rel, group: null, unreadable: true });
    }
  }
  return found.sort((a, b) => a.file.localeCompare(b.file));
}

const describeTaken = (t: PresetFile): string => (t.unreadable ? `${t.file}, which this engine cannot parse and which holds the name` : `${t.file}, group ${t.group ?? "User Presets"}`);

/** Refuse before anything is read from Lightroom: no folder, or the name is taken. */
export function checkFree(dir: string, name: string): void {
  if (!existsSync(dir)) throw new ToolError("PRESET_FOLDER_MISSING", `Lightroom's preset folder ${dir} does not exist.`, false);
  const taken = findPresetFiles(dir, name);
  if (taken.length > 0) {
    throw new ToolError("PRESET_EXISTS", `A preset named "${name}" already exists (${taken.map(describeTaken).join("; ")}). Choose another name.`, false, { files: taken });
  }
}

/** Create "<name>.xmp" in `dir`; never replaces a file ("wx"). Returns its path. */
export function writePresetFile(dir: string, name: string, text: string): string {
  checkFree(dir, name);
  const file = path.join(dir, `${name}.xmp`);
  try {
    writeFileSync(file, text, { encoding: "utf8", flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") throw new ToolError("PRESET_EXISTS", `The file ${file} already exists. Choose another name.`, false);
    throw new ToolError("PRESET_WRITE_FAILED", `Could not write ${file}: ${(err as Error).message}`, true);
  }
  return file;
}
