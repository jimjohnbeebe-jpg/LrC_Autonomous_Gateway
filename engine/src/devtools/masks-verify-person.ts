// `npm run masks:verify`, part 2 (issue #210 item 2): does Lightroom make the engine's person mask? On a photo of one
// or more people: the engine's probe (Entire Person, params mask-person.ts) is written, computed by Lightroom
// (update_ai_settings, as masks:combine waits), read back, and Jim says whether a person brightened. It passes on a
// computed person mask plus Jim's y [stated: Jim, 2026-10-29, "Go with recommendations"]. People are not counted
// and no second person is masked: Lightroom gave no InstanceBounds back, and rewrote the written MaskSubType 0 /
// MaskSubCategoryID 20036 to 3 / 13 with the ReferencePoint moved onto one person [handle: %TEMP%\LrC-AVG\masks-verify\
// mask_verify_2026-10-29T02-45-05-667Z.json step probe; docs\reports\phase11\MASKS-VERIFY\run4\]. So which person an
// instance names stays [unverified].

import { applyOp, firstComponent, readTable } from "../params/index.js";
import { C, IMAGE, M, WHAT, type Component } from "../params/mask-table.js";
import { frameFor } from "../session/crop.js";
import { computeAi } from "./mask-combine-probe.js";
import { SLIDERS, writeTable, type Ctx, type Photo, type Step } from "./masks-verify.js";

/** A computed person mask as Lightroom reads it back: an image mask with a digest, of the Person (0) or People (3) family. */
export const isPersonMask = (m: Component | null): boolean =>
  m !== null && m[M.what] === WHAT.image && typeof m[IMAGE.digest] === "string" && (m[IMAGE.subType] === 0 || m[IMAGE.subType] === 3);

/** Part 2 on one photo of one or more people, behind its snapshot; steps go into `steps` as they happen. */
export async function personPart(c: Ctx, photo: Photo, steps: Step[] = []): Promise<Step[]> {
  const push = (id: string, s: Omit<Step, "part" | "photo" | "id">): void => void steps.push({ part: "person", photo: photo.filename, id, ...s });
  c.say(`${photo.filename}: the engine's person mask (+2 EV).`);
  const r = await c.guard(photo, async (sdk) => {
    const frame = await frameFor(sdk, () => c.client.request("get_context", { target_uuid: photo.uuid }));
    const plan = applyOp(readTable(sdk), { op: "create", kind: "person_entire", name: "AVG verify person", point: { x: 0.5, y: 0.5 }, sliders: SLIDERS }, frame);
    const { problems } = await writeTable(c.client, photo.uuid, plan.entries, "person probe");
    const ai = await computeAi(c.client, photo.uuid, plan.id);
    const table = readTable((await c.client.request("get_settings", { photo_uuid: photo.uuid })).settings);
    const back = firstComponent(table, plan.id);
    const data = { ai, written: plan.entries.find((e) => e[C.id] === plan.id) ?? null, read_back: back };
    if (!ai.ok || !isPersonMask(back)) {
      push("probe", { question: null, answer: ai.ok ? "Lightroom computed a mask that is not a person mask" : `probe: ${ai.outcome}`, ok: false, notes: ["select a photo with a person in it"], data });
      return;
    }
    const question = "  Is a person in the photo brighter (and the background not)?";
    const answer = await c.ask(question);
    // The write's read-back problems are notes only: Lightroom rewrites the probe's kind fields as it computes.
    push("person_entire", { question, answer, ok: answer === "y", notes: problems, data });
  });
  if (r.error) push("error", { question: null, answer: r.error, ok: false, notes: [] });
  if (!r.put_back.ok) push("put_back", { question: null, answer: r.put_back.why, ok: false, notes: [] });
  return steps;
}
