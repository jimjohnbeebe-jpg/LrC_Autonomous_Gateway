// `npm run masks:verify`, part 1 (issue #210 item 1): does a colour range select the colour asked for? On each of
// two photos: the engine's own point sample (the preview's sRGB at the clearly reddest, then greenest, place,
// written where Lightroom keeps its l, a, b; session\masks.ts) and Jim's y/n. On the first photo Jim then
// clicks a red area with Lightroom's own Color Range; the check reads Lightroom's stored sample, records the
// render's sRGB at its pin beside it, and writes a copy of it (copy_sample_from, params withCopiedSample) for a
// last y/n. Each write replaces the photo's table with its masks as they were plus one test mask; the CLI puts
// the photo back from its snapshot, Jim's own Color Range included.

import { applyOp, colorRangeOf, readTable, toView, withCopiedSample, type Correction, type CropFrame } from "../params/index.js";
import { C } from "../params/mask-table.js";
import { sampleColor } from "../metrics/index.js";
import { PreviewService } from "../preview/index.js";
import { frameFor } from "../session/crop.js";
import { SLIDERS, colourPoints, where, writeTable, type Ctx, type Photo, type Step } from "./masks-verify.js";

const RENDER = { longEdge: 800, quality: 85 };
/** How long to look for Jim's Color Range in the photo's settings: Lightroom may save it a moment after the click [upstream claim: Automaat PR #339, list_masks text]. */
const FIND_MS = 10_000;

/** `tests`: the ids of the test masks written, never taken for Jim's own Color Range. */
type Here = { c: Ctx; photo: Photo; before: Correction[]; frame: CropFrame; steps: Step[]; tests: Set<unknown> };
const step = (h: Here, id: string, s: Omit<Step, "part" | "photo" | "id">): void => {
  h.steps.push({ part: "colour", photo: h.photo.filename, id, ...s });
};

async function pointSample(h: Here, jpeg: Buffer, colour: "red" | "green", at: { x: number; y: number } | null): Promise<void> {
  if (!at) return step(h, `point_${colour}`, { question: null, answer: `no clearly ${colour} area in the render`, ok: false, notes: [`select photos with a clearly ${colour} area`] });
  const [l, a, b] = await sampleColor(jpeg, at);
  const plan = applyOp(h.before, { op: "create", kind: "color_range", name: `AVG verify ${colour}`, point: at, geometry: { sample: { l, a, b } }, sliders: SLIDERS }, h.frame);
  h.tests.add(plan.id);
  h.c.say(`  ${colour}: a colour range at the ${colour} area ${where(at)}. Look at the photo in Lightroom.`);
  const { problems } = await writeTable(h.c.client, h.photo.uuid, plan.entries, `${colour} point`);
  const question = `  Is the ${colour.toUpperCase()} area ${where(at)} brighter, and other ${colour} things too, while other colours stay as before?`;
  const answer = await h.c.ask(question);
  step(h, `point_${colour}`, { question, answer, ok: answer === "y" && problems.length === 0, notes: problems, data: { point: at, srgb_written: { l, a, b } } });
}

/** Jim's new Color Range: a correction neither in `before` nor a test mask, whose part is a colour range, looked for until FIND_MS. */
async function lightroomRange(h: Here): Promise<Correction | null> {
  const ids = new Set([...h.before.map((e) => e[C.id]), ...h.tests]);
  for (const t0 = Date.now(); Date.now() - t0 < FIND_MS; await new Promise((r) => setTimeout(r, 1000))) {
    const now = readTable((await h.c.client.request("get_settings", { photo_uuid: h.photo.uuid })).settings);
    const found = now.find((e) => !ids.has(e[C.id]) && typeof colorRangeOf((e[C.masks] as Record<string, unknown>[])[0]) !== "string");
    if (found) return found;
  }
  return null;
}

async function copied(h: Here, jpeg: Buffer, red: { x: number; y: number }): Promise<void> {
  const done = await h.c.ask(`  In Lightroom, on ${h.photo.filename}: choose Tools > Create New Mask > Color Range, then click the red area ${where(red)}. Ignore the test mask still shown; the check takes both out again. Done?`);
  const theirs = done === "y" ? await lightroomRange(h) : null;
  if (!theirs) return step(h, "copy_lightroom_sample", { question: null, answer: done === "y" ? "no new Color Range found in the photo's settings" : "Jim: n", ok: false, notes: [] });
  const got = colorRangeOf((theirs[C.masks] as Record<string, unknown>[])[0]);
  const table = [...h.before, theirs]; // the test mask out; Jim's mask and the copy in
  const op = withCopiedSample({ op: "create", kind: "color_range", name: "AVG verify copy", copy_sample_from: { mask_id: String(theirs[C.id]) }, sliders: SLIDERS }, { entries: table, frame: h.frame });
  const plan = applyOp(table, op, h.frame);
  const { problems } = await writeTable(h.c.client, h.photo.uuid, plan.entries, "copy");
  const pin = typeof got === "string" ? null : toView(h.frame, got.pin);
  const srgbAtPin = pin && pin.x >= 0 && pin.x <= 1 && pin.y >= 0 && pin.y <= 1 ? await sampleColor(jpeg, pin) : null;
  const question = "  Are the red parts brighter now (the colour you clicked, there and elsewhere), and other colours as before?";
  const answer = await h.c.ask(question);
  step(h, "copy_lightroom_sample", { question, answer, ok: answer === "y" && problems.length === 0, notes: problems, data: { lightroom: got, srgb_at_pin: srgbAtPin } });
}

/** Part 1 on `photos` (two): each photo behind its snapshot; the Lightroom click on the first only. */
export async function colourPart(c: Ctx, photos: readonly Photo[]): Promise<Step[]> {
  const steps: Step[] = [];
  for (const [i, photo] of photos.entries()) {
    c.say(`${photo.filename}: colour ranges, one at a time (+2 EV on each).`);
    const r = await c.guard(photo, async (sdk) => {
      const h: Here = { c, photo, before: readTable(sdk), frame: await frameFor(sdk, () => c.client.request("get_context", { target_uuid: photo.uuid })), steps, tests: new Set() };
      const jpeg = (await new PreviewService(c.client).render({ ...RENDER, targetUuid: photo.uuid })).jpeg;
      const at = await colourPoints(jpeg);
      await pointSample(h, jpeg, "red", at.red);
      await pointSample(h, jpeg, "green", at.green);
      if (i === 0 && at.red) await copied(h, jpeg, at.red);
    });
    if (r.error) steps.push({ part: "colour", photo: photo.filename, id: "error", question: null, answer: r.error, ok: false, notes: [] });
    if (!r.put_back.ok) steps.push({ part: "colour", photo: photo.filename, id: "put_back", question: null, answer: r.put_back.why, ok: false, notes: [] });
  }
  return steps;
}
