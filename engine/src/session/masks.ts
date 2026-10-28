// The mask tools inside an editing session (GitHub issue #59, PR C step 2): lr_list_masks reads the
// photo's masks; lr_create_mask, lr_edit_mask and lr_delete_mask each make one pass [stated: Jim,
// 2026-10-03, "Inside sessions (Recommended)", "Own pass (Recommended)"], except an lr_edit_mask that only
// renames (renameMask below: no pass). A mask pass:
//   - counts against max_passes like a step, may follow convergence (it never sets it and clears it),
//     and in approve_each_pass mode waits for the approval of the pass before (approval.ts);
//   - reads the table, applies the operation to a copy (params\mask-ops.ts), renders the photo as it
//     is if its last render no longer shows it (io.ts fresh), reads the table again and stops with
//     MASKS_CHANGED, nothing written, when it changed in between [inference: one bridge round trip
//     still separates that read from the write; a check inside the plugin's gate would close it];
//   - writes the whole table as one History step "AVG <id> pass n/N mask <op>", checks the read-back,
//     makes an AI mask, or an AI part added to a mask (mask-parts.ts, issue #131), compute (ai-masks.ts),
//     renders and measures;
//   - is undone ("… clip revert" / "… region revert": the table before it, written back) when clipping
//     goes over a limit the photo was within, or a preserved region drifts. No correction moves the
//     global sliders for a mask. The undo is written only while the table is still what the pass
//     left; otherwise the breach is reported `unmet`.
// Geometry and points are given and shown in the preview's frame, mapped through the photo's crop as read in
// the same call (crop.ts, params\crop-frame.ts; issue #179); a mask mostly outside the crop warns.
// Variants mode: masks only on the pick (MASKS_AFTER_PICK before it). [handle: tests\session-masks.test.ts,
// tests\session-ai-masks.test.ts, against the Lightroom sim; in Lightroom [unverified] until Jim's
// mask tools check.]

import { pluginVersionAtLeast } from "../bridge/index.js";
import type { GuardrailAction, MaskPassEntry } from "../log/index.js";
import { ToolError, toToolError } from "../mcp/errors.js";
import { deltaMetrics, sampleColor, summarize as metricsOf } from "../metrics/index.js";
import {
  AI_KINDS,
  KIND_LABELS,
  LOCAL_PARAMS,
  MASK_TABLE_KEY,
  applyOp,
  depthMapMissing,
  firstComponent,
  isAiKind,
  outsideWarnings,
  pointOf,
  precheck,
  readTable,
  storedSliders,
  summarize,
  tableInfo,
  uncaptured,
  withCopiedSample,
  type Correction,
  type CreateOp,
  type CropFrame,
  type Lab,
  type MaskKind,
  type MaskOp,
  type OpResult,
  type SdkSettings,
} from "../params/index.js";
import { makeAiMask, type AiResult } from "./ai-masks.js";
import { checkAiPartPlugin, makeAiPart } from "./mask-parts.js";
import { awaitApproval } from "./approval.js";
import { frameFor, frameOf } from "./crop.js";
import { clipBreach, regionDrift, type Breach } from "./guardrail.js";
import { brief, failed, fresh, historyName, image, ms, readSdk, recordPass, render, writeTable } from "./io.js";
import { aiLog, passJson, type Done } from "./mask-result.js";
import { convergedByRegions } from "./plan.js";
import { checkReady, focus, resolveTarget } from "./targets.js";
import type { CreateMaskArgs, DeleteMaskArgs, EditMaskArgs, ListMasksArgs, Rendered, ReturnImage, Session, SessionContext, SessionOutput, Target, TargetId } from "./types.js";

/**
 * The plugin the mask tools need: update_ai_settings answers at once from its own task, with probe_write_gate
 * (0.14.0, plugin\LrC-AVG.lrplugin\Masks.lua), and refuses writes while an AI mask computes, with a restart
 * told in hello (0.16.0, Pending.lua, Bridge.lua; D16).
 */
export const MASKS_PLUGIN = "0.16.0";

type PassArgs = { session_id: string; target?: TargetId | undefined; rationale: string; return_image?: ReturnImage | undefined };

const sliderRanges = (): Record<string, [number, number]> => Object.fromEntries([...LOCAL_PARAMS].map(([k, p]) => [k, [p.min, p.max]]));

/** The photo's masks as the tools show them: geometry in the preview's frame (issue #179, crop.ts). */
const summaries = (sdk: SdkSettings, frame: CropFrame) => readTable(sdk).map((e) => summarize(e, frame));

/** lr_list_masks: the photo's masks, no pass. */
export async function listMasks(ctx: SessionContext, s: Session, args: ListMasksArgs): Promise<SessionOutput> {
  const t = resolveTarget(s, args.target, "read");
  s.work = { target: t, pass: null };
  await focus(ctx, s, t);
  const { sdk } = await readSdk(ctx, s, t);
  const masks = summaries(sdk, await frameOf(ctx, s, t, sdk));
  return {
    json: { ok: true, session_id: s.id, target: t.id, pass: `${t.passes}/${s.maxPasses}`, count: masks.length, masks, local_sliders: sliderRanges() },
    log: { session_id: s.id, target: t.id, count: masks.length },
  };
}

export const createMask = (ctx: SessionContext, s: Session, a: CreateMaskArgs): Promise<SessionOutput> =>
  maskPass(ctx, s, a, { op: "create", kind: a.kind, name: a.name, geometry: a.geometry, point: a.point, sliders: a.sliders, copy_sample_from: a.copy_sample_from });
export const editMask = (ctx: SessionContext, s: Session, a: EditMaskArgs): Promise<SessionOutput> =>
  renameOnly(a) ? renameMask(ctx, s, a) : maskPass(ctx, s, a, { op: "edit", mask_id: a.mask_id, name: a.name, active: a.active, inverted: a.inverted, geometry: a.geometry, sliders: a.sliders, combine: a.combine, part: a.part, remove_part: a.remove_part, copy: a.copy, point_colors: a.point_colors });
export const deleteMask = (ctx: SessionContext, s: Session, a: DeleteMaskArgs): Promise<SessionOutput> => maskPass(ctx, s, a, { op: "delete", mask_id: a.mask_id });

/** The photo a mask pass works on, once the plugin, the pick and the pass cap (unless `cap` is false: a rename) allow it. */
function maskTarget(ctx: SessionContext, s: Session, requested: TargetId | undefined, cap = true): Target {
  if (s.mode === "variants") {
    checkReady(s);
    if (!s.picked) throw new ToolError("MASKS_AFTER_PICK", "Masks are made on the pick: let the user pick a copy (lr_select_variant) first; the copies before the pick take one lr_step each.", false, { session_id: s.id });
  }
  const t = resolveTarget(s, requested, "write");
  const version = ctx.deps.client.hello()?.plugin_version;
  if (version !== undefined && !pluginVersionAtLeast(version, MASKS_PLUGIN)) {
    throw new ToolError("PLUGIN_TOO_OLD", `The mask tools need the LrC-AVG plugin ${MASKS_PLUGIN} or later; Lightroom runs ${version}. Restart Lightroom so it loads the current plugin.`, false);
  }
  if (cap && (t.endReason === "cap_reached" || t.passes >= s.maxPasses)) {
    throw new ToolError("CAP_REACHED", `All ${s.maxPasses} passes are used, and each mask change is a pass. Call lr_end_session; next time raise max_passes at lr_begin_session when masks are planned.`, false, { session_id: s.id });
  }
  return t;
}

const TOOL = { create: "lr_create_mask", edit: "lr_edit_mask", delete: "lr_delete_mask" } as const;

/**
 * An edit of a mask the captures did not round-trip is refused (a mask of several parts unless its form is
 * verified, params\mask-combine.ts uncaptured; issue #131). The other entries are carried: applyOp
 * copies them unchanged and writeTable checks the read-back (issue #121): Lightroom read five hand-made
 * masks back unchanged twice beside a new radial [handle: docs\reports\phase8.5\mask-carry\
 * mask_carry_2026-10-11T22-37-39-161Z.json `diff_lines`, commit 4cd95aa]. A create checks nothing else; a
 * delete of such a mask writes none of its fields [inference] and is allowed [stated: Jim, 2026-10-11, "Allow"].
 */
function refuseUncaptured(s: Session, entries: readonly Correction[], op: MaskOp): void {
  if (op.op !== "edit") return;
  const odd = uncaptured(entries.filter((e) => summarize(e).id === op.mask_id));
  if (!odd) return;
  throw new ToolError(
    "MASKS_UNCAPTURED_KIND",
    `Nothing was written: the mask the call names, "${odd.name}", is one the mask tools cannot write back safely (${odd.why}), so they do not edit it; it can be deleted (lr_delete_mask). The user can edit it in Lightroom. The pass is not used.`,
    false,
    { session_id: s.id, mask: odd.name, why: odd.why },
  );
}

const masksChanged = (s: Session): ToolError =>
  new ToolError("MASKS_CHANGED", "The photo's masks changed in Lightroom while this pass prepared its change; nothing was written and the pass is not used. Call lr_list_masks, then try again.", true, { session_id: s.id });

const sameTable = (a: readonly Correction[], b: readonly Correction[]): boolean =>
  tableInfo({ [MASK_TABLE_KEY]: a }).fingerprint === tableInfo({ [MASK_TABLE_KEY]: b }).fingerprint;

/** An lr_edit_mask that gives a new name and no other change (target, rationale and return_image aside). */
const renameOnly = (a: EditMaskArgs): a is EditMaskArgs & { name: string } =>
  a.name !== undefined && [a.active, a.inverted, a.geometry, a.sliders, a.combine, a.part, a.remove_part, a.copy, a.point_colors].every((f) => f === undefined);

/**
 * A rename alone is not a pass (engine 0.35.0) [stated: Jim, 2026-10-16, handover "name-only lr_edit_mask does not consume a
 * pass"]: a name does not change pixels [inference], so there is no approval wait, render or guardrail check,
 * and it works at the pass cap. It writes the table as one History step with the current pass number
 * ("AVG <id> pass n/N mask rename"). Only the tool log (the call's args) and Lightroom's History record it: the
 * session log has no entry for it, and the recipe carries a mask count, no names (end.ts). The last render
 * still stands for the photo, so its mask fingerprint moves to the renamed table (io.ts fresh would render
 * again otherwise). Variants mode: on the pick only, as for a pass.
 */
async function renameMask(ctx: SessionContext, s: Session, a: EditMaskArgs & { name: string }): Promise<SessionOutput> {
  const started = performance.now();
  const t = maskTarget(ctx, s, a.target, false);
  const op: MaskOp = { op: "edit", mask_id: a.mask_id, name: a.name };
  s.work = { target: t, pass: null, note: "Renaming a mask" };
  await focus(ctx, s, t);
  const first = await readSdk(ctx, s, t);
  const before = readTable(first.sdk);
  refuseUncaptured(s, before, op);
  const frame = await frameOf(ctx, s, t, first.sdk);
  const plan = applyOp(before, op, frame); // MaskError: nothing written
  if (sameTable(before, plan.entries)) throw new ToolError("NO_CHANGE", "Nothing was written: the mask already has this name. A rename uses no pass.", false, { session_id: s.id });
  const name = historyName(s, t, t.passes, "mask rename");
  let sdk: SdkSettings;
  try {
    sdk = await writeTable(ctx, s, t, plan.entries, name, false);
  } catch (err) {
    throw failed(ctx, s, `mask rename (pass ${t.passes})`, err);
  }
  if (t.last?.masks === first.view.masks.fingerprint) t.last = { ...t.last, masks: ctx.deps.map.fromSdk(sdk).masks.fingerprint };
  const masks = summaries(sdk, frame);
  const mask = masks.find((m) => m.id === plan.id) ?? plan.after ?? plan.before;
  return {
    json: { ok: true, session_id: s.id, target: t.id, pass: `${t.passes}/${s.maxPasses}`, pass_used: false, op: "rename", mask, masks, history_names: [name], passes_left: s.maxPasses - t.passes, timings: { total_ms: ms(started) } },
    log: { session_id: s.id, op: "rename", mask_id: plan.id, history_names: [name] },
  };
}

async function maskPass(ctx: SessionContext, s: Session, args: PassArgs, op: MaskOp): Promise<SessionOutput> {
  const started = performance.now();
  const t = maskTarget(ctx, s, args.target);
  precheck(op); // MaskError: nothing written, before any wait
  const n = t.passes + 1;
  const approval = await awaitApproval(ctx, s, t, TOOL[op.op]);
  const passStarted = ctx.now().toISOString();
  s.work = { target: t, pass: n, note: op.op === "create" ? `New mask: ${KIND_LABELS[op.kind as MaskKind] ?? op.kind}` : op.op === "edit" ? "Changing a mask" : "Deleting a mask" };
  await focus(ctx, s, t);
  const first = await readSdk(ctx, s, t);
  const before = readTable(first.sdk);
  refuseUncaptured(s, before, op);
  const frame = await frameOf(ctx, s, t, first.sdk);
  if (op.op === "create" && op.copy_sample_from) op = await copySample(ctx, s, t, op, { entries: before, frame });
  let plan = applyOp(before, op, frame); // MaskError: nothing written
  if (plan.ai) checkAiPartPlugin(ctx); // issue #131: before the write
  if (sameTable(before, plan.entries)) throw new ToolError("NO_CHANGE", "Nothing was written: the mask already is as asked. The pass is not used.", false, { session_id: s.id });
  let baseline: Rendered;
  try {
    baseline = (await fresh(ctx, s, t, first.view)).last;
  } catch (err) {
    throw failed(ctx, s, `mask pass ${n} (render before the change)`, err);
  }
  if ((await readSdk(ctx, s, t)).view.masks.fingerprint !== first.view.masks.fingerprint) throw masksChanged(s);
  // A colour range without a given or copied sample takes the preview's sRGB at its point (issue #190) where Lightroom
  // stores its own l, a, b: [unverified] until `npm run masks:verify` (issue #210, params\mask-range.ts).
  if (op.op === "create" && op.kind === "color_range" && op.point && !op.geometry?.sample) plan = applyOp(before, { ...op, geometry: { ...op.geometry, sample: asLab(await sampleColor(baseline.jpeg, op.point)) } }, frame);
  try {
    const done = await applyPlan(ctx, s, t, n, op, plan, before, baseline, frame);
    t.passes = n;
    t.endReason = n >= s.maxPasses ? "cap_reached" : null; // never "converged": a mask pass may follow convergence
    const delta = deltaMetrics(baseline.metrics, done.rendered.metrics);
    const converged = !done.undone && convergedByRegions(delta); // a signal only (issue #130 item 4)
    const masks = summaries(done.sdk, frame);
    const after = masks.find((m) => m.id === done.id) ?? null;
    const mask: MaskPassEntry = { op: op.op, id: done.id, name: (after ?? plan.before ?? plan.after)?.name ?? "", kind: plan.kind, before: plan.before, after, ...(done.ai ? { ai: aiLog(done.ai) } : {}) };
    const warnings = op.op === "delete" || done.undone ? [] : outsideWarnings(frame, after); // issue #179
    recordPass(s, {
      n, kind: "mask", target: t.id, started: passStarted, duration_ms: ms(started), history_names: done.historyNames, rationale: args.rationale,
      requested: { ...op }, changes: [], clamped: [], refused: [], unchanged: [], settings_before: first.view.settings, settings_after: done.view.settings,
      metrics_before: metricsOf(baseline.metrics), metrics_after: metricsOf(done.rendered.metrics), delta_metrics: delta, preview_hash: done.rendered.hash,
      preview_source: "export", guardrail_actions: done.actions, converged_by_metrics: converged, ...(approval ? { approval } : {}), mask, ...(warnings.length > 0 ? { warnings } : {}),
    });
    const json = passJson(s, t, n, op, { mask, masks, done, delta, converged, started, warnings });
    const img = await image(s, args.return_image ?? "after", baseline, done.rendered, `pass ${n - 1}`, `pass ${n}`);
    return {
      json: { ...json, ...(approval ? { approval } : {}) },
      ...(img ? { image: img } : {}),
      log: { session_id: s.id, pass: json["pass"], op: op.op, mask_id: done.id, kind: plan.kind, history_names: done.historyNames, metrics: brief(done.rendered.metrics), ...(done.ai ? { ai: aiLog(done.ai) } : {}), ...(done.undone ? { undone: done.undone.limit } : {}), ...(warnings.length > 0 ? { warnings } : {}) },
    };
  } catch (err) {
    throw failed(ctx, s, `mask pass ${n} (${op.op})`, err);
  }
}

/** The preview's sRGB, written where Lightroom keeps its l, a, b [unverified] (issue #210). */
const asLab = ([l, a, b]: [number, number, number]): Lab => ({ l, a, b });

/**
 * A create's copy_sample_from resolved from the colour range it names, on this photo (`here`) or on its `target`.
 * Another target is read by photo_uuid, which does not need it selected (Develop.lua target(): only target_uuid is
 * checked against the selection, plugin\LrC-AVG.lrplugin\Develop.lua:55-73); maskPass has just selected `t`
 * [handle: tests\session-masks-copy.test.ts].
 */
async function copySample(ctx: SessionContext, s: Session, t: Target, op: CreateOp, here: { entries: Correction[]; frame: CropFrame }): Promise<CreateOp> {
  const src = op.copy_sample_from?.target === undefined ? t : resolveTarget(s, op.copy_sample_from.target as TargetId, "read");
  if (src === t) return withCopiedSample(op, here);
  const sdk = (await ctx.deps.client.request("get_settings", { photo_uuid: src.uuid })).settings;
  const frame = await frameFor(sdk, () => ctx.deps.client.request("get_context", { photo_uuid: src.uuid }));
  return withCopiedSample(op, { entries: readTable(sdk), frame });
}

/** Write the table, make an AI mask compute, render, and undo the pass when it breaches a limit. */
async function applyPlan(ctx: SessionContext, s: Session, t: Target, n: number, op: MaskOp, plan: OpResult, before: Correction[], baseline: Rendered, frame: CropFrame): Promise<Done> {
  const historyNames: string[] = [];
  const name = historyName(s, t, n, `mask ${op.op}`);
  let sdk = await writeTable(ctx, s, t, plan.entries, name, op.op === "delete");
  historyNames.push(name);
  if (op.op === "create" && plan.kind === "depth_range" && depthMapMissing(readTable(sdk), plan.id)) {
    const back = historyName(s, t, n, "mask depth revert");
    await writeTable(ctx, s, t, before, back, true);
    throw new ToolError("DEPTH_MAP_MISSING", `This photo has no depth map (Lightroom read the depth range back without its depth sample), so a depth range selects nothing; it was taken out again ("${back}") and the pass is not used. Depth ranges work on photos that carry depth data, such as iPhone Portrait HEIC files.`, false, { session_id: s.id });
  }
  let id = plan.id;
  let ai: AiResult | null = null;
  if (op.op === "create" && isAiKind(plan.kind)) {
    const point = AI_KINDS[plan.kind].point ? pointOf(firstComponent(plan.entries, id)) : null;
    ai = await makeAiMask(ctx, s, { t, n, kind: plan.kind, before, id, name: plan.after?.name ?? "", stored: storedSliders(op.sliders ?? {}), historyNames, attempts: new Set([id]), point, frame });
    ({ sdk, id } = ai);
  } else if (plan.ai) {
    ai = await makeAiPart(ctx, s, { t, n, kind: plan.ai, before, id, name: plan.after?.name ?? "", stored: {}, historyNames, attempts: new Set(), point: null, part: true }); // issue #131
    ({ sdk } = ai);
  }
  let view = ctx.deps.map.fromSdk(sdk);
  let rendered = await render(ctx, s, t, view);
  const drift = regionDrift(s, t, rendered.metrics);
  const breach: Breach | null = clipBreach(s, baseline.metrics, rendered.metrics) ?? (drift ? { limit: "region", reason: drift } : null);
  const actions: GuardrailAction[] = [];
  if (breach) {
    const now = await readSdk(ctx, s, t);
    if (now.view.masks.fingerprint !== view.masks.fingerprint) {
      actions.push({ kind: "unmet", limit: breach.limit, reason: `${breach.reason}; the masks changed in Lightroom after this pass wrote them, so it was not undone`, history_name: null, changes: {}, metrics_after: metricsOf(rendered.metrics) });
    } else {
      const undoName = historyName(s, t, n, breach.limit === "region" ? "region revert" : "clip revert");
      try {
        sdk = await writeTable(ctx, s, t, before, undoName, true); // an undo: the table before the pass (an empty one is [unverified])
        historyNames.push(undoName);
        view = ctx.deps.map.fromSdk(sdk);
        rendered = await render(ctx, s, t, view);
        actions.push({ kind: "reverted", limit: breach.limit, reason: breach.reason, history_name: undoName, changes: {}, metrics_after: metricsOf(rendered.metrics) });
      } catch (err) {
        if (!["WRITE_NOT_TAKEN", "FEATURE_UNAVAILABLE"].includes(toToolError(err).code)) throw err;
        historyNames.push(undoName);
        sdk = (await readSdk(ctx, s, t)).sdk;
        view = ctx.deps.map.fromSdk(sdk);
        actions.push({ kind: "unmet", limit: breach.limit, reason: `${breach.reason}; the undo ("${undoName}") did not take (${toToolError(err).message}), so the mask change stays`, history_name: null, changes: {}, metrics_after: metricsOf(rendered.metrics) });
      }
    }
  }
  const undone = actions.some((a) => a.kind === "reverted") ? breach : null;
  return { sdk, view, rendered, actions, historyNames, id, ai, undone };
}

