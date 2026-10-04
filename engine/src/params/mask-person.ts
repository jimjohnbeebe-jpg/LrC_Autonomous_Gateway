// One person's mask, by instance (GitHub issue #59, PR C step 2c). On a photo of two people, Lightroom's own
// Entire Person masks were both MaskSubType 0 + MaskSubCategoryID 20036, told apart by InstanceIDs
// [{ InstanceID: 0 }] (the left person) and [{ InstanceID: 1 }] (the right one), each carrying the boxes of
// every person it found (InstanceBounds) [handle: docs\reports\phase6\masks-capture\
// capture4-row6_people_by_hand.json]. An entry the engine wrote without InstanceIDs came back as
// MaskSubType 3 + 13 with its point moved to the left person [handle: the engine's row 6 entry in
// capture4-check.json, step `row6_person_entire`]. So a person's mask is found by instance: a probe
// (0 + 20036, instance 0) computes the boxes; the box holding Claude's point names the instance
// (several: the nearest centre); then the wanted entry is written with that instance. That InstanceID n
// is the n-th box of InstanceBounds held for both people of that photo [inference: one photo]; a part
// (face skin, hair, ...) as MaskSubType 0 + the part's category + InstanceIDs is [unverified] until
// capture 5. Pure: field names from mask-table.ts (rule 03).

import { AI_KINDS, BOX, IMAGE, M, RECOMPUTED, newMaskId, newSyncId, type AiKind, type Component, type Correction } from "./mask-table.js";

export type Box = { top: number; left: number; bottom: number; right: number };

/** A component's person, InstanceIDs[0].InstanceID, or null. */
export function instanceOf(m: Component | null | undefined): number | null {
  const ids = m?.[IMAGE.instanceIds];
  const first = Array.isArray(ids) ? (ids[0] as Record<string, unknown> | undefined) : undefined;
  const n = first?.[IMAGE.instanceId];
  return typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : null;
}

/** The boxes of every person Lightroom found (InstanceBounds), in its order; [] when none, or when any box is not one (a box's position is its InstanceID). */
export function boundsOf(m: Component | null | undefined): Box[] {
  const raw = m?.[IMAGE.instanceBounds];
  if (!Array.isArray(raw)) return [];
  const boxes = raw.map((b) => {
    const r = (b ?? {}) as Record<string, unknown>;
    return { top: Number(r[BOX.top]), left: Number(r[BOX.left]), bottom: Number(r[BOX.bottom]), right: Number(r[BOX.right]) };
  });
  return boxes.every((box) => Object.values(box).every(Number.isFinite)) ? boxes : [];
}

/** The instance whose box holds the point; when several do, the one with the nearest centre [inference: a point on a person lies nearer its own box's centre]; null when none. */
export function pickInstance(boxes: readonly Box[], point: readonly [number, number]): number | null {
  const [x, y] = point;
  let best: { n: number; d: number } | null = null;
  boxes.forEach((b, n) => {
    if (x < b.left || x > b.right || y < b.top || y > b.bottom) return;
    const d = Math.hypot(x - (b.left + b.right) / 2, y - (b.top + b.bottom) / 2);
    if (!best || d < best.d) best = { n, d };
  });
  return (best as { n: number } | null)?.n ?? null;
}

/** The fields of one person's kind with its instance: MaskSubType 0, the kind's category, InstanceIDs. */
export const personFields = (kind: AiKind, n: number): Record<string, unknown> => ({ ...AI_KINDS[kind].fields, [IMAGE.instanceIds]: [{ [IMAGE.instanceId]: n }] });

/**
 * Correction `e` (the probe) as the wanted person mask: its component gets the kind's fields and instance
 * `n`, new mask ids (so Lightroom computes it afresh), the point, ErrorReason 0, and none of the fields
 * Lightroom computes. The correction (its id, name, sliders) is kept.
 */
export function withInstance(e: Correction, kind: AiKind, n: number, point: readonly [number, number]): Correction {
  const out = structuredClone(e) as Correction;
  const parts = out["CorrectionMasks"] as Component[];
  const old = parts[0] ?? {};
  const kept = Object.fromEntries(Object.entries(old).filter(([k]) => !RECOMPUTED.includes(k)));
  parts[0] = { ...kept, [M.id]: newMaskId(), [M.syncId]: newSyncId(), ...personFields(kind, n), [IMAGE.referencePoint]: `${point[0].toFixed(6)} ${point[1].toFixed(6)}`, [IMAGE.errorReason]: 0 };
  return out;
}
