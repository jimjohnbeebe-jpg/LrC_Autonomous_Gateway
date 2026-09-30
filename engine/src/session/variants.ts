// Variants mode (PRD 6.6, AVG-008, PHASE4_PLAN decision 2): lr_begin_session makes the copies and
// runs pass 0 on each, with the intent's priors plus that copy's variant priors, and returns an
// A/B/C contact sheet. Each copy then takes one refined lr_step; the user picks one
// (lr_select_variant, pick.ts), and convergence continues on the pick. The master is not edited.
// All of this is tested against the Lightroom sim [handle: tests\session-variants.test.ts,
// tests\session-variants-faults.test.ts]; in Lightroom it is [unverified] until PHASE4_PLAN row 10.

import { summarize } from "../metrics/index.js";
import { differingSettings, type FromSdkResult } from "../params/index.js";
import { composite, type Composite } from "../preview/index.js";
import { sessionHeader, type Opened } from "./begin.js";
import { DEFAULT_VARIANT_COUNT, makeCopies } from "./copies.js";
import { brief, describe, failed, ms, read, recordPass, render, saveLog } from "./io.js";
import { pass0, pass0Entry, type Pass0 } from "./pass0.js";
import { focus } from "./targets.js";
import type { BeginArgs, Rendered, ReturnImage, Session, SessionContext, SessionOutput, Target } from "./types.js";

/** What Claude does next after the contact sheet (PRD 6.6 steps 4-5; P-10: the image shows only in the expanded tool call). */
export const VARIANTS_NEXT =
  "Compare the copies on the contact sheet, then give each one refined pass: lr_step with target \"A\", then \"B\", and so on, " +
  "one step per copy. Then describe the copies to the user and ask which to continue with; the user can also compare them in " +
  "Lightroom by their copy names. Call lr_select_variant with the user's pick; the remaining passes go to that copy.";

/** Log the open session, render the master, make the copies, then pass 0 on each. A failure leaves the session open for revert. */
export async function runVariants(ctx: SessionContext, opened: Opened, args: BeginArgs): Promise<SessionOutput> {
  const { s, view } = opened;
  saveLog(s);
  try {
    const original = await render(ctx, s, s.master, view.settings);
    s.work = { target: s.master, pass: null, note: "Making the virtual copies" };
    ctx.deps.hud?.stage(s, "pass0");
    await makeCopies(ctx, s, s.log.variant_count ?? DEFAULT_VARIANT_COUNT);
    // The HUD must list the copies before the first is selected, or it shows "Target changed"
    // [handle: plugin\LrC-AVG.lrplugin\HudState.lua targetChangedLine; PHASE5_PLAN "From row 4"].
    ctx.deps.hud?.stage(s, "pass0");
    await ctx.deps.hud?.settle(s);
    const done: Array<{ t: Target; p: Pass0 }> = [];
    for (const t of s.variants) done.push({ t, p: await copyPass0(ctx, s, t, view, original) });
    s.ready = true;
    const sheet = await contactSheet(s, args.return_image ?? "after", original);
    const json = {
      ...sessionHeader(opened),
      pass: `0/${s.maxPasses}`,
      variants: done.map(({ t, p }) => variantJson(s, t, p)),
      ...(sheet ? { contact_sheet: sheetJson(sheet) } : {}),
      next: VARIANTS_NEXT,
      timings: { total_ms: ms(opened.started) },
    };
    return {
      json,
      ...(sheet ? { image: sheet.jpeg } : {}),
      log: {
        session_id: s.id,
        intent_id: s.intent.intent.id,
        mode: s.mode,
        target: { uuid: s.master.uuid, filename: s.master.filename },
        snapshot: s.snapshot,
        log_path: s.files.logPath,
        variants: done.map(({ t, p }) => ({ id: t.id, uuid: t.uuid, history_names: p.historyNames, metrics: brief(p.rendered.metrics), guardrail_actions: p.actions.length })),
      },
    };
  } catch (err) {
    throw failed(ctx, s, "begin", err);
  }
}

/**
 * Pass 0 on one copy: select it, read it, and write the priors. A new virtual copy starts with the
 * master's settings [inference], so the master's render stands for the copy before pass 0 when its
 * settings read back the same; otherwise the copy is rendered first.
 */
async function copyPass0(ctx: SessionContext, s: Session, t: Target, masterView: FromSdkResult, original: Rendered): Promise<Pass0> {
  const started = performance.now();
  await focus(ctx, s, t);
  const view = await read(ctx, s, t);
  t.process_version = view.process_version;
  t.camera_profile = view.camera_profile.name;
  const same = differingSettings(view.settings, masterView.settings).length === 0;
  const priors = s.intent.intent.variants?.[t.id as "A" | "B" | "C"].priors ?? {};
  const p = await pass0(ctx, s, t, view, priors, same ? original : null);
  recordPass(s, pass0Entry(s, t, view, p, ms(started)));
  return p;
}

function variantJson(s: Session, t: Target, p: Pass0): Record<string, unknown> {
  return {
    id: t.id,
    label: t.label,
    uuid: t.uuid,
    local_id: t.local_id,
    copy_name: t.copy_name,
    pass: `${t.passes}/${s.maxPasses}`,
    history_names: p.historyNames,
    pass0_applied: p.applied,
    guardrail_actions: p.actions,
    settings: p.view.settings,
    metrics: summarize(p.rendered.metrics),
    delta_metrics: p.delta,
    ...describe(p.rendered),
  };
}

/**
 * The copies' last renders side by side, each labelled "A natural - pass n" (PRD 6.6 step 3); with
 * "before_after", the master before the session first. Null for "none", or with fewer than two panels.
 */
export async function contactSheet(s: Session, mode: ReturnImage, before: Rendered | null): Promise<Composite | null> {
  if (mode === "none") return null;
  const panels = s.variants.flatMap((v) => (v.last ? [{ image: v.last.jpeg, label: `${v.id} ${v.label ?? ""} - pass ${v.passes}` }] : []));
  if (mode === "before_after" && before) panels.unshift({ image: before.jpeg, label: "before" });
  if (panels.length < 2) return null;
  return composite(panels.slice(0, 4), { longEdge: s.longEdge, quality: s.quality });
}

export function sheetJson(sheet: Composite): Record<string, unknown> {
  return { layout: sheet.layout, width: sheet.width, height: sheet.height, panels: sheet.panels };
}
