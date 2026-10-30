// The file side of lr_export_photos and lr_import_photos (GitHub issue #55, engine 0.17.0): what the
// engine does on disk, so that neither depends on Lightroom's own collision or copy handling.
//
// Export: the plugin exports one photo into a new folder of its own under <temp>\LrC-AVG\exports
// (plugin\LrC-AVG.lrplugin\Transfer.lua exportPhoto); placeExport() moves those files into the user's
// folder, a name already there renamed ("name-2.jpg"), overwritten or skipped as asked, and removes
// the plugin's folder, or keeps it when placing fails (issue #76); purgeExports() empties the exports
// folder at engine start and exit. It moves only files inside the exports folder, as the preview service reads
// only inside its own (preview\service.ts isInside); the two temp folders are the same
// (preview\service.ts header, Phase 1 handle).
// Import: importFiles() lists the photo files under a folder; copyForImport() copies one to the path
// importDestination() gives in `copy_to` (capture-date.ts), and never overwrites: a file already there with
// the same contents (size, then SHA-256) is taken as the earlier copy, so calling again after a partial
// run goes on where it stopped.
//
// Both tools stop starting photos after CALL_BUDGET_MS and say which are left, because Claude
// Desktop's tool call has a time limit, not measured (issue #136). A 168.5 s call's result most likely
// reached the model, and Desktop has never sent a cancel [inference, handle:
// docs\reports\phase8.5\desktop-call-limit.md row 5 and Observed]. The longest work these limits allow
// is the bridge wait (mcp\bridge-gate.ts, 15 s) plus the budget plus one slow photo: 165 s for an
// export and 135 s for an import (the earlier 160/130 s figure left the bridge wait out). Since issue
// #155 (R3) the call itself answers `pending` at the call deadline (mcp\deadline.ts, 50 s) and the
// work's result goes to the next identical call.

import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream, readdirSync, rmSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isInside } from "../preview/index.js";

/** Photos per lr_add_to_collection call (plugin Transfer.lua MAX_UUIDS). */
export const MAX_COLLECTION_PHOTOS = 500;
/** Photos per lr_export_photos call; the time budget usually ends a call sooner. */
export const MAX_EXPORT_PHOTOS = 500;
/**
 * When a call stops starting photos [inference: the figure, 30 s under the MCP SDK's default request
 * timeout, handle: node_modules\@modelcontextprotocol\server\dist\src-DdvbAHrR.mjs:6070
 * DEFAULT_REQUEST_TIMEOUT_MSEC = 6e4, SDK 2.4.0; issue #155 R3 took it from 40 s so that the bridge wait, the
 * budget and a photo of normal length end before the 50 s call deadline, mcp\deadline.ts].
 */
export const CALL_BUDGET_MS = 30_000;
/** One photo's export, full size included [inference: the figure; a 1600 px preview takes ~2.6 s, docs\reports\phase0\S1.md]. */
export const EXPORT_PHOTO_TIMEOUT_MS = 120_000;
/** One file's import: the write gate waits up to 60 s (plugin Gate.lua WAIT_SECONDS), then addPhoto. */
export const IMPORT_PHOTO_TIMEOUT_MS = 90_000;

/**
 * File types offered to Lightroom's addPhoto [inference: Automaat's list, vendor\automaat\plugin\
 * LightroomMCP.lrplugin\HandlerImport.lua:36-41, plus the raw formats of current Canon, Fujifilm,
 * Olympus/OM, Panasonic, Pentax, Samsung and Nikon cameras and HEIC]. A file Lightroom refuses is
 * listed in `failed`, the others still imported. Issue #218 row 11 added the rest of upstream's list (Automaat PR
 * #294) [upstream claim: Automaat/lightroom-mcp@1040453 plugin/LightroomMCP.lrplugin/HandlerImport.lua:10-17];
 * which of them Lightroom imports is [unverified] (engine\tests\catalog-files.test.ts keeps the lists aligned).
 */
export const PHOTO_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".jpe", ".png", ".tif", ".tiff", ".dng", ".heic", ".heif", ".hif", ".avif", ".jxl", ".psd", ".psb",
  ".nef", ".nrw", ".cr2", ".cr3", ".crw", ".arw", ".srf", ".sr2", ".raf", ".orf", ".ori", ".rw2", ".rwl", ".pef", ".ptx", ".srw", ".x3f",
  ".3fr", ".fff", ".ari", ".bay", ".cap", ".iiq", ".eip", ".dcr", ".dcs", ".drf", ".k25", ".kdc", ".erf", ".gpr", ".mdc", ".mef", ".mos", ".mrw", ".pxn", ".raw",
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

/**
 * Replace the file at `to` with `from`, keeping `to` as it was if anything fails (CodeRabbit, PR #73):
 * the new file is first moved beside it under a temporary name, then renamed over it in one step.
 * fs.rename replaces an existing file on Windows [handle: Claude Code, 2026-10-04, Node v24.11.1:
 * renameSync("rn-a.txt", "rn-b.txt") over an existing rn-b.txt left rn-b.txt holding rn-a.txt's text].
 */
async function replace(from: string, to: string): Promise<void> {
  const staged = `${to}.avg-${randomUUID().slice(0, 8)}.tmp`;
  await move(from, staged);
  try {
    await fs.rename(staged, to);
  } catch (err) {
    // Back into the plugin's folder, which a failed placement keeps (issue #76). If that fails too, the
    // staged file is the only whole copy: it is kept and named (Greptile, PR #137).
    const recovered = await move(staged, from).then(() => true, () => false);
    if (!recovered) throw new Error(`${(err as Error).message}; the export is kept at ${staged}`);
    throw err;
  }
}

/**
 * Copy `from` to `to` only if nothing is there, then remove `from`; false, copying nothing, when
 * something is. COPYFILE_EXCL makes the check and the create one step, so a file another program
 * makes in between is never replaced (issue #76), as fs.rename would replace it on Windows (replace()).
 * Once the copy landed the file is placed: a source that cannot be removed (EBUSY, EPERM) is left to
 * placeExport's removal of the plugin's folder and the purge at the next engine start [inference], as
 * failing here would report a placed file as MOVE_FAILED and a retry would place it twice (review, 2026-10-11).
 */
async function placeNew(from: string, to: string): Promise<boolean> {
  try {
    await fs.copyFile(from, to, constants.COPYFILE_EXCL);
  } catch (err) {
    // A folder of that name gives EPERM, not EEXIST [handle: Claude Code, 2026-10-11, Node v24.11.1:
    // copyFileSync(a, <existing folder>, COPYFILE_EXCL) threw EPERM, onto an existing file EEXIST].
    if ((err as NodeJS.ErrnoException).code === "EEXIST" || (await exists(to))) return false;
    throw err;
  }
  await fs.rm(from, { force: true }).catch(() => undefined);
  return true;
}

/** Place `file` in `folder` under its name, or under the first free "name-n.ext" (n from 2). */
async function placeRenamed(file: string, folder: string): Promise<Placed> {
  const name = path.basename(file);
  if (await placeNew(file, path.join(folder, name))) return { file: path.join(folder, name), status: "written" };
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let n = 2; ; n++) {
    const to = path.join(folder, `${stem}-${n}${ext}`);
    if (await placeNew(file, to)) return { file: to, status: "renamed" };
  }
}

async function placeOne(file: string, folder: string, onExisting: OnExisting): Promise<Placed> {
  if (onExisting === "rename") return placeRenamed(file, folder);
  const to = path.join(folder, path.basename(file));
  if (await placeNew(file, to)) return { file: to, status: "written" };
  if (onExisting === "skip") return { file: to, status: "skipped" };
  await replace(file, to);
  return { file: to, status: "overwritten" };
}

/** Plugin export folders a failed placement kept, by their first level below the exports folder (lower case). */
const kept = new Set<string>();
const topLevel = (exportDir: string, p: string): string => (path.relative(path.resolve(exportDir), path.resolve(p)).split(path.sep)[0] ?? "").toLowerCase();

/**
 * Move the plugin's exported files into `folder` (made if missing), then remove the plugin's folder
 * `dir`. Throws, moving nothing, when `dir` or a file is not inside `exportDir`. When placing fails,
 * `dir` is kept with whatever is left in it (issue #76, decided by Jim: "keep temp"), and
 * purgeExports() leaves it alone for the rest of this engine's run.
 */
export async function placeExport(exportDir: string, dir: string, files: readonly string[], folder: string, onExisting: OnExisting): Promise<Placed[]> {
  if (!isInside(exportDir, dir) || files.some((f) => !isInside(dir, f))) {
    throw new Error(`the plugin's export is not inside ${exportDir}: ${dir}`);
  }
  const placed: Placed[] = [];
  try {
    await fs.mkdir(folder, { recursive: true });
    for (const file of files) placed.push(await placeOne(file, folder, onExisting));
  } catch (err) {
    kept.add(topLevel(exportDir, dir));
    throw err;
  }
  // Everything is placed: a folder that cannot be removed now goes at the next purge (placeNew).
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  return placed;
}

/**
 * Delete what is in the exports folder, but the folders kept by a failed placement during this run:
 * at engine start and exit, as the previews folder is (PRD NFR-6, preview\service.ts purge). Never throws.
 */
export function purgeExports(exportDir: string = defaultExportDir()): void {
  let names: string[];
  try {
    names = readdirSync(exportDir);
  } catch {
    return; // no folder yet
  }
  for (const name of names) {
    if (kept.has(name.toLowerCase())) continue;
    try {
      rmSync(path.join(exportDir, name), { recursive: true, force: true });
    } catch {
      // A file Lightroom still holds open, the next purge takes it [inference].
    }
  }
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

/** The file's SHA-256, read as a stream. */
async function digest(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/**
 * Copy without overwriting; a file already at `to` with the same size and contents counts as the copy
 * (contents compared since CodeRabbit, PR #73). Throws on a different file there.
 */
async function copyOnce(from: string, to: string): Promise<"copied" | "already"> {
  try {
    await fs.copyFile(from, to, constants.COPYFILE_EXCL);
    return "copied";
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    const [a, b] = await Promise.all([fs.stat(from), fs.stat(to)]);
    if (a.size === b.size && (await digest(from)) === (await digest(to))) return "already";
    throw new Error(`a different file already has this name: ${to}`);
  }
}

/**
 * Copy `file` to `to` (capture-date.ts importDestination), with its XMP sidecar, which takes the
 * copy's name and keeps its own extension; returns the copy's path.
 */
export async function copyForImport(file: string, to: string): Promise<{ path: string; copied: boolean }> {
  await fs.mkdir(path.dirname(to), { recursive: true });
  const done = await copyOnce(file, to);
  const xmp = await sidecar(file);
  if (xmp) {
    const xmpTo = to.slice(0, to.length - path.extname(to).length) + path.extname(xmp);
    if (done === "copied") await copyOnce(xmp, xmpTo);
    // An earlier copy's sidecar is left alone: Lightroom may have written to it since [inference: its
    // "Automatically write changes into XMP" catalog setting]. One missing there, as when an earlier
    // call copied the raw but not its sidecar, is copied now (issue #75).
    else await fs.copyFile(xmp, xmpTo, constants.COPYFILE_EXCL).catch((err: NodeJS.ErrnoException) => { if (err.code !== "EEXIST") throw err; });
  }
  return { path: to, copied: done === "copied" };
}
