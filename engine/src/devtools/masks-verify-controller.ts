// `npm run masks:parity` part "controller" (`npm run masks:parity -- --part controller` alone), GitHub issue #217 row 3
// and the Point Color fix: a mask's local curves and Point Color through LrDevelopController (plugin MaskControl.lua,
// engine params\mask-controller.ts), on ONE photo selected in Develop, behind its snapshot (masks-verify-cli.ts puts it
// back). It writes a radial test mask (the table, as the session does), then through mask_controller, each read back
// through getValue and Jim asked y/n:
//   1. a main-curve midtone lift on the radial;
//   2. a red-channel lift on it;
//   3. one Point Color swatch with distinct shifts (masks-verify-parity.ts SWATCH), the question Jim answered n to when
//      it was written to the table [handle: %TEMP%\LrC-AVG\masks-verify\mask_verify_2026-10-28T11-59-26-227Z.json
//      step point_color];
//   4. every curve and the swatches read again with no write (asks nothing; saved).
// The panel numbers Jim reads for the swatch (-100..100 for -1..1) are [inference]. Report:
// docs\reports\phase11\MASK-CONTROLLER.md.

import { CONTROLLER_PARAMS, applyOp, curveWrites, readTable, curvesOf, swatchRequest, swatchesOf, type Curves, type CurvePoints } from "../params/index.js";
import type { SwatchPatch } from "../params/mask-point-colors.js";
import { frameFor } from "../session/crop.js";
import { writeTable, type Ctx, type Photo, type Step } from "./masks-verify.js";
import { SWATCH } from "./masks-verify-parity.js";

export const NAME = "AVG controller radial";
/** The radial's box, the middle half of the photo. */
export const BOX = { left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 };
const LIFTED: CurvePoints = [
  [0, 0],
  [128, 180],
  [255, 255],
];
export const MAIN: Curves = { main: LIFTED };
export const RED: Curves = { red: LIFTED };

const near = (a: unknown, b: number | undefined, tol: number): boolean => typeof a === "number" && b !== undefined && Math.abs(a - b) <= tol;

/** Whether the values read back hold each curve given, point by point within 1 (MaskControl.lua's tolerance). */
export function curvesHold(values: Readonly<Record<string, unknown>>, wanted: Curves): boolean {
  const got = curvesOf(values);
  return Object.entries(wanted).every(([k, pts]) => {
    const g = got[k as keyof Curves];
    return g !== undefined && pts !== undefined && g.length === pts.length && pts.every((p, i) => near(g[i]?.[0], p[0], 1) && near(g[i]?.[1], p[1], 1));
  });
}

/** Whether one swatch read back holds every field of `wanted` within 0.01 (MaskSwatches.lua's tolerance). */
export function swatchHeld(values: Readonly<Record<string, unknown>>, wanted: SwatchPatch): boolean {
  return swatchesOf(values).some((w) => Object.entries(wanted).every(([k, v]) => near(w[k as keyof SwatchPatch], v as number, 0.01)));
}

type Here = { c: Ctx; photo: Photo; steps: Step[]; mask: string };
const push = (h: Here, id: string, s: Omit<Step, "part" | "photo" | "id">): void => {
  h.steps.push({ part: "controller", photo: h.photo.filename, id, ...s });
};
const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** One mask_controller call, then Jim's answer to `question` (none when null); ok when he says y and `held` reads back true. */
async function step(h: Here, id: string, payload: { curves?: ReturnType<typeof curveWrites>; swatches?: ReturnType<typeof swatchRequest> }, question: string | null, held: (after: Record<string, unknown>) => boolean): Promise<void> {
  try {
    const r = await h.c.client.request("mask_controller", { target_uuid: h.photo.uuid, mask_id: h.mask, ...payload, read: CONTROLLER_PARAMS });
    const kept = held(r.after);
    const answer = question ? await h.c.ask(question) : kept ? "read back" : "not read back";
    const notes = kept ? [] : ["the value read back through getValue is not the one written"];
    push(h, id, { question, answer, ok: kept && (question === null || answer === "y"), notes, data: { written: r.written, settled: r.settled, before: r.before, after: r.after, live: { curves: curvesOf(r.after), point_colors: swatchesOf(r.after) }, ms: r.ms } });
  } catch (err) {
    push(h, id, { question: null, answer: message(err), ok: false, notes: [] });
  }
}

/** The controller part on one photo, behind its snapshot. */
export async function controllerPart(c: Ctx, photo: Photo): Promise<Step[]> {
  const h: Here = { c, photo, steps: [], mask: "" };
  c.say(`${photo.filename}: mask curves and Point Color through Lightroom's Develop module, one step at a time.`);
  const r = await c.guard(photo, async (sdk) => {
    const frame = await frameFor(sdk, () => c.client.request("get_context", { target_uuid: photo.uuid }));
    const plan = applyOp(readTable(sdk), { op: "create", kind: "radial", name: NAME, geometry: BOX }, frame);
    const { problems } = await writeTable(c.client, photo.uuid, plan.entries, "controller radial");
    push(h, "radial", { question: null, answer: problems.length === 0 ? "written" : "not taken", ok: problems.length === 0, notes: problems });
    if (problems.length > 0) return;
    h.mask = plan.id;
    const look = `  In the Masking panel select "${NAME}" (a circle in the middle of the photo) and open its Curve section`;
    await step(h, "main_curve", { curves: curveWrites(MAIN) }, `${look}: are the midtones inside the circle brighter than outside it, and does the curve show a lift in the middle?`, (a) => curvesHold(a, MAIN));
    await step(h, "red_curve", { curves: curveWrites(RED) }, `${look} and pick its Red channel: is the inside of the circle now redder, and does the red curve show a lift in the middle?`, (a) => curvesHold(a, RED));
    await step(h, "point_color", { swatches: swatchRequest({ action: "add", swatch: SWATCH }) }, `  Select "${NAME}" in the Masking panel and open its Point Color: is there ONE swatch, and with it selected do the sliders read about Hue +50, Saturation -50, Luminance +25 and Range 80?`, (a) => swatchHeld(a, SWATCH));
    await step(h, "read_back", {}, null, (a) => curvesHold(a, { ...MAIN, ...RED }) && swatchHeld(a, SWATCH));
  });
  if (r.error) push(h, "error", { question: null, answer: r.error, ok: false, notes: [] });
  if (!r.put_back.ok) push(h, "put_back", { question: null, answer: r.put_back.why, ok: false, notes: [] });
  return h.steps;
}
