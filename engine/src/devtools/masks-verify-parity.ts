// `npm run masks:parity` (`npm run masks:verify -- --part parity`), GitHub issue #217: the new mask rows in Lightroom,
// on ONE photo that is not flipped, behind its snapshot (masks-verify-cli.ts puts it back). Each step writes the
// photo's masks as they were plus the test masks, as the session does (params applyOp, the whole table), reads it
// back, and asks Jim one y/n:
//   1. brush: three strokes across the photo, soft (feather 100), hard (feather 0) and at density 0.4;
//   2. erase: an erase stroke added down the middle of that brush (strokes added to a brush);
//   3. Point Color: one swatch with distinct shifts on the brush, and whether the panel shows those numbers, which
//      tells whether the stored order (params\mask-point-colors.ts, [upstream claim] + [inference]) is Lightroom's;
//   4. inverted copy of the brush;
//   5. lr_delete_empty_masks' command on the photo (asks nothing: whether the call runs and leaves the test masks);
//   6. local curve capture (row 3, parked: no capture shows the stored field yet): Jim drags the brush mask's curve
//      by hand and the step saves which correction fields changed, to pin their names (rule 03).
// Panel numbers for the swatch (-100..100 for the stored -1..1) are [inference].

import { applyOp, readTable, type Correction, type MaskOp } from "../params/index.js";
import { C } from "../params/mask-table.js";
import { frameFor } from "../session/crop.js";
import { writeTable, type Ctx, type Photo, type Step } from "./masks-verify.js";

const SLIDERS = { "local.exposure": 2 };
const across = (y: number) => [{ x: 0.1, y }, { x: 0.9, y }];
/** Step 1's strokes, top to bottom; radius 0.04 of the long edge. */
export const BANDS = [
  { points: across(0.3), radius: 0.04, feather: 100 },
  { points: across(0.5), radius: 0.04, feather: 0 },
  { points: across(0.7), radius: 0.04, density: 0.4 },
];
export const ERASE = { points: [{ x: 0.5, y: 0.15 }, { x: 0.5, y: 0.85 }], radius: 0.03, erase: true };
export const SWATCH = { src_hue: 0.2, src_sat: 0.6, src_lum: 0.5, hue_shift: 0.5, sat_scale: -0.5, lum_scale: 0.25, range_amount: 0.8 };

/** The fields of correction `after` that are new or differ from `before` (CorrectionMasks aside), for the curve capture. */
export function changedFields(before: Correction | undefined, after: Correction | undefined): Record<string, unknown> {
  if (!after) return {};
  const same = (k: string): boolean => before !== undefined && JSON.stringify(before[k]) === JSON.stringify(after[k]);
  return Object.fromEntries(Object.keys(after).filter((k) => k !== C.masks && !same(k)).map((k) => [k, after[k]]));
}

type Here = { c: Ctx; photo: Photo; steps: Step[]; table: Correction[]; brush: string };
const push = (h: Here, id: string, s: Omit<Step, "part" | "photo" | "id">): void => {
  h.steps.push({ part: "parity", photo: h.photo.filename, id, ...s });
};
const read = async (h: Here): Promise<Correction[]> => readTable((await h.c.client.request("get_settings", { photo_uuid: h.photo.uuid })).settings);

/** Apply `op` to the table, write it, ask `question`; the table written becomes the next step's. */
async function write(h: Here, id: string, op: MaskOp, question: string, frame: Parameters<typeof applyOp>[2]): Promise<string> {
  const plan = applyOp(h.table, op, frame);
  const { problems } = await writeTable(h.c.client, h.photo.uuid, plan.entries, id);
  h.table = plan.entries;
  const answer = await h.c.ask(question);
  push(h, id, { question, answer, ok: answer === "y" && problems.length === 0, notes: problems, data: { mask: plan.after } });
  return plan.id;
}

async function emptyMasks(h: Here): Promise<void> {
  try {
    const r = await h.c.client.request("delete_empty_masks", { photo_uuid: h.photo.uuid, snapshot_name: "AVG masks:parity empty" });
    const after = readTable(r.read_back).length;
    const kept = after >= h.table.length;
    push(h, "delete_empty_masks", { question: null, answer: `${r.status}, ${h.table.length} masks before, ${after} after`, ok: kept, notes: kept ? [] : ["a test mask was deleted"] });
  } catch (err) {
    push(h, "delete_empty_masks", { question: null, answer: err instanceof Error ? err.message : String(err), ok: false, notes: [] });
  }
}

async function curveCapture(h: Here): Promise<void> {
  const was = (await read(h)).find((e) => e[C.id] === h.brush);
  const done = await h.c.ask('  In Lightroom\'s Masking panel select the mask "AVG parity brush", open its Curve section and drag the middle of the curve up a little. Done?');
  const now = (await read(h)).find((e) => e[C.id] === h.brush);
  const changed = changedFields(was, now);
  push(h, "curve_capture", { question: null, answer: done === "y" ? `${Object.keys(changed).length} field(s) changed` : "Jim: n", ok: done === "y" && Object.keys(changed).length > 0, skipped: done !== "y", notes: [], data: { changed } });
}

/** The parity part on one photo, behind its snapshot. */
export async function parityPart(c: Ctx, photo: Photo): Promise<Step[]> {
  const h: Here = { c, photo, steps: [], table: [], brush: "" };
  c.say(`${photo.filename}: the issue #217 mask rows, one step at a time (+2 EV on the test masks).`);
  const r = await c.guard(photo, async (sdk) => {
    h.table = readTable(sdk);
    const frame = await frameFor(sdk, () => c.client.request("get_context", { target_uuid: photo.uuid }));
    h.brush = await write(h, "brush_feather_density", { op: "create", kind: "brush", name: "AVG parity brush", geometry: { strokes: BANDS }, sliders: SLIDERS }, "  Three brighter bands across the photo: the TOP with a soft edge, the MIDDLE with a hard edge, the BOTTOM less bright than the other two?", frame);
    await write(h, "brush_erase_added", { op: "edit", mask_id: h.brush, geometry: { strokes: [ERASE] } }, "  Is there now a gap down the middle of all three bands (the erase stroke)?", frame);
    await write(h, "point_color", { op: "edit", mask_id: h.brush, point_colors: { action: "add", swatch: SWATCH } }, '  Select "AVG parity brush" in the Masking panel and open its Point Color: is there ONE swatch, and with it selected do the sliders read about Hue +50, Saturation -50, Luminance +25 and Range 80?', frame);
    await write(h, "inverted_copy", { op: "edit", mask_id: h.brush, inverted: true, copy: true }, '  Is there a new mask "AVG parity brush inverted" that brightens everything EXCEPT the bands (the first mask still there)?', frame);
    await emptyMasks(h);
    await curveCapture(h);
  });
  if (r.error) push(h, "error", { question: null, answer: r.error, ok: false, notes: [] });
  if (!r.put_back.ok) push(h, "put_back", { question: null, answer: r.put_back.why, ok: false, notes: [] });
  return h.steps;
}
