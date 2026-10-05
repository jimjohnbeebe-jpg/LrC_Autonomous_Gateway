// The photos of a session and which one a call works on (PRD 6.6, MCP_TOOLS lr_step `target`).
//
// Converge mode edits the master, the photo selected at lr_begin_session; every command names it
// and the plugin refuses one when another photo is selected (C-2). Variants mode edits virtual
// copies A, B, C of it. The session names its photo with `target_uuid`, which only guards the
// selected photo [handle: plugin\LrC-AVG.lrplugin\Develop.lua target()], so each call first selects
// its copy with select_photo, whose identity check refuses a photo that is not that copy of the
// master (Phase 0, P-18) [handle: plugin\LrC-AVG.lrplugin\Photos.lua find]. A click elsewhere in
// Lightroom between two calls is overridden by the next call [handle: tests\session-variants.test.ts
// "selects each copy before working on it, with its identity as the plugin checks it", against the
// Lightroom sim; in Lightroom [unverified] until PHASE4_PLAN row 10]. Plugin 0.4.0 can also act on a
// photo that is not selected (`photo_uuid`, PHASE4_PLAN row 8); Variants mode keeps selecting each
// copy, so the user sees in Lightroom which copy is being edited [stated: Jim, 2026-09-27, "go with
// recommendations" on the row 8 plan, decision 7].

import { ToolError, toToolError } from "../mcp/errors.js";
import { photoName } from "./io.js";
import type { Session, SessionContext, Target, TargetId, VariantId } from "./types.js";

export const allTargets = (s: Session): Target[] => [s.master, ...s.variants];

/** The copy with this letter, if the session has it. */
export function variant(s: Session, id: VariantId | TargetId): Target | null {
  return s.variants.find((v) => v.id === id) ?? null;
}

const letters = (s: Session): string => s.variants.map((v) => v.id).join(", ");

/**
 * The photo a call names. Converge mode: the master (`target` "master" or none). Variants mode:
 *   - a write (lr_step, lr_probe) before the pick names its copy; after the pick it is the pick,
 *     named or not;
 *   - a read (lr_get_preview, lr_get_metrics) may name any photo of the session, and defaults to the
 *     photo the last call worked on (the pick, once there is one).
 */
export function resolveTarget(s: Session, requested: TargetId | undefined, use: "write" | "read"): Target {
  if (s.mode === "converge") {
    if (requested === undefined || requested === "master") return s.master;
    throw new ToolError("INVALID_ARGUMENTS", `Only target "master" exists in Converge mode; ${requested} would be a copy of a Variants session (lr_begin_session mode "variants").`, false);
  }
  if (use === "read") {
    if (requested === undefined) return s.active;
    if (requested === "master") return s.master;
    const found = variant(s, requested);
    if (found) return found;
    throw new ToolError("INVALID_ARGUMENTS", `This session has no copy ${requested}; its photos are master, ${letters(s)}.`, false);
  }
  checkReady(s);
  if (s.picked) {
    if (requested === undefined || requested === s.picked) return variant(s, s.picked) as Target;
    throw new ToolError("INVALID_ARGUMENTS", `Copy ${s.picked} was picked, and the session continues on it alone; target "${requested}" takes no more passes.`, false);
  }
  if (requested === undefined || requested === "master") {
    throw new ToolError(
      "INVALID_ARGUMENTS",
      `A Variants session edits its copies, not the master: name the copy with target (${letters(s) || "no copy was made"}).`,
      false,
    );
  }
  const found = variant(s, requested);
  if (!found) throw new ToolError("INVALID_ARGUMENTS", `This session has no copy ${requested} (copies: ${letters(s) || "none"}).`, false);
  return found;
}

/** A Variants session whose lr_begin_session failed part-way takes no pass and no pick; it ends with revert. */
export function checkReady(s: Session): void {
  if (s.ready) return;
  throw new ToolError(
    "VARIANTS_INCOMPLETE",
    `lr_begin_session did not finish making the copies and their pass 0 (the log's failures say why), so the session takes no passes. ` +
      `End it with lr_end_session outcome "revert"; the copies made (${letters(s) || "none"}) stay in the catalog.`,
    false,
    { session_id: s.id },
  );
}

/** What select_photo checks of `t`: a copy must still be a virtual copy of the master with its name, the master must not be a copy. */
export function selectExpect(s: Session, t: Target): Record<string, unknown> {
  if (t.id === "master") return { is_virtual_copy: false };
  return { is_virtual_copy: true, master_local_id: s.master.local_id, ...(t.copy_name !== null ? { copy_name: t.copy_name } : {}) };
}

/**
 * Make `t` the photo the session works on. In Variants mode, select it in Lightroom first: a copy
 * must still be a virtual copy of the master with its name, the master must not be a copy.
 */
export async function focus(ctx: SessionContext, s: Session, t: Target): Promise<void> {
  if (s.mode === "variants") {
    try {
      await ctx.deps.client.request("select_photo", { uuid: t.uuid, expect: selectExpect(s, t) });
    } catch (err) {
      const error = toToolError(err);
      throw new ToolError(error.code, `Could not select ${photoName(t)} in Lightroom: ${error.message}`, error.recoverable, { target: t.id, uuid: t.uuid });
    }
  }
  s.active = t;
}
