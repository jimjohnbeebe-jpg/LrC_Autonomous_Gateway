// The pick of Variants mode (PRD 6.6 steps 4-5, MCP_TOOLS lr_select_variant, ARCHITECTURE section 4
// "awaiting_pick"): one refined pass per copy, then the user's pick, then convergence on the pick.
// In Phase 4 the pick is made in chat [stated: Jim, 2026-09-27, PHASE4_PLAN decision 3]. Like the
// HUD's Pick button will be, lr_select_variant is accepted before every copy has had its refined
// pass [inference: the plan for PHASE4_PLAN row 7, approved by Jim 2026-09-27].

import { ToolError } from "../mcp/errors.js";
import { summarize } from "../metrics/index.js";
import { variantEntry } from "./copies.js";
import { describe, failed, saveLog } from "./io.js";
import { checkReady, focus, variant } from "./targets.js";
import type { ReturnImage, SelectArgs, Session, SessionContext, SessionOutput, Target } from "./types.js";
import { contactSheet, sheetJson } from "./variants.js";

const brief = (t: Target): Record<string, unknown> => ({ id: t.id, label: t.label, uuid: t.uuid, copy_name: t.copy_name });

/** Variants mode before the pick, once every copy has had its refined pass: only a pick (or the end) comes next. */
export const awaitingPick = (s: Session): boolean => s.mode === "variants" && s.picked === null && s.variants.length > 0 && s.variants.every((v) => v.passes >= 1);

export const PICK_NEXT =
  "Every copy has had its refined pass. Describe the copies to the user (the contact sheet shows them side by side; they can " +
  "also compare them in Lightroom by their copy names) and ask which one to continue with, then call lr_select_variant.";

/**
 * What the step that completes the round of refined passes adds (ARCHITECTURE section 4:
 * awaiting_pick): each copy's metrics, and the contact sheet instead of the step's own image.
 */
export async function pickRound(s: Session, mode: ReturnImage): Promise<{ json: Record<string, unknown>; image: Buffer | null }> {
  const sheet = await contactSheet(s, mode, s.master.last);
  const variants = s.variants.map((v) => ({
    ...brief(v),
    pass: `${v.passes}/${s.maxPasses}`,
    ...(v.last ? { metrics: summarize(v.last.metrics), ...describe(v.last) } : {}),
  }));
  return { json: { awaiting_pick: true, variants, ...(sheet ? { contact_sheet: sheetJson(sheet) } : {}), next: PICK_NEXT }, image: sheet?.jpeg ?? null };
}

/** Before the pick, a copy takes one refined pass (PRD 6.6 step 4); a second waits for the pick. */
export function checkVariantStep(s: Session, t: Target): void {
  if (s.mode !== "variants" || s.picked !== null) return;
  if (awaitingPick(s)) {
    throw new ToolError(
      "AWAITING_PICK",
      "Every copy has had its refined pass. Show the user the copies and call lr_select_variant with the one they pick; the remaining passes go to it.",
      false,
      { session_id: s.id },
    );
  }
  if (t.passes >= 1) {
    const left = s.variants.filter((v) => v.passes < 1).map((v) => v.id);
    throw new ToolError("AWAITING_PICK", `Copy ${t.id} has had its refined pass. Step ${left.join(", ")} first, or let the user pick (lr_select_variant).`, false, { session_id: s.id });
  }
}

/** lr_select_variant: the pick becomes the session's photo, selected in Lightroom; its own pass count carries on. */
export async function selectVariant(ctx: SessionContext, s: Session, args: SelectArgs): Promise<SessionOutput> {
  if (s.mode !== "variants") throw new ToolError("INVALID_ARGUMENTS", "lr_select_variant is for a Variants session (lr_begin_session mode \"variants\").", false);
  checkReady(s);
  if (s.picked !== null) throw new ToolError("INVALID_ARGUMENTS", `Copy ${s.picked} is already picked; the session continues on it.`, false, { session_id: s.id });
  const t = variant(s, args.variant);
  if (!t) throw new ToolError("INVALID_ARGUMENTS", `This session has no copy ${args.variant} (copies: ${s.variants.map((v) => v.id).join(", ") || "none"}).`, false);
  try {
    await focus(ctx, s, t);
  } catch (err) {
    throw failed(ctx, s, `pick ${t.id}`, err);
  }
  s.picked = t.id as SelectArgs["variant"];
  s.log.picked = s.picked;
  s.log.variants = s.variants.map((v) => variantEntry(v, v === t));
  saveLog(s);
  const unrefined = s.variants.filter((v) => v.passes < 1).map((v) => v.id);
  // Unpicked copies are kept; the SDK has no call that removes a photo [stated: Jim, 2026-09-27,
  // PHASE4_PLAN decision 4; handle: docs\reports\phase4\S7.md Verdict 2].
  const json = {
    ok: true,
    session_id: s.id,
    picked: brief(t),
    pass: `${t.passes}/${s.maxPasses}`,
    passes_left: t.endReason ? 0 : s.maxPasses - t.passes,
    converged_by_metrics: t.endReason === "converged",
    cap_reached: t.endReason === "cap_reached",
    ...(unrefined.length ? { picked_before_refining: unrefined } : {}),
    unpicked: s.variants.filter((v) => v !== t).map(brief),
    note:
      `Copy ${t.id} is selected in Lightroom, and lr_step works on it from now on (target may be left out). ` +
      "The other copies stay in the catalog as they are; the user removes them in Lightroom when they want.",
    ...(t.last ? describe(t.last) : {}),
  };
  return {
    json,
    ...(t.last ? { image: t.last.jpeg } : {}),
    log: { session_id: s.id, picked: t.id, uuid: t.uuid, pass: json.pass, ...(unrefined.length ? { picked_before_refining: unrefined } : {}) },
  };
}
