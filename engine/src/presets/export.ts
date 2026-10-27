// lr_export_preset (issue #215): a copy of a preset's own file (getFile(): a user preset's .xmp, a checkpoint's
// .lrtemplate) into a folder, under the same extension, never over an existing file (COPYFILE_EXCL) [upstream claim:
// Automaat HandlerDevelop.lua exportDevelopPreset at 1040453 refuses an existing destination and keeps the extension].
// The engine copies, not the plugin: it is a file copy, testable here. Under Claude Desktop (an MSIX package) a file the
// engine creates under %APPDATA% or %LOCALAPPDATA% may land in the package's private folder instead (issue #182)
// [handle: https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes, "Common file
// system operations"], so the result says so for such a folder.

import { constants, copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { ToolError } from "../mcp/errors.js";
import { checkPresetName } from "./folder.js";
import { brief, type LrPreset } from "./lightroom.js";

export const REDIRECT_NOTE =
  "This folder is under AppData: when Claude Desktop runs this engine, Windows may keep the new file in Claude's own private copy of AppData, where other programs do not see it (issue #182). Prefer a folder outside AppData.";

/** True when `dir` is inside %APPDATA% or %LOCALAPPDATA% (case aside, as Windows paths are). */
export function underAppData(dir: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const d = path.resolve(dir).toLowerCase();
  return [env["APPDATA"], env["LOCALAPPDATA"]].some((root) => {
    if (!root) return false;
    const r = path.resolve(root).toLowerCase();
    return d === r || d.startsWith(r + path.sep);
  });
}

/** The file name the copy gets: `filename` (its extension added when it has none), else the source's own name. */
function targetName(source: string, filename: string | undefined): string {
  const ext = path.extname(source);
  if (!ext) throw new ToolError("PRESET_NOT_EXPORTABLE", `The preset's file ${source} has no extension, so its format is unknown.`, false);
  if (filename === undefined) return path.basename(source);
  const name = checkPresetName(filename, "name");
  const given = path.extname(name);
  if (!given) return name + ext;
  if (given.toLowerCase() !== ext.toLowerCase()) throw new ToolError("INVALID_ARGUMENTS", `filename must end in ${ext}, the extension of the preset's own file.`, false);
  return name;
}

export function exportPreset(p: LrPreset, destinationDir: string, filename?: string, env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  if (!p.file) throw new ToolError("PRESET_NOT_EXPORTABLE", `Lightroom gives no file for "${p.name}" (${p.folder}); built-in presets may have none.`, false, { preset: brief(p) });
  if (!path.isAbsolute(destinationDir)) throw new ToolError("INVALID_ARGUMENTS", `destination_dir must be a full path, such as D:\\Presets (got "${destinationDir}").`, false);
  const destination = path.join(destinationDir, targetName(p.file, filename));
  try {
    mkdirSync(destinationDir, { recursive: true });
    copyFileSync(p.file, destination, constants.COPYFILE_EXCL);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST") throw new ToolError("PRESET_EXISTS", `${destination} already exists; it was left as it is. Choose another filename or folder.`, false);
    if (code === "ENOENT") throw new ToolError("PRESET_NOT_EXPORTABLE", `The preset's file ${p.file} was not found, or ${destinationDir} could not be made.`, false);
    throw new ToolError("PRESET_WRITE_FAILED", `Could not copy ${p.file} to ${destination}: ${(err as Error).message}`, true);
  }
  return { ok: true, preset: brief(p), source: p.file, destination, ...(underAppData(destinationDir, env) ? { note: REDIRECT_NOTE } : {}) };
}
