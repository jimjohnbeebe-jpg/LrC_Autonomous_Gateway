// Spike S10, step 3 (s10-config.ts has the plan): two virtual copies of the selected rendered
// original (create_virtual_copies needs the master selected: PRD 6.6 step 1, Catalog.lua), each read
// back by uuid and compared with the master; and an export of every photo through the engine's own
// preview path (preview\service.ts render: the LrExportSession JPEG read, measured and deleted), so
// every format's preview reaches sharp exactly as a session's would, HDR ones included. Copies that
// may exist after the run are named in the results; Jim removes them (spikes\S10\README.md).

import { summarize } from "../metrics/index.js";
import { PreviewService } from "../preview/index.js";
import { describeError, differingKeys } from "./phase1-check.js";
import { yn, type Json } from "./phase3-config.js";
import { errorBody, mayHaveLanded } from "./phase4-config.js";
import { COPIES_TIMEOUT_MS, COPY_NAMES, EXPORT_TIMEOUT_MS, PREVIEW, label, pipelineOf, type Ctx, type Photo } from "./s10-config.js";

export async function virtualCopies(ctx: Ctx, photos: Photo[]): Promise<Json> {
  const { client, map, say } = ctx.deps;
  const master = photos.find((p) => p.selected);
  const notRun = (reason: string): Json => {
    say(`Copies: not run (${reason}).`);
    return { run: false, summary: `not run: ${reason}` };
  };
  if (!master) return notRun("the selected photo is not in the collection");
  if (master.is_virtual_copy) return notRun(`the selected photo is a virtual copy (${label(master)}); select an original`);
  if (master.pipeline !== "rendered") return notRun(`the selected photo ${label(master)} is ${master.pipeline}, not rendered`);
  const out: Json = { run: true, master: label(master), names: [...COPY_NAMES] };
  try {
    const res = await client.request("create_virtual_copies", { target_uuid: master.uuid, names: [...COPY_NAMES] }, { timeoutMs: COPIES_TIMEOUT_MS });
    const copies: Json[] = [];
    for (const c of res.copies) {
      const entry: Json = { ...c };
      if (c.uuid && c.identity_ok) {
        const s = (await client.request("get_settings", { photo_uuid: c.uuid })).settings;
        entry["pipeline"] = pipelineOf(map, s).pipeline;
        entry["differing_from_master"] = differingKeys(map, master.start, s);
      }
      copies.push(entry);
    }
    const made = copies.filter((c) => c["identity_ok"] === true).length;
    const asMaster = made > 0 && copies.every((c) => c["identity_ok"] !== true || (c["differing_from_master"] as string[]).length === 0);
    Object.assign(out, { requested: res.requested, copies, failure: res.failure ?? null, master_selected: res.master_selected, summary: `${made} of ${res.requested} made of ${label(master)}; each starts as the master: ${yn(asMaster)}` });
  } catch (err) {
    Object.assign(out, { error: errorBody(err), maybe_made: mayHaveLanded(err) ? [...COPY_NAMES] : [], summary: `failed: ${describeError(err)}` });
  }
  say(`Copies: ${String(out["summary"])}`);
  return out;
}

/** Every photo exported at the session's preview size through PreviewService; what sharp read of each. */
export async function exportAll(ctx: Ctx, photos: Photo[]): Promise<Json> {
  const { client, say, previewDir } = ctx.deps;
  const previews = new PreviewService(client, { exportTimeoutMs: EXPORT_TIMEOUT_MS, ...(previewDir ? { previewDir } : {}) });
  say("Exports (the session's preview path, each file read and deleted):");
  const results: Json[] = [];
  for (const p of photos) {
    const entry: Json = { photo: label(p), file_format: p.file_format, pipeline: p.pipeline };
    try {
      const r = await previews.render({ longEdge: PREVIEW.long_edge, quality: PREVIEW.quality, photoUuid: p.uuid });
      Object.assign(entry, { ok: true, width: r.width, height: r.height, bytes: r.bytes, reencoded: r.reencoded, metrics: summarize(r.metrics), timings: r.timings });
      say(`  ${label(p)}: ${r.width}x${r.height}, ${r.bytes} bytes, export ${r.timings.export_ms} ms`);
    } catch (err) {
      Object.assign(entry, { ok: false, error: errorBody(err) });
      say(`  ${label(p)}: FAILED (${describeError(err)})`);
    }
    results.push(entry);
  }
  return { ok: results.filter((r) => r["ok"] === true).length, of: results.length, photos: results };
}
