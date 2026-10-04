// The mask tools inside an editing session (GitHub issue #59, PR C step 2): lr_list_masks reads the
// photo's masks; lr_create_mask, lr_edit_mask and lr_delete_mask each make one pass [stated: Jim,
// 2026-10-03, "Inside sessions (Recommended)", "Own pass (Recommended)"]. A mask pass:
//   - counts against max_passes like a step, may follow convergence (it never sets it and clears it),
//     and in approve_each_pass mode waits for the approval of the pass before (approval.ts);
//   - reads the table, applies the operation to a copy (params\mask-ops.ts), renders the photo as it
//     is if its last render no longer shows it (io.ts fresh), reads the table again and stops with
//     MASKS_CHANGED, nothing written, when it changed in between [inference: one bridge round trip
//     still separates that read from the write; a check inside the plugin's gate would close it];
//   - writes the whole table as one History step "AVG <id> pass n/N mask <op>", checks the read-back,
//     makes an AI mask compute (ai-masks.ts), renders and measures;
//   - is undone ("… clip revert" / "… region revert": the table before it, written back) when clipping
//     goes over a limit the photo was within, or a preserved region drifts. No correction moves the
//     global sliders for a mask. The undo is written only while the table is still what the pass
//     left; otherwise the breach is reported `unmet`.
// Variants mode: masks only on the pick (MASKS_AFTER_PICK before it). [handle: tests\session-masks.test.ts,
// tests\session-ai-masks.test.ts, against the Lightroom sim; in Lightroom [unverified] until Jim's
// mask tools check.]

import { pluginVersionAtLeast } from "../bridge/index.js";
import type { GuardrailAction, MaskPassEntry } from "../log/index.js";
import { ToolError, toToolError } from "../mcp/errors.js";
import { deltaMetrics, summarize as metricsOf } from "../metrics/index.js";
import {
  AI_KINDS,
  KIND_LABELS,
  LOCAL_PARAMS,
  MASK_TABLE_KEY,
  applyOp,
  firstComponent,
  isAiKind,
  pointOf,
  precheck,
  readTable,
  storedSliders,
  summarize,
  tableInfo,
  uncaptured,
  type Correction,
  type FromSdkResult,
  type MaskKind,
  type MaskOp,
  type MaskSummary,
  type OpResult,
  type SdkSettings,
} from "../params/index.js";
import { makeAiMask, type AiResult } from "./ai-masks.js";
import { awaitApproval } from "./approval.js";
import { clipBreach, regionDrift, type Breach } from "./guardrail.js";
import { brief, describe, failed, fresh, historyName, image, ms, readSdk, recordPass, render, writeTable } from "./io.js";
import { checkReady, focus, resolveTarget } from "./targets.js";
import type { CreateMaskArgs, DeleteMaskArgs, EditMaskArgs, ListMasksArgs, Rendered, ReturnImage, Session, SessionContext, SessionOutput, Target, TargetId } from "./types.js";

/** The plugin whose update_ai_settings answers at once from its own task, with probe_write_gate (0.14.0, plugin\LrC-AVG.lrplugin\Masks.lua); the mask tools need it. */
export const MASKS_PLUGIN = "0.14.0";

type PassArgs = { session_id: string; target?: TargetId | undefined; rationale: string; return_image?: ReturnImage | undefined };
/** What a mask pass wrote and measured. */
type Done = { sdk: SdkSettings; view: FromSdkResult; rendered: Rendered; actions: GuardrailAction[]; historyNames: string[]; id: string; ai: AiResult | null; undone: Breach | null };

const sliderRanges = (): Record<string, [number, number]> => Object.fromEntries([...LOCAL_PARAMS].map(([k, p]) => [k, [p.min, p.max]]));

/** lr_list_masks: the photo's masks, no pass. */
export async function listMasks(ctx: SessionContext, s: Session, args: ListMasksArgs): Promise<SessionOutput> {
  const t = resolveTarget(s, args.target, "read");
  s.work = { target: t, pass: null };
  await focus(ctx, s, t);
  const masks = readTable((await readSdk(ctx, s, t)).sdk).map(summarize);
  return {
    json: { ok: true, session_id: s.id, target: t.id, pass: `${t.passes}/${s.maxPasses}`, count: masks.length, masks, local_sliders: sliderRanges() },
    log: { session_id: s.id, target: t.id, count: masks.length },
  };
}

export const createMask = (ctx: SessionContext, s: Session, a: CreateMaskArgs): Promise<SessionOutput> =>
  maskPass(ctx, s, a, { op: "create", kind: a.kind, name: a.name, geometry: a.geometry, point: a.point, sliders: a.sliders });
export const editMask = (ctx: SessionContext, s: Session, a: EditMaskArgs): Promise<SessionOutput> =>
  maskPass(ctx, s, a, { op: "edit", mask_id: a.mask_id, name: a.name, active: a.active, inverted: a.inverted, geometry: a.geometry, sliders: a.sliders, combine: a.combine });
export const deleteMask = (ctx: SessionContext, s: Session, a: DeleteMaskArgs): Promise<SessionOutput> => maskPass(ctx, s, a, { op: "delete", mask_id: a.mask_id });

/** The photo a mask pass works on, once the plugin, the pick and the pass cap allow it. */
function maskTarget(ctx: SessionContext, s: Session, requested: TargetId | undefined): Target {
  if (s.mode === "variants") {
    checkReady(s);
    if (!s.picked) throw new ToolError("MASKS_AFTER_PICK", "Masks are made on the pick: let the user pick a copy (lr_select_variant) first; the copies before the pick take one lr_step each.", false, { session_id: s.id });
  }
  const t = resolveTarget(s, requested, "write");
  const version = ctx.deps.client.hello()?.plugin_version;
  if (version !== undefined && !pluginVersionAtLeast(version, MASKS_PLUGIN)) {
    throw new ToolError("PLUGIN_TOO_OLD", `The mask tools need the LrC-AVG plugin ${MASKS_PLUGIN} or later; Lightroom runs ${version}. Restart Lightroom so it loads the current plugin.`, false);
  }
  if (t.endReason === "cap_reached" || t.passes >= s.maxPasses) {
    throw new ToolError("CAP_REACHED", `All ${s.maxPasses} passes are used, and each mask change is a pass. Call lr_end_session; next time raise max_passes at lr_begin_session when masks are planned.`, false, { session_id: s.id });
  }
  return t;
}

const TOOL = { create: "lr_create_mask", edit: "lr_edit_mask", delete: "lr_delete_mask" } as const;

/** The mask tools write the whole table: none writes while it holds a mask the captures did not round-trip. */
function refuseUncaptured(s: Session, entries: readonly Correction[]): void {
  const odd = uncaptured(entries);
  if (!odd) return;
  throw new ToolError(
    "MASKS_UNCAPTURED_KIND",
    `The photo has the mask "${odd.name}", which the mask tools cannot write back safely (${odd.why}). They write the photo's whole mask table, so they change no mask while it is there; the photo's masks are left untouched. lr_list_masks still lists them; the user can edit or remove that mask in Lightroom.`,
    false,
    { session_id: s.id, mask: odd.name, why: odd.why },
  );
}

const masksChanged = (s: Session): ToolError =>
  new ToolError("MASKS_CHANGED", "The photo's masks changed in Lightroom while this pass prepared its change; nothing was written and the pass is not used. Call lr_list_masks, then try again.", true, { session_id: s.id });

const sameTable = (a: readonly Correction[], b: readonly Correction[]): boolean =>
  tableInfo({ [MASK_TABLE_KEY]: a }).fingerprint === tableInfo({ [MASK_TABLE_KEY]: b }).fingerprint;

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
  refuseUncaptured(s, before);
  const plan = applyOp(before, op); // MaskError: nothing written
  if (sameTable(before, plan.entries)) throw new ToolError("NO_CHANGE", "Nothing was written: the mask already is as asked. The pass is not used.", false, { session_id: s.id });
  let baseline: Rendered;
  try {
    baseline = (await fresh(ctx, s, t, first.view)).last;
  } catch (err) {
    throw failed(ctx, s, `mask pass ${n} (render before the change)`, err);
  }
  if ((await readSdk(ctx, s, t)).view.masks.fingerprint !== first.view.masks.fingerprint) throw masksChanged(s);
  try {
    const done = await applyPlan(ctx, s, t, n, op, plan, before, baseline);
    t.passes = n;
    t.endReason = n >= s.maxPasses ? "cap_reached" : null; // a mask pass never converges, and may follow convergence
    const delta = deltaMetrics(baseline.metrics, done.rendered.metrics);
    const masks = readTable(done.sdk).map(summarize);
    const after = masks.find((m) => m.id === done.id) ?? null;
    const mask: MaskPassEntry = { op: op.op, id: done.id, name: (after ?? plan.before ?? plan.after)?.name ?? "", kind: plan.kind, before: plan.before, after, ...(done.ai ? { ai: aiLog(done.ai) } : {}) };
    recordPass(s, {
      n, kind: "mask", target: t.id, started: passStarted, duration_ms: ms(started), history_names: done.historyNames, rationale: args.rationale,
      requested: { ...op }, changes: [], clamped: [], refused: [], unchanged: [], settings_before: first.view.settings, settings_after: done.view.settings,
      metrics_before: metricsOf(baseline.metrics), metrics_after: metricsOf(done.rendered.metrics), delta_metrics: delta, preview_hash: done.rendered.hash,
      preview_source: "export", guardrail_actions: done.actions, converged_by_metrics: false, ...(approval ? { approval } : {}), mask,
    });
    const json = passJson(s, t, n, op, { mask, masks, done, delta, started });
    const img = await image(s, args.return_image ?? "after", baseline, done.rendered, `pass ${n - 1}`, `pass ${n}`);
    return {
      json: { ...json, ...(approval ? { approval } : {}) },
      ...(img ? { image: img } : {}),
      log: { session_id: s.id, pass: json["pass"], op: op.op, mask_id: done.id, kind: plan.kind, history_names: done.historyNames, metrics: brief(done.rendered.metrics), ...(done.ai ? { ai: aiLog(done.ai) } : {}), ...(done.undone ? { undone: done.undone.limit } : {}) },
    };
  } catch (err) {
    throw failed(ctx, s, `mask pass ${n} (${op.op})`, err);
  }
}

const aiLog = (ai: AiResult): NonNullable<MaskPassEntry["ai"]> => {
  const { sdk: _sdk, id: _id, ...rest } = ai;
  return rest;
};

/** Write the table, make an AI mask compute, render, and undo the pass when it breaches a limit. */
async function applyPlan(ctx: SessionContext, s: Session, t: Target, n: number, op: MaskOp, plan: OpResult, before: Correction[], baseline: Rendered): Promise<Done> {
  const historyNames: string[] = [];
  const name = historyName(s, t, n, `mask ${op.op}`);
  let sdk = await writeTable(ctx, s, t, plan.entries, name, op.op === "delete");
  historyNames.push(name);
  let id = plan.id;
  let ai: AiResult | null = null;
  if (op.op === "create" && isAiKind(plan.kind)) {
    const point = AI_KINDS[plan.kind].point ? pointOf(firstComponent(plan.entries, id)) : null;
    ai = await makeAiMask(ctx, s, { t, n, kind: plan.kind, before, id, name: plan.after?.name ?? "", stored: storedSliders(op.sliders ?? {}), historyNames, attempts: new Set([id]), point });
    ({ sdk, id } = ai);
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

type PassOut = { mask: MaskPassEntry; masks: MaskSummary[]; done: Done; delta: ReturnType<typeof deltaMetrics>; started: number };

function passJson(s: Session, t: Target, n: number, op: MaskOp, { mask, masks, done, delta, started }: PassOut): Record<string, unknown> {
  return {
    ok: true,
    session_id: s.id,
    target: t.id,
    pass: `${n}/${s.maxPasses}`,
    op: op.op,
    mask: mask.after ?? mask.before,
    ...(op.op === "delete" ? { deleted: !done.undone } : {}),
    masks,
    history_names: done.historyNames,
    guardrail_actions: done.actions,
    metrics: metricsOf(done.rendered.metrics),
    delta_metrics: delta,
    cap_reached: t.endReason === "cap_reached",
    passes_left: s.maxPasses - n,
    ...(done.undone ? { undone: { limit: done.undone.limit, reason: done.undone.reason, note: "the mask change was written, then undone: the masks are as before this pass" } } : {}),
    ...(done.ai ? { ai: { route: done.ai.route, ...(done.ai.route === "dc" ? { switched_to_develop: true, fallback: done.ai.fallback } : {}), ...(done.ai.instance !== undefined ? { instance: done.ai.instance, people: done.ai.people } : {}), ...(done.ai.probe ? { probe: done.ai.probe } : {}) } } : {}),
    ...describe(done.rendered),
    timings: { total_ms: ms(started) },
  };
}
