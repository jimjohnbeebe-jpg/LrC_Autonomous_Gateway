// The file side of lr_export_photos and lr_import_photos (GitHub issue #55, engine 0.17.0): what the
// engine does on disk, so that neither depends on Lightroom's own collision or copy handling.
//
// Export: the plugin exports one photo into a new folder of its own under <temp>\LrC-AVG\exports
// (plugin\LrC-AVG.lrplugin\Transfer.lua exportPhoto); placeExport() moves those files into the user's
// folder, a name already there renamed ("name-2.jpg"), overwritten or skipped as asked, and removes
// the plugin's folder. It moves only files inside the exports folder, as the preview service reads
// only inside its own (preview\service.ts isInside); the two temp folders are the same
// (preview\service.ts header, Phase 1 handle).
// Import: importFiles() lists the photo files under a folder; copyForImport() copies one into
// `copy_to`, keeping its path below the source folder, and never overwrites: a file already there of
// the same size is taken as the earlier copy, so calling again after a partial run goes on where it
// stopped [inference: size as the identity check; no hash is made].
//
// Both tools stop starting photos after CALL_BUDGET_MS and say which are left, because Claude
// Desktop's tool call has a time limit: the MCP SDK's default request timeout is 60 s [handle:
// node_modules\@modelcontextprotocol\sdk\dist\esm\shared\protocol.js:8 DEFAULT_REQUEST_TIMEOUT_MSEC =
// 60000]; whether Claude Desktop uses that default is [unverified] (PHASE5_PLAN "Carried").

import { constants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isInside } from "../preview/index.js";

/** Photos per lr_add_to_collection call (plugin Transfer.lua MAX_UUIDS). */
export const MAX_COLLECTION_PHOTOS = 500;
/** Photos per lr_export_photos call; the time budget usually ends a call sooner. */
export const MAX_EXPORT_PHOTOS = 500;
/** When a call stops starting photos [inference: the figure, 20 s under the 60 s default above]. */
export const CALL_BUDGET_MS = 40_000;
/** One photo's export, full size included [inference: the figure; a 1600 px preview takes ~2.6 s, docs\reports\phase0\S1.md]. */
export const EXPORT_PHOTO_TIMEOUT_MS = 120_000;
/** One file's import: the write gate waits up to 60 s (plugin Gate.lua WAIT_SECONDS), then addPhoto. */
export const IMPORT_PHOTO_TIMEOUT_MS = 90_000;

/**
 * File types offered to Lightroom's addPhoto [inference: Automaat's list, vendor\automaat\plugin\
 * LightroomMCP.lrplugin\HandlerImport.lua:36-41, plus the raw formats of current Canon, Fujifilm,
 * Olympus/OM, Panasonic, Pentax, Samsung and Nikon cameras and HEIC]. A file Lightroom refuses is
 * listed in `failed`, the others still imported.
 */
export const PHOTO_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".dng", ".heic", ".psd",
  ".nef", ".nrw", ".cr2", ".cr3", ".crw", ".arw", ".srf", ".sr2", ".raf", ".orf", ".rw2", ".pef", ".srw", ".x3f",
]);

/** The plugin's export folder: <temp>\LrC-AVG\exports. */
export function defaultExportDir(): string {
  return path.join(os.tmpdir(), "LrC-AVG", "exports");
}

/** A leading "~" is the user's home folder; the result is resolved. */
export function expandHome(p: string): string {
  const t = p.trim();
  return path.resolve(t === "~" || t.startsWith("~/") || t.startsWith("~\\") ? path.join(os.homedir(), t.slice(1)) : t);
}

/** True for an absolute path, "~" counting as absolute. */
export function isAbsoluteFolder(p: string): boolean {
  const t = p.trim();
  return t === "~" || t.startsWith("~/") || t.startsWith("~\\") || path.isAbsolute(t);
}

export type OnExisting = "rename" | "overwrite" | "skip";
export type Placed = { file: string; status: "written" | "renamed" | "overwritten" | "skipped" };

const exists = (p: string): Promise<boolean> => fs.access(p).then(() => true, () => false);

/** Move, across drives too (rename gives EXDEV there). */
async function move(from: string, to: string): Promise<void> {
  try {
    await fs.rename(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
    await fs.copyFile(from, to);
    await fs.rm(from, { force: true });
  }
}

/** The first "name-n.ext" (n from 2) not in `folder`. */
async function freeName(folder: string, name: string): Promise<string> {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let n = 2; ; n++) {
    const candidate = path.join(folder, `${stem}-${n}${ext}`);
    if (!(await exists(candidate))) return candidate;
  }
}

/**
 * Move the plugin's exported files into `folder` (made if missing), then remove the plugin's folder
 * `dir`. Throws, moving nothing, when `dir` or a file is not inside `exportDir`.
 */
export async function placeExport(exportDir: string, dir: string, files: readonly string[], folder: string, onExisting: OnExisting): Promise<Placed[]> {
  if (!isInside(exportDir, dir) || files.some((f) => !isInside(dir, f))) {
    throw new Error(`the plugin's export is not inside ${exportDir}: ${dir}`);
  }
  await fs.mkdir(folder, { recursive: true });
  const placed: Placed[] = [];
  try {
    for (const file of files) {
      let to = path.join(folder, path.basename(file));
      let status: Placed["status"] = "written";
      if (await exists(to)) {
        if (onExisting === "skip") {
          placed.push({ file: to, status: "skipped" });
          continue;
        }
        if (onExisting === "rename") {
          to = await freeName(folder, path.basename(file));
          status = "renamed";
        } else {
          await fs.rm(to, { force: true });
          status = "overwritten";
        }
      }
      await move(file, to);
      placed.push({ file: to, status });
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
  return placed;
}

/** The photo files at `source`: the file itself, or those under the folder (below it too when `recursive`), sorted. */
export async function importFiles(source: string, recursive: boolean): Promise<string[]> {
  const stat = await fs.stat(source);
  if (stat.isFile()) return [source];
  const names = await fs.readdir(source, { recursive });
  const files: string[] = [];
  for (const name of names) {
    if (!PHOTO_EXTENSIONS.has(path.extname(name).toLowerCase())) continue;
    const file = path.join(source, name);
    const s = await fs.stat(file).catch(() => null);
    if (s?.isFile()) files.push(file);
  }
  return files.sort();
}

/** The XMP sidecar next to a photo file ("photo.xmp" for "photo.nef"), if there is one. */
async function sidecar(file: string): Promise<string | null> {
  const stem = file.slice(0, file.length - path.extname(file).length);
  for (const ext of [".xmp", ".XMP"]) if (await exists(stem + ext)) return stem + ext;
  return null;
}

/** Copy without overwriting; a file already at `to` of the same size counts as the copy. Throws on a different file there. */
async function copyOnce(from: string, to: string): Promise<"copied" | "already"> {
  try {
    await fs.copyFile(from, to, constants.COPYFILE_EXCL);
    return "copied";
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    const [a, b] = await Promise.all([fs.stat(from), fs.stat(to)]);
    if (a.size === b.size) return "already";
    throw new Error(`a different file already has this name: ${to}`);
  }
}

/**
 * Copy `file` (found under `sourceRoot`) into `copyTo` at the same path below it, with its XMP
 * sidecar; returns the copy's path. A single-file source lands directly in `copyTo`.
 */
export async function copyForImport(file: string, sourceRoot: string, copyTo: string): Promise<{ path: string; copied: boolean }> {
  const rel = file === sourceRoot ? path.basename(file) : path.relative(sourceRoot, file);
  const to = path.join(copyTo, rel);
  await fs.mkdir(path.dirname(to), { recursive: true });
  const done = await copyOnce(file, to);
  // An earlier copy's sidecar is left alone: Lightroom may have written to it since [inference: its
  // "Automatically write changes into XMP" catalog setting].
  const xmp = done === "copied" ? await sidecar(file) : null;
  if (xmp) await copyOnce(xmp, path.join(path.dirname(to), path.basename(xmp)));
  return { path: to, copied: done === "copied" };
}
