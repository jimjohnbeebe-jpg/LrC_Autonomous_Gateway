// Spike S14, the looks spike (PHASE10_PLAN row 1; plan approved by Jim 2026-10-25 [stated: "Go"],
// with the questions in the PowerShell window, the Parametric fallback in part a, and the charts
// kept in their own collection). `npm run s14:check` (s14-check-cli.ts) runs s14-check.ts on four
// photos, each selected first (Lightroom checks writes only on the photo in Develop [handle:
// docs\reports\phase8\S10.md]) and put back from its snapshot (s10-writes.ts behindSnapshot):
//   a. the tone curve (#187), s14-curve.ts: point curve writes on the raw NEF and the grey wedge;
//   b. the grading wheels, s14-grading.ts: a hue sweep of each wheel on the grey wedge;
//   c. the HSL bands, s14-hsl.ts: each band's saturation at -100 on the hue chart;
//   d. the B&W mixer and e. the calibration keys, s14-keys.ts: on the raw NEF and the rendered JPEG.
// The two charts are made with sharp (s14-charts.ts), imported in place and kept in the collection
// CHART_COLLECTION. This module holds what the parts share.

import { PreviewService } from "../preview/index.js";
import { READBACK_TOLERANCE, type SdkSettings } from "../params/index.js";
import type { Json } from "./phase3-config.js";
import { gridMeans, type Rgb } from "./s14-charts.js";
import { EXPORT_TIMEOUT_MS, PREVIEW, WRITE_TIMEOUT_MS, type Ctx, type Photo } from "./s10-config.js";

/** import_photo, create_collection and collection_photos (Transfer.lua). */
export const MIN_PLUGIN_VERSION = "0.17.0";
export const CHART_COLLECTION = "LrC-AVG S14 charts";
/** The fixtures of the "fixtures" collection (effects-probe.ts PHOTOS). */
export const FIXTURES = [{ name: "20260907-_OZ80093.NEF", pipeline: "raw" }, { name: "DSC_0031.JPG", pipeline: "rendered" }] as const;
export const snapshotName = (stamp: string): string => `AVG S14 before ${stamp}`;
export const history = (section: string) => (n: number, of: number): string => `AVG S14 ${section} ${n}/${of}`;

/** True when every key written reads back as written, numbers within READBACK_TOLERANCE, curves point by point. */
export function sameValue(written: unknown, read: unknown): boolean {
  if (typeof written === "number") return typeof read === "number" && Math.abs(written - read) <= READBACK_TOLERANCE;
  if (Array.isArray(written)) return Array.isArray(read) && read.length === written.length && written.every((w, i) => sameValue(w, read[i]));
  return written === read;
}

export const takenAll = (written: SdkSettings, read: SdkSettings | null): boolean | null =>
  read === null ? null : Object.entries(written).every(([k, v]) => sameValue(v, read[k]));

/** The keys written, as Lightroom read them back. */
export const readOf = (written: SdkSettings, read: SdkSettings | null): Json =>
  Object.fromEntries(Object.keys(written).map((k) => [k, read?.[k] ?? null]));

/** The photo's export at the session's preview size (PRD 6.8), as patch means of a cols x rows grid. */
export async function renderGrid(ctx: Ctx, photo: Photo, cols: number, rows: number): Promise<Rgb[]> {
  const previews = new PreviewService(ctx.deps.client, { exportTimeoutMs: EXPORT_TIMEOUT_MS, ...(ctx.deps.previewDir ? { previewDir: ctx.deps.previewDir } : {}) });
  const r = await previews.render({ longEdge: PREVIEW.long_edge, quality: PREVIEW.quality, photoUuid: photo.uuid });
  return gridMeans(r.jpeg, cols, rows);
}

/** The photo back to its snapshot (each curve variant and each sweep starts from it). */
export async function toSnapshot(ctx: Ctx, photo: Photo, out: Json): Promise<void> {
  const id = (out["snapshot"] as { id?: unknown } | null)?.id;
  if (typeof id !== "string") throw new Error("no snapshot to start from");
  await ctx.deps.client.request("apply_snapshot", { photo_uuid: photo.uuid, snapshot_id: id }, { timeoutMs: ctx.deps.writeTimeoutMs ?? WRITE_TIMEOUT_MS });
}
