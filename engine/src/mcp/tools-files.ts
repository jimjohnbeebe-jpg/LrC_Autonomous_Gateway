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
export type ImportPhotosArgs = { source: string; copy_to?: string | undefined; recursive?: boolean | undefined };

type Failure = { item: string; code: string; message: string };

/** Clock and budget, injectable for the tests. */
export type Budget = { now: () => number; ms: number };
const realBudget = (): Budget => ({ now: () => performance.now(), ms: CALL_BUDGET_MS });

/**
 * Run `each` on the items in turn until the budget is spent (the first item always runs). A refusal
 * Lightroom answered becomes a failure and the next item runs; a command with no answer stops the call.
 * Returns the failures and the items not started.
 */
async function eachInBudget(items: readonly string[], budget: Budget, done: () => unknown, each: (item: string) => Promise<void>): Promise<{ failed: Failure[]; left: string[] }> {
  const failed: Failure[] = [];
  const start = budget.now();
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
          throw new ToolError("MOVE_FAILED", `Lightroom exported ${r.filename ?? uuid}, but moving it into ${folder} failed: ${(err as Error).message}`, false);
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

export async function importPhotos(ctx: ToolContext, args: ImportPhotosArgs, budget: Budget = realBudget()): Promise<ToolOutput> {
  return run(ctx, "lr_import_photos", args, async () => {
    const source = expandHome(args.source);
    const copyTo = args.copy_to !== undefined ? expandHome(args.copy_to) : null;
    const rel = copyTo !== null ? path.relative(source, copyTo) : "..";
    if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
      throw new ToolError("BAD_ARGUMENTS", "copy_to must not be the source folder or inside it.", false);
    }
    let files: string[];
    try {
      files = await importFiles(source, args.recursive ?? true);
    } catch (err) {
      throw new ToolError("NOT_FOUND", `Cannot read ${source}: ${(err as Error).message}`, false);
    }
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    needPlugin(ctx, "lr_import_photos", TRANSFER_PLUGIN, "it imports photos");
    return sessions.whenIdle("lr_import_photos", async () => {
      const imported: Array<{ uuid: string; filename: string | null; path: string }> = [];
      const already: Array<{ uuid: string; filename: string | null; path: string }> = [];
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
        (r.status === "imported" ? imported : already).push({ uuid: r.uuid, filename: r.filename ?? null, path: target });
      });
      const json = {
        source,
        ...(copyTo !== null ? { copied_to: copyTo } : {}),
        found: files.length,
        imported,
        already_in_catalog: already,
        failed: failed.map((f) => ({ file: f.item, code: f.code, message: f.message })),
        ...(left.length > 0 ? { not_yet: left.length, next: `Time is up for this call: call again with the same arguments; the ${files.length - left.length} files done are found in the catalog and skipped.` } : {}),
      };
      return { json, log: { found: files.length, imported: imported.length, already: already.length, failed: failed.length, not_yet: left.length } };
    });
  });
}
