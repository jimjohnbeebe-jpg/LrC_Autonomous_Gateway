// `npm run masks:crop` (GitHub issue #179): the steps on one photo (the CLI, mask-crop-probe-cli.ts, holds the
// snapshot and puts the photo back). Case A: the photo as it is, its own crop. Case B: the same crop turned to
// CropAngle ANGLE_B and shrunk to stay on the photo (turnCrop), written through apply_settings; the case reads
// the crop back from Lightroom and maps with what it read. In each case: a render without new masks; for each point, the photo's masks plus one radial
// placed by the engine's own path (session\crop.ts frameFor, params applyOp: what lr_create_mask writes), read
// back as lr_list_masks shows it (summarize), rendered and the blob located; then the issue's foreground
// gradient, its frame delta luma. Each write replaces the whole table, so each radial is alone on the photo.

import type { BridgeClient } from "../bridge/index.js";
import { CROP, applyOp, isIdentity, readTable, summarize, tableSettings, type Correction, type CropFrame, type MaskOp, type SdkSettings } from "../params/index.js";
import { PreviewService } from "../preview/index.js";
import { frameFor } from "../session/crop.js";
import { describeError } from "./phase1-check.js";
import { ANGLE_B, HISTORY, LINEAR_GEOMETRY, POINTS, blobOf, grey, linearOp, linearVerdict, pointVerdict, radialOp, sameGeometry, type LinearResult, type PointResult } from "./mask-crop-probe.js";

/** The render each case measures: large enough for a 3 % miss to be many pixels [inference]. */
const RENDER = { longEdge: 1024, quality: 90 };
const EXPORT_TIMEOUT_MS = 60000;

export type CaseResult = { case: "A" | "B"; crop: Record<string, unknown>; frame: CropFrame; points: PointResult[]; linear: LinearResult | null; error?: string; ok: boolean };
type Run = { client: BridgeClient; previews: PreviewService; uuid: string; say: (line: string) => void };

export const runFor = (client: BridgeClient, uuid: string, say: (line: string) => void, previewDir?: string): Run => ({
  client, uuid, say, previews: new PreviewService(client, { exportTimeoutMs: EXPORT_TIMEOUT_MS, ...(previewDir ? { previewDir } : {}) }),
});

const cropOf = (sdk: SdkSettings): Record<string, unknown> => Object.fromEntries(Object.values(CROP).map((k) => [k, sdk[k] ?? null]));

export async function write(run: Run, settings: SdkSettings, label: string): Promise<SdkSettings> {
  return (await run.client.request("apply_settings", { target_uuid: run.uuid, settings, history_name: `${HISTORY} ${label}` })).read_back;
}

const render = (run: Run) => run.previews.render({ ...RENDER, targetUuid: run.uuid });

/** Write the photo's masks plus `op`'s mask, as the engine places it; whether lr_list_masks-style read-back gives back `asked`, and what it gave. */
async function place(run: Run, before: Correction[], frame: CropFrame, op: MaskOp, asked: unknown, label: string): Promise<{ ok: boolean; shown: unknown }> {
  const plan = applyOp(before, op, frame);
  const back = await write(run, tableSettings(plan.entries, false), label);
  const shown = readTable(back).map((e) => summarize(e, frame)).find((m) => m.id === plan.id);
  return { ok: sameGeometry(asked, shown?.geometry), shown: shown?.geometry };
}

/** One case on the photo whose settings are `sdk` (its masks `before`); `lift`: masks:verify's lifting of a mirrored photo's refusal (issue #210). */
export async function oneCase(run: Run, which: "A" | "B", sdk: SdkSettings, lift: (f: CropFrame) => CropFrame = (f) => f): Promise<CaseResult> {
  const before = readTable(sdk);
  const frame = lift(await frameFor(sdk, () => run.client.request("get_context", { target_uuid: run.uuid })));
  const out: CaseResult = { case: which, crop: cropOf(sdk), frame, points: [], linear: null, ok: false };
  run.say(`  Case ${which}: crop ${JSON.stringify(out.crop)}${isIdentity(frame) ? " (uncropped, upright)" : ""}`);
  try {
    const base = await render(run);
    const baseGrey = await grey(base.jpeg);
    for (const [i, p] of POINTS.entries()) {
      const op = radialOp(p, i + 1);
      const readBack = await place(run, before, frame, op, op.geometry, `${which} radial ${i + 1}`);
      const r = pointVerdict(p, blobOf(baseGrey, await grey((await render(run)).jpeg)), readBack.ok);
      out.points.push(readBack.ok ? r : { ...r, shown: readBack.shown });
      run.say(`    radial at (${p.x}, ${p.y}): ${r.ok ? "PASS" : "FAIL"} (${r.why})`);
    }
    const readBack = await place(run, before, frame, linearOp, LINEAR_GEOMETRY, `${which} foreground`);
    out.linear = linearVerdict((await render(run)).metrics.luma_mean - base.metrics.luma_mean, readBack.ok);
    run.say(`    foreground gradient: ${out.linear.ok ? "PASS" : "FAIL"} (${out.linear.why})`);
  } catch (err) {
    out.error = describeError(err);
    run.say(`    stopped: ${out.error}`);
  }
  out.ok = !out.error && out.points.length === POINTS.length && out.points.every((p) => p.ok) && out.linear?.ok === true;
  return out;
}

/**
 * Case B's settings, as Lightroom read them back: the photo's crop (`sdk`) turned to ANGLE_B about its centre and
 * shrunk until the turned rectangle lies inside the photo, its corners written as crop-frame.ts reads them. The
 * angle alone would leave the turned corners past the photo, and whether Lightroom then fits the crop again is
 * [unverified].
 */
export async function turnCrop(run: Run, sdk: SdkSettings): Promise<SdkSettings> {
  const f = await frameFor({ ...sdk, [CROP.angle]: ANGLE_B }, () => run.client.request("get_context", { target_uuid: run.uuid }));
  const k = f.aspect; // the stored photo's width / height
  const turn = (deg: number): [number, number] => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
  const [c0, s0] = turn(Number(sdk[CROP.angle] ?? 0));
  const [dx, dy] = [(f.right - f.left) * k, f.bottom - f.top];
  const [ws, hs] = [dx * c0 + dy * s0, -dx * s0 + dy * c0]; // the crop's sides, as crop-frame.ts basis
  const [c, s] = turn(ANGLE_B);
  const [cx, cy] = [((f.left + f.right) / 2) * k, (f.top + f.bottom) / 2];
  const [ex, ey] = [(Math.abs(ws) * c + Math.abs(hs) * s) / 2, (Math.abs(ws) * s + Math.abs(hs) * c) / 2];
  const fit = 0.98 * Math.min(1, cx / ex, (k - cx) / ex, cy / ey, (1 - cy) / ey); // 2 % for Lightroom's rounding [inference]
  const [ox, oy] = [((ws * c - hs * s) / 2) * fit, ((ws * s + hs * c) / 2) * fit];
  const crop = { [CROP.left]: (cx - ox) / k, [CROP.top]: cy - oy, [CROP.right]: (cx + ox) / k, [CROP.bottom]: cy + oy, [CROP.angle]: ANGLE_B };
  return write(run, crop, `B crop angle ${ANGLE_B}`);
}
