// `npm run masks:verify`, part 2 (issue #210 item 2): does Lightroom mask the person the engine names? On a photo
// of two or more people: the engine's probe (Entire Person of instance 0, params mask-person.ts) computes and
// gives every person's box; then each one-person kind is written for the SECOND person (instance 1), as
// session\person-masks.ts writes it (withInstance), computed by Lightroom (update_ai_settings, as masks:combine
// waits), and Jim says whether that person's part brightened and the first person's did not. Automaat found
// Lightroom masks the first person whatever InstanceIDs say [upstream claim: Automaat CLAUDE.md]. A kind
// Lightroom finds nothing of (ErrorReason) is skipped; an AI mask with no result stops the part (nothing more
// may be written while it computes, Pending.lua).

import { AI_KINDS, KIND_LABELS, applyOp, boundsOf, boxToView, firstComponent, instanceOf, readTable, withInstance, type AiKind, type Box, type Correction, type CropFrame } from "../params/index.js";
import { C } from "../params/mask-table.js";
import { frameFor } from "../session/crop.js";
import { computeAi } from "./mask-combine-probe.js";
import { SLIDERS, where, writeTable, type Ctx, type Photo, type Step } from "./masks-verify.js";

const KINDS = (Object.keys(AI_KINDS) as AiKind[]).filter((k) => AI_KINDS[k].point);
const centre = (b: Box): { x: number; y: number } => ({ x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 });

/** The second person told apart from the first, in words, from their boxes as the preview shows them. */
function second(boxes: readonly Box[], frame: CropFrame): string {
  const [a, b] = (frame.refused ? boxes : boxes.map((x) => boxToView(frame, x))).map(centre) as [{ x: number; y: number }, { x: number; y: number }];
  const side = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? (b.x > a.x ? "on the RIGHT" : "on the LEFT") : b.y > a.y ? "LOWER down" : "HIGHER up";
  return `the person ${side} (centred ${where(b)})`;
}

type Here = { c: Ctx; photo: Photo; steps: Step[] };
const push = (h: Here, id: string, s: Omit<Step, "part" | "photo" | "id">): void => {
  h.steps.push({ part: "person", photo: h.photo.filename, id, ...s });
};

/** One kind for instance 1; false when the part must stop (an AI mask with no result). */
async function oneKind(h: Here, before: Correction[], probe: Correction, kind: AiKind, who: string, point: [number, number]): Promise<boolean> {
  const e = withInstance(probe, kind, 1, point);
  const id = String(e[C.id]);
  const { problems } = await writeTable(h.c.client, h.photo.uuid, [...before, e], `person ${kind}`);
  const ai = await computeAi(h.c.client, h.photo.uuid, id);
  h.c.say(`  ${KIND_LABELS[kind]}: ${ai.outcome} (${Math.round(ai.ms / 1000)} s)`);
  if (!ai.ok) {
    const found = ai.outcome.startsWith("ErrorReason");
    push(h, kind, { question: null, answer: `Lightroom: ${ai.outcome}`, ok: false, skipped: found, notes: problems });
    return found;
  }
  const back = firstComponent(readTable((await h.c.client.request("get_settings", { photo_uuid: h.photo.uuid })).settings), id);
  const question = `  Is the ${KIND_LABELS[kind]} of ${who} brighter, and the other person's NOT?`;
  const answer = await h.c.ask(question);
  push(h, kind, { question, answer, ok: answer === "y" && problems.length === 0, notes: problems, data: { instance_read_back: instanceOf(back), ai } });
  return true;
}

/** Part 2 on one photo of two or more people, behind its snapshot; steps go into `steps` as they happen. */
export async function personPart(c: Ctx, photo: Photo, steps: Step[] = []): Promise<Step[]> {
  const h: Here = { c, photo, steps };
  c.say(`${photo.filename}: one person's masks, for the second person Lightroom finds (+2 EV on each).`);
  const r = await c.guard(photo, async (sdk) => {
    const before = readTable(sdk);
    const frame = await frameFor(sdk, () => c.client.request("get_context", { target_uuid: photo.uuid }));
    const plan = applyOp(before, { op: "create", kind: "person_entire", name: "AVG verify person", point: { x: 0.5, y: 0.5 }, sliders: SLIDERS }, frame);
    await writeTable(c.client, photo.uuid, plan.entries, "person probe");
    const ai = await computeAi(c.client, photo.uuid, plan.id);
    const table = readTable((await c.client.request("get_settings", { photo_uuid: photo.uuid })).settings);
    const boxes = boundsOf(firstComponent(table, plan.id));
    if (!ai.ok || boxes.length < 2) {
      // The probe as written and as Lightroom gave it back: two runs (2026-10-28 `_DSC0103.NEF`, 2026-10-29
      // `PICT0019.DNG`, two people) computed (MaskDigest) with no InstanceBounds [handle: docs\reports\phase11\MASKS-VERIFY\run4\].
      const probe = { written: plan.entries.find((e) => e[C.id] === plan.id) ?? null, read_back: table.find((e) => e[C.id] === plan.id) ?? null };
      push(h, "probe", { question: null, answer: ai.ok ? `Lightroom found ${boxes.length} person(s)` : `probe: ${ai.outcome}`, ok: false, notes: ["select a photo with two or more people"], data: { boxes, ai, probe } });
      return;
    }
    const probe = table.find((e) => e[C.id] === plan.id) as Correction;
    const who = second(boxes, frame);
    const p = centre(boxes[1] as Box);
    c.say(`  Lightroom found ${boxes.length} people; each mask below is for ${who}.`);
    for (const kind of KINDS) if (!(await oneKind(h, before, probe, kind, who, [p.x, p.y]))) break;
  });
  if (r.error) push(h, "error", { question: null, answer: r.error, ok: false, notes: [] });
  if (!r.put_back.ok) push(h, "put_back", { question: null, answer: r.put_back.why, ok: false, notes: [] });
  return h.steps;
}
