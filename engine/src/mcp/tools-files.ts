// lr_export_photos and lr_import_photos (GitHub issue #55, engine 0.17.0, plugin 0.17.0 Transfer.lua):
// Automaat's export_photos and import_photos, added back. One plugin command per photo, so each has
// its own time limit and the call can stop between photos; the disk side is library\files.ts. Both run
// between sessions, in the session queue, as lr_set_rating does (tools-catalog.ts): an import writes
// the catalog, and an export would compete with a session's previews for Lightroom's exporter
// [inference].
//
// A command with no answer stops the call, as lr_set_rating's loop does (library\write.ts): the error
// lists what was done, and the photo that may still be exported or imported (`maybe_done`).

import path from "node:path";
import {
  CALL_BUDGET_MS,
  EXPORT_PHOTO_TIMEOUT_MS,
  IMPORT_PHOTO_TIMEOUT_MS,
  copyForImport,
  defaultExportDir,
  expandHome,
  importFiles,
  placeExport,
  type OnExisting,
  type Placed,
} from "../library/index.js";
import { UNANSWERED, mayHaveLanded } from "../sync/target.js";
import { ToolError, toToolError } from "./errors.js";
import { TRANSFER_PLUGIN } from "./tools-collections.js";
import { needPlugin, run, sessionTools, type ToolContext, type ToolOutput } from "./tools-shared.js";

export type ExportFormat = "jpeg" | "png" | "tiff" | "original";
export type ExportPhotosArgs = {
  uuids: string[];
  folder: string;
  format: ExportFormat;
  quality?: number | undefined;
  bit_depth?: 8 | 16 | undefined;
  long_edge?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  on_existing?: OnExisting | undefined;
};
export type ImportPhotosArgs = { source: string; copy_to?: string | undefined; recursive?: boolean | undefined; resume_after?: string | undefined };

type Failure = { item: string; code: string; message: string };

/** Clock and budget, injectable for the tests. */
export type Budget = { now: () => number; ms: number };
const realBudget = (): Budget => ({ now: () => performance.now(), ms: CALL_BUDGET_MS });

/**
 * Run `each` on the items in turn until the budget is spent (the first item always runs). A refusal
 * Lightroom answered becomes a failure and the next item runs; a command with no answer stops the call.
 * Returns the failures and the items not started. `start` is when the budget's clock started.
 */
async function eachInBudget(
  items: readonly string[],
  budget: Budget,
  done: () => unknown,
  each: (item: string) => Promise<void>,
  start = budget.now(),
): Promise<{ failed: Failure[]; left: string[] }> {
  const failed: Failure[] = [];
  for (const [i, item] of items.entries()) {
    if (i > 0 && budget.now() - start > budget.ms) return { failed, left: items.slice(i) };
    try {
      await each(item);
    } catch (err) {
      const e = toToolError(err);
      if (UNANSWERED.has(e.code)) {
        const maybe = mayHaveLanded(err);
        throw new ToolError(e.code, `${e.message} The call stopped at ${item}${maybe ? ", which Lightroom may still carry out" : ""}.`, e.recoverable, {
          ...(maybe ? { maybe_done: item } : {}),
          done: done(),
          failed,
          not_started: maybe ? items.slice(i + 1) : items.slice(i),
        });
      }
      failed.push({ item, code: e.code, message: e.message });
    }
  }
  return { failed, left: [] };
}

const size = (a: ExportPhotosArgs) =>
  a.long_edge !== undefined ? { long_edge: a.long_edge } : a.width !== undefined && a.height !== undefined ? { width: a.width, height: a.height } : {};

export async function exportPhotos(ctx: ToolContext, args: ExportPhotosArgs, budget: Budget = realBudget()): Promise<ToolOutput> {
  return run(ctx, "lr_export_photos", args, async () => {
    const folder = expandHome(args.folder);
    const exportDir = ctx.deps.exportDir ?? defaultExportDir();
    const onExisting = args.on_existing ?? "rename";
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    needPlugin(ctx, "lr_export_photos", TRANSFER_PLUGIN, "it exports to a folder of your choice");
    const payload = {
      format: args.format,
      ...(args.quality !== undefined ? { quality: args.quality } : {}),
      ...(args.bit_depth !== undefined ? { bit_depth: args.bit_depth } : {}),
      ...size(args),
    };
    return sessions.whenIdle("lr_export_photos", async () => {
      const exported: Array<{ uuid: string; filename: string | null; files: Placed[] }> = [];
      const { failed, left } = await eachInBudget(args.uuids, budget, () => exported, async (uuid) => {
        const r = await ctx.deps.client.request("export_photo", { photo_uuid: uuid, ...payload }, { timeoutMs: EXPORT_PHOTO_TIMEOUT_MS });
        try {
          exported.push({ uuid, filename: r.filename ?? null, files: await placeExport(exportDir, r.dir, r.files, folder, onExisting) });
        } catch (err) {
          const keptIn = `What was not placed is kept in ${r.dir} until the engine next starts.`;
          throw new ToolError("MOVE_FAILED", `Lightroom exported ${r.filename ?? uuid}, but moving it into ${folder} failed: ${(err as Error).message} ${keptIn}`, false);
        }
      });
      const json = {
        folder,
        exported,
        failed: failed.map((f) => ({ uuid: f.item, code: f.code, message: f.message })),
        ...(left.length > 0 ? { not_yet: left, next: `Time is up for this call: call again with uuids = not_yet (${left.length} photos) and the same other arguments.` } : {}),
      };
      return { json, log: { exported: exported.length, failed: failed.length, not_yet: left.length } };
    });
  });
}

/**
 * The files after the cursor in the sorted listing (issue #75). The cursor comes back from Claude, so
 * it is found in the listing, case-insensitively on Windows (its paths are), and refused when it is not
 * there: comparing it as a string put every file on one side when the case differed (review, 2026-10-11).
 */
function afterCursor(listed: string[], cursor: string): string[] {
  const key = (p: string) => (process.platform === "win32" ? path.normalize(p).toLowerCase() : path.normalize(p));
  const at = key(expandHome(cursor));
  const i = listed.findIndex((f) => key(f) === at);
  if (i < 0) {
    throw new ToolError("BAD_ARGUMENTS", `resume_after is not one of the files under the source: ${cursor}. Pass the resume_after the last call returned, or omit it to start from the first file.`, false);
  }
  return listed.slice(i + 1);
}

export async function importPhotos(ctx: ToolContext, args: ImportPhotosArgs, budget: Budget = realBudget()): Promise<ToolOutput> {
  return run(ctx, "lr_import_photos", args, async () => {
    const source = expandHome(args.source);
    const copyTo = args.copy_to !== undefined ? expandHome(args.copy_to) : null;
    const rel = copyTo !== null ? path.relative(source, copyTo) : "..";
    if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
      throw new ToolError("BAD_ARGUMENTS", "copy_to must not be the source folder or inside it.", false);
    }
    // The scan counts against the call's time (issue #75): a slow card reader or share spends it too.
    const start = budget.now();
    let listed: string[];
    try {
      listed = await importFiles(source, args.recursive ?? true);
    } catch (err) {
      throw new ToolError("NOT_FOUND", `Cannot read ${source}: ${(err as Error).message}`, false);
    }
    const files = args.resume_after !== undefined ? afterCursor(listed, args.resume_after) : listed;
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    needPlugin(ctx, "lr_import_photos", TRANSFER_PLUGIN, "it imports photos");
    return sessions.whenIdle("lr_import_photos", async () => {
      // source: the file found under `source`; path: the file the catalog holds (the copy, with copy_to) (issue #139).
      type Imported = { uuid: string; filename: string | null; path: string; source: string; capture_time: string | null };
      const imported: Imported[] = [];
      const already: Imported[] = [];
      const done = () => ({ imported, already_in_catalog: already });
      const { failed, left } = await eachInBudget(files, budget, done, async (file) => {
        let target = file;
        if (copyTo !== null) {
          try {
            target = (await copyForImport(file, source, copyTo)).path;
          } catch (err) {
            throw new ToolError("COPY_FAILED", (err as Error).message, false);
          }
        }
        const r = await ctx.deps.client.request("import_photo", { path: target }, { timeoutMs: IMPORT_PHOTO_TIMEOUT_MS });
        (r.status === "imported" ? imported : already).push({ uuid: r.uuid, filename: r.filename ?? null, path: target, source: file, capture_time: r.capture_time ?? null });
      }, start);
      const next = `Time is up for this call: call again with resume_after = this resume_after and the same other arguments (${left.length} files left).`;
      const json = {
        source,
        ...(copyTo !== null ? { copied_to: copyTo } : {}),
        found: listed.length,
        imported,
        already_in_catalog: already,
        failed: failed.map((f) => ({ file: f.item, code: f.code, message: f.message })),
        ...(left.length > 0 ? { not_yet: left.length, resume_after: files[files.length - left.length - 1], next } : {}),
      };
      return { json, log: { found: listed.length, imported: imported.length, already: already.length, failed: failed.length, not_yet: left.length } };
    });
  });
}
