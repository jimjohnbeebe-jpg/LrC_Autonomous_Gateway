// `npm run effects:probe` (issue #125; plan approved by Jim 2026-10-12 [stated: "Go with
// recommendations"]): what Lightroom takes for the Effects panel's post-crop vignette and grain
// keys, on one raw and one rendered photo of the "fixtures" collection. The keys are pinned
// (params\sdk-keys.lrc15.json, sdk-keys.lrc15.rendered.json) but their limits are not: the dumps
// record a sample value only. CANDIDATES are the limits we expect from Lightroom's sliders
// [unverified]; the probe writes each at its limits and 1 % beyond (s10-probe.ts rangeProbeOf),
// writes PostCropVignetteStyle 1, 2, 3, 0, 4, then exports at Amount 0 and -50 and measures the
// corners against the centre with sharp (PreviewService), to see which sign darkens the corners.
// Every photo is selected first, since Lightroom checks writes only on the photo in Develop
// [handle: docs\reports\phase8\S10.md], and put back from its snapshot (s10-writes.ts).

import { PreviewService } from "../preview/index.js";
import type { Region } from "../metrics/index.js";
import type { SdkSettings } from "../params/index.js";
import { describeError } from "./phase1-check.js";
import { yn, type Json } from "./phase3-config.js";
import { errorBody } from "./phase4-config.js";
import { census } from "./s10-census.js";
import { restoreSelection } from "./s10-check.js";
import { connect, EXPORT_TIMEOUT_MS, PREVIEW, write, type Ctx, type Photo, type S10Deps } from "./s10-config.js";
import { rangeLine, rangeProbeOf, type Candidate } from "./s10-probe.js";
import { behindSnapshot } from "./s10-writes.js";

/**
 * The raw fixture and the rendered JPEG original (s10-fixtures.ts FIXTURE_FILES). The collection
 * holds two originals of each name [handle: docs\reports\phase8\S10\s10_check_2026-10-09T12-24-50-743Z.json
 * census.photos]; the first original on the named pipeline is taken.
 */
export const PHOTOS = [{ name: "20260907-_OZ80093.NEF", pipeline: "raw" }, { name: "DSC_0031.JPG", pipeline: "rendered" }] as const;
const AMOUNT = "PostCropVignetteAmount";
const STYLE = "PostCropVignetteStyle";
export const CANDIDATES: Candidate[] = [
  { name: AMOUNT, sdkKey: AMOUNT, min: -100, max: 100 },
  { name: "PostCropVignetteMidpoint", sdkKey: "PostCropVignetteMidpoint", min: 0, max: 100 },
  { name: "PostCropVignetteRoundness", sdkKey: "PostCropVignetteRoundness", min: -100, max: 100 },
  { name: "PostCropVignetteFeather", sdkKey: "PostCropVignetteFeather", min: 0, max: 100 },
  { name: "PostCropVignetteHighlightContrast", sdkKey: "PostCropVignetteHighlightContrast", min: 0, max: 100 },
  { name: "GrainAmount", sdkKey: "GrainAmount", min: 0, max: 100 },
  { name: "GrainSize", sdkKey: "GrainSize", min: 0, max: 100 },
  { name: "GrainFrequency", sdkKey: "GrainFrequency", min: 0, max: 100 },
];
/** Three styles we expect [unverified], then one value on each side of them. */
export const STYLES = [1, 2, 3, 0, 4] as const;
export const AMOUNTS = [0, -50] as const;
const CORNERS: Region[] = [
  { label: "top-left", box: { x: 0, y: 0, w: 0.1, h: 0.1 } },
  { label: "top-right", box: { x: 0.9, y: 0, w: 0.1, h: 0.1 } },
  { label: "bottom-left", box: { x: 0, y: 0.9, w: 0.1, h: 0.1 } },
  { label: "bottom-right", box: { x: 0.9, y: 0.9, w: 0.1, h: 0.1 } },
];
const CENTRE: Region = { label: "centre", box: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 } };
export const snapshotName = (stamp: string): string => `AVG effects before ${stamp}`;
const history = (section: string) => (n: number, of: number): string => `AVG effects ${section} ${n}/${of}`;

/** Each style written in turn and read back. */
async function styleProbe(ctx: Ctx, photo: Photo): Promise<Json> {
  if (!(STYLE in photo.start)) return { note: `the photo carries no ${STYLE}` };
  const steps = [];
  for (const [i, v] of STYLES.entries()) {
    const w: Json = { written: v };
    const rb = await write(ctx, photo, { [STYLE]: v }, history("style")(i + 1, STYLES.length), w);
    steps.push({ ...w, read_back: rb?.[STYLE] ?? null, taken: rb?.[STYLE] === v });
  }
  return { steps };
}

/** The start values of the candidate keys and Style, then Amount at each of AMOUNTS: corner and centre luma of the export. */
async function lumaProbe(ctx: Ctx, photo: Photo): Promise<Json> {
  const previews = new PreviewService(ctx.deps.client, { exportTimeoutMs: EXPORT_TIMEOUT_MS, ...(ctx.deps.previewDir ? { previewDir: ctx.deps.previewDir } : {}) });
  const keys = [...CANDIDATES.map((c) => c.sdkKey), STYLE].filter((k) => k in photo.start);
  const start: SdkSettings = Object.fromEntries(keys.map((k) => [k, photo.start[k] as number]));
  const steps: Json[] = [];
  for (const [i, amount] of AMOUNTS.entries()) {
    const step: Json = { amount };
    steps.push(step);
    if (!(await write(ctx, photo, { ...start, [AMOUNT]: amount }, history("luma")(i + 1, AMOUNTS.length), step))) break;
    try {
      const r = await previews.render({ longEdge: PREVIEW.long_edge, quality: PREVIEW.quality, photoUuid: photo.uuid, regions: [...CORNERS, CENTRE] });
      const regions = r.metrics.regions;
      const corners = regions.filter((g) => g.label !== CENTRE.label).reduce((s, g) => s + g.luma_mean, 0) / CORNERS.length;
      const centre = regions.find((g) => g.label === CENTRE.label)?.luma_mean ?? Number.NaN;
      Object.assign(step, { corner_luma: corners, centre_luma: centre, corner_to_centre: corners / centre });
    } catch (err) {
      step["export_error"] = errorBody(err);
      ctx.fail(`${photo.filename}: the export at Amount ${amount}: ${describeError(err)}`);
      break;
    }
  }
  const [a, b] = steps.map((s) => s["corner_to_centre"]);
  const darker = typeof a === "number" && typeof b === "number" ? b < a : null;
  return { steps, corners_darker_at_minus_50: darker };
}

export async function runEffectsProbe(deps: S10Deps): Promise<{ worked: boolean; results: Json }> {
  const errors: string[] = [];
  const results: Json = { check: "effects", started_at: (deps.now ?? (() => new Date()))().toISOString(), photos_wanted: [...PHOTOS], candidates: CANDIDATES, errors };
  const ctx: Ctx = { deps, results, errors, fail: (m) => {
    errors.push(m);
    deps.say(`FAILED: ${m}`);
  } };
  deps.say("LrC-AVG effects probe: post-crop vignette and grain (issue #125)");
  if (!(await connect(ctx))) return finish(ctx, []);
  const out: Json[] = [];
  try {
    const found = await census(ctx);
    const photos = found ? PHOTOS.map((w) => found.photos.find((p) => p.filename === w.name && !p.is_virtual_copy && p.pipeline === w.pipeline)) : [];
    for (const [i, w] of PHOTOS.entries()) {
      if (found && !photos[i]) ctx.fail(`the collection "fixtures" holds no ${w.pipeline} original named ${w.name}. Run npm run s10:check -- --fixtures, then this again.`);
    }
    for (const photo of photos.filter((p): p is Photo => p !== undefined)) {
      out.push(await behindSnapshot(ctx, photo, snapshotName(deps.stamp), async (o) => {
        o["range"] = await rangeProbeOf(ctx, photo, CANDIDATES, history("range"));
        deps.say(`  ${rangeLine(o["range"] as Json)}`);
        o["style"] = await styleProbe(ctx, photo);
        o["luma"] = await lumaProbe(ctx, photo);
        deps.say(`  corners darker at Amount -50: ${String((o["luma"] as Json)["corners_darker_at_minus_50"])}`);
      }));
    }
    if (found) await restoreSelection(ctx, found.photos);
  } catch (err) {
    ctx.fail(`the probe stopped: ${describeError(err)}`);
  }
  await deps.gate.release();
  return finish(ctx, out);
}

/** WORKED: no error, both photos written, both put back. */
function finish(ctx: Ctx, out: Json[]): { worked: boolean; results: Json } {
  const putBack = out.map((w) => ({ photo: String(w["filename"]), ok: (w["put_back"] as Json | null)?.["ok"] === true }));
  const worked = ctx.errors.length === 0 && out.length === PHOTOS.length && putBack.every((p) => p.ok);
  Object.assign(ctx.results, { photos: out, suggestion: worked ? "WORKED" : "FAILED", finished_at: (ctx.deps.now ?? (() => new Date()))().toISOString() });
  ctx.deps.say("");
  ctx.deps.say(`Effects probe: ${worked ? "WORKED" : "FAILED"}`);
  for (const p of putBack) ctx.deps.say(`  ${p.photo}: put back: ${yn(p.ok)}`);
  return { worked, results: ctx.results };
}
