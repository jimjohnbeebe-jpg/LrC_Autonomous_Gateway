// A mask pass that goes through LrDevelopController (GitHub issue #217 row 3 and the Point Color fix): lr_edit_mask
// curves and point_colors, which the mask table does not carry [handle: %TEMP%\LrC-AVG\masks-verify\
// mask_verify_2026-10-28T11-59-26-227Z.json steps point_color and curve_capture]. masks.ts maskPass runs it in place of
// applyPlan: the plugin's mask_controller (plugin\LrC-AVG.lrplugin\MaskControl.lua) selects the mask on the photo open
// in Develop, writes, confirms each value through getValue and puts back what it wrote when one fails; then the photo is
// read and rendered, and a clipping or region breach is undone by a second mask_controller writing the values read
// before. Lightroom names the History steps of these writes itself, so `history_names` stays empty [inference:
// setValue and the swatch calls take no name, LrDevelopController.html]. lr_list_masks `live_mask_id` reads the same
// values without writing. In Lightroom [unverified] until `npm run masks:parity` (docs\reports\phase11\MASK-CONTROLLER.md).

import { isDeepStrictEqual } from "node:util";
import { pluginVersionAtLeast, type CommandPayloads } from "../bridge/index.js";
import type { GuardrailAction } from "../log/index.js";
import { ToolError, toToolError } from "../mcp/errors.js";
import { summarize as metricsOf } from "../metrics/index.js";
import { CONTROLLER_PARAMS, curveRestore, curveWrites, curvesOf, swatchRequest, swatchRestore, swatchesOf, type EditOp } from "../params/index.js";
import { clipBreach, regionDrift, type Breach } from "./guardrail.js";
import { bridge, checkAbort, readSdk, render } from "./io.js";
import type { Done } from "./mask-result.js";
import { WRITE_TIMEOUT_MS } from "./timeouts.js";
import type { Rendered, Session, SessionContext, Target } from "./types.js";

/** The plugin with mask_controller (MaskControl.lua). */
export const CONTROLLER_PLUGIN = "1.7.0";

type Values = Record<string, unknown>;
type Payload = Omit<CommandPayloads["mask_controller"], "target_uuid">;

/** A mask's curves (pairs) and Point Color swatches (the tools' names) as Lightroom's Develop module gives them. */
export const liveState = (values: Values) => ({ curves: curvesOf(values), point_colors: swatchesOf(values) });

export function checkControllerPlugin(ctx: SessionContext): void {
  const version = ctx.deps.client.hello()?.plugin_version;
  if (version === undefined || pluginVersionAtLeast(version, CONTROLLER_PLUGIN)) return;
  throw new ToolError("PLUGIN_TOO_OLD", `Mask curves and Point Color need the LrC-AVG plugin ${CONTROLLER_PLUGIN} or later; Lightroom runs ${version}. Nothing was written and the pass is not used. Restart Lightroom so it loads the current plugin.`, false);
}

function send(ctx: SessionContext, s: Session, t: Target, payload: Payload) {
  checkAbort(s);
  return bridge(s, t, () => ctx.deps.client.request("mask_controller", { target_uuid: t.uuid, ...payload, read: CONTROLLER_PARAMS }, { timeoutMs: WRITE_TIMEOUT_MS }));
}

/** lr_list_masks live_mask_id: that mask's values, read on the photo open in Develop; nothing written. */
export async function readLive(ctx: SessionContext, s: Session, t: Target, maskId: string) {
  checkControllerPlugin(ctx);
  const r = await send(ctx, s, t, { mask_id: maskId });
  return { mask_id: maskId, ...liveState(r.after) };
}

/** Write `op`'s curves and swatch change, render, and undo them when the render breaches a limit. */
export async function applyController(ctx: SessionContext, s: Session, t: Target, op: EditOp, baseline: Rendered): Promise<Done> {
  const r = await send(ctx, s, t, { mask_id: op.mask_id, ...(op.curves ? { curves: curveWrites(op.curves) } : {}), ...(op.point_colors ? { swatches: swatchRequest(op.point_colors) } : {}) });
  if (r.written.length === 0 || isDeepStrictEqual(r.before, r.after)) {
    throw new ToolError("NO_CHANGE", "Nothing was written: the mask's curves and Point Color already are as asked. The pass is not used.", false, { session_id: s.id });
  }
  let { sdk, view } = await readSdk(ctx, s, t);
  let rendered = await render(ctx, s, t, view);
  const drift = regionDrift(s, t, rendered.metrics);
  const breach: Breach | null = clipBreach(s, baseline.metrics, rendered.metrics) ?? (drift ? { limit: "region", reason: drift } : null);
  const actions: GuardrailAction[] = [];
  let live = r.after;
  if (breach) {
    try {
      const back = await send(ctx, s, t, { mask_id: op.mask_id, curves: curveRestore(r.before, r.written), ...(op.point_colors ? { swatches: swatchRestore(r.before) } : {}) });
      ({ sdk, view } = await readSdk(ctx, s, t));
      rendered = await render(ctx, s, t, view);
      live = back.after;
      actions.push({ kind: "reverted", limit: breach.limit, reason: breach.reason, history_name: null, changes: {}, metrics_after: metricsOf(rendered.metrics) });
    } catch (err) {
      const e = toToolError(err);
      if (!["WRITE_NOT_TAKEN", "INVALID_ARGUMENTS"].includes(e.code)) throw err;
      actions.push({ kind: "unmet", limit: breach.limit, reason: `${breach.reason}; the undo through Lightroom's Develop module did not take (${e.message}), so the mask change stays`, history_name: null, changes: {}, metrics_after: metricsOf(rendered.metrics) });
    }
  }
  const undone = actions.some((a) => a.kind === "reverted") ? breach : null;
  return { sdk, view, rendered, actions, historyNames: [], id: op.mask_id, ai: null, undone, controller: { ...liveState(live), settled: r.settled } };
}
