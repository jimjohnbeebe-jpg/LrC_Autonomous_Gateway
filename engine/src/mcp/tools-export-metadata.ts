// lr_export_metadata (GitHub issue #218 row 8; upstream's export_photo_metadata [upstream claim:
// Automaat/lightroom-mcp@1040453 plugin/LightroomMCP.lrplugin/HandlerExport.lua:198-300]): the catalog metadata of
// many photos, or of the selection, as one JSON file, so a script can read it without it passing through the chat.
// Here the engine writes the file: it reads each photo with get_metadata (tools-metadata.ts readMetadata, so a record
// is what lr_get_metadata answers, keyword paths included) and writes with flag "wx", which fails when the file is
// there [handle: https://nodejs.org/api/fs.html#file-system-flags, "'wx': Like 'w' but fails if the path exists"]:
// nothing is ever overwritten. Reads only the catalog; at most MAX_PAGE photos a call, within CALL_BUDGET_MS.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CALL_BUDGET_MS, MAX_PAGE, expandHome, isAbsoluteFolder } from "../library/index.js";
import { ToolError } from "./errors.js";
import { readMetadata } from "./tools-metadata.js";
import { run, type ToolContext, type ToolOutput } from "./tools-shared.js";

export type ExportMetadataArgs = { uuids?: string[] | undefined; folder?: string | undefined };

/** Where the file goes when the user names no folder: beside the plugin's exports (library\files.ts defaultExportDir). */
export const defaultMetadataDir = (): string => path.join(os.tmpdir(), "LrC-AVG", "metadata");

async function photosToExport(ctx: ToolContext, args: ExportMetadataArgs): Promise<string[]> {
  if (args.uuids !== undefined) return args.uuids;
  const sel = await ctx.deps.client.request("get_selection", { max: MAX_PAGE });
  if (sel.count > MAX_PAGE) throw new ToolError("TOO_MANY_PHOTOS", `${sel.count} photos are selected; select at most ${MAX_PAGE}, or name them by uuid.`, false);
  return sel.photos.map((p) => p.uuid).filter((u): u is string => typeof u === "string");
}

export async function exportMetadata(ctx: ToolContext, args: ExportMetadataArgs, budgetMs = CALL_BUDGET_MS): Promise<ToolOutput> {
  return run(ctx, "lr_export_metadata", args, async () => {
    if (args.folder !== undefined && !isAbsoluteFolder(args.folder)) throw new ToolError("BAD_ARGUMENTS", "folder must be an absolute path (D:\\Exports) or start with ~.", false);
    const dir = args.folder !== undefined ? expandHome(args.folder) : defaultMetadataDir();
    await ctx.deps.ensureBridge();
    const uuids = await photosToExport(ctx, args);
    if (uuids.length === 0) throw new ToolError("NO_ACTIVE_PHOTO", "No photo is selected in Lightroom and none was named.", true);
    const read = await readMetadata(ctx, uuids, Date.now() + budgetMs);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `lrc-avg-metadata-${ctx.now().toISOString().replace(/[:.]/g, "-")}.json`);
    const body = { exported: ctx.now().toISOString(), count: read.photos.length, photos: read.photos };
    try {
      await fs.writeFile(file, JSON.stringify(body, null, 2) + "\n", { flag: "wx" });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      throw new ToolError(code === "EEXIST" ? "FILE_EXISTS" : "WRITE_FAILED", `Could not write ${file}: ${(err as Error).message}. Nothing was overwritten.`, code !== "EEXIST");
    }
    const notYet = read.not_read.length > 0 ? { not_yet: read.not_read, next: "Call again with uuids set to `not_yet`; that writes a second file." } : {};
    return { json: { file, exported: read.photos.length, failed: read.failed, ...notYet }, log: { file, exported: read.photos.length, failed: read.failed.length } };
  });
}
