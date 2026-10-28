// An inverted copy of a mask (GitHub issue #217 row 2, upstream's invert_mask mode "copy" [upstream claim:
// Automaat/lightroom-mcp bccec44, #318, which calls LrDevelopController.duplicateAndInvertMask]), built here on the
// mask table instead, so it goes through the session's pass like every other mask change. Field names come only
// from mask-table.ts (rule 03). The copy is the mask's correction cloned with fresh ids (the correction's, its
// part's and, for a brush, each stroke's: Lightroom gives every entry its own [handle: docs\reports\phase8.5\
// mask-carry\mask_carry_2026-10-11T22-37-39-161Z.json, every CorrectionID, MaskID and MaskSyncID distinct]), its
// one part inverted as lr_edit_mask `inverted` writes it, appended after the other masks [inference: where
// Lightroom puts its own duplicate is not captured]. An AI part loses the fields Lightroom computes (RECOMPUTED:
// the digests and the photo's own fields), so it is written in Adobe's own form as a new AI mask is and Lightroom
// computes it afresh; nothing of the source's computed mask is copied [inference: a digest names the computed
// pixels]. A mask of several parts is not copied, as it is not inverted whole (mask-ops.ts edit).

import type { CropFrame } from "./crop-frame.js";
import { BRUSH, C, M, MaskError, RADIAL, RECOMPUTED, WHAT, componentKind, components, isAiKind, newMaskId, newSyncId, type AiKind, type Component, type Correction } from "./mask-table.js";
import { summarize, type MaskSummary } from "./mask-summary.js";

/** A component with fresh MaskID / MaskSyncID, a brush's strokes too, and no computed AI fields. */
function fresh(m: Component): Component {
  const out: Component = { ...m, [M.id]: newMaskId(), [M.syncId]: newSyncId() };
  for (const f of RECOMPUTED) delete out[f];
  const strokes = m[BRUSH.masks];
  if (Array.isArray(strokes)) out[BRUSH.masks] = strokes.map((s: Component) => ({ ...s, [M.id]: newMaskId(), [M.syncId]: newSyncId() }));
  return out;
}

export type CopyResult = { entry: Correction; after: MaskSummary; ai: AiKind | null };

/** The inverted copy of correction `e`, named `name` (default "<name> inverted"), with `stored` slider fields over the source's. */
export function invertedCopy(e: Correction, name: string | undefined, stored: Record<string, number>, frame: CropFrame): CopyResult {
  const parts = components(e);
  if (parts.length !== 1) throw new MaskError("MASK_OP_NOT_CAPTURED", "This mask has several parts; an inverted copy is made of a mask of one part only.");
  const part = fresh(parts[0] as Component);
  const inverted = part[M.inverted] !== true;
  // As lr_edit_mask `inverted` writes it: an inverted radial reads back Flipped false (issue #79, mask-ops.ts edit).
  Object.assign(part, { [M.inverted]: inverted }, part[M.what] === WHAT.radial ? { [RADIAL.flipped]: !inverted } : {});
  const copy = structuredClone(e) as Correction;
  Object.assign(copy, stored, { [C.id]: newMaskId(), [C.syncId]: newSyncId(), [C.name]: name ?? `${String(e[C.name] ?? "Mask")} inverted`, [C.masks]: [part] });
  const kind = componentKind(part);
  return { entry: copy, after: summarize(copy, frame), ai: isAiKind(kind) ? kind : null };
}
