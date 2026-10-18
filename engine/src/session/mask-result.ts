// The result of a mask pass (session\masks.ts maskPass), moved out of masks.ts for issue #179 (module size,
// rule 01). `warnings`: a mask mostly outside the preview (params\crop-share.ts).

import type { GuardrailAction, MaskPassEntry } from "../log/index.js";
import { summarize as metricsOf, type deltaMetrics } from "../metrics/index.js";
import type { FromSdkResult, MaskOp, MaskSummary, SdkSettings } from "../params/index.js";
import type { AiResult } from "./ai-masks.js";
import type { Breach } from "./guardrail.js";
import { describe, ms } from "./io.js";
import type { Rendered, Session, Target } from "./types.js";

/** What a mask pass wrote and measured. */
export type Done = { sdk: SdkSettings; view: FromSdkResult; rendered: Rendered; actions: GuardrailAction[]; historyNames: string[]; id: string; ai: AiResult | null; undone: Breach | null };

export const aiLog = (ai: AiResult): NonNullable<MaskPassEntry["ai"]> => {
  const { sdk: _sdk, id: _id, ...rest } = ai;
  return rest;
};

type PassOut = { mask: MaskPassEntry; masks: MaskSummary[]; done: Done; delta: ReturnType<typeof deltaMetrics>; converged: boolean; started: number; warnings: string[] };

export function passJson(s: Session, t: Target, n: number, op: MaskOp, { mask, masks, done, delta, converged, started, warnings }: PassOut): Record<string, unknown> {
  return {
    ok: true,
    session_id: s.id,
    target: t.id,
    pass: `${n}/${s.maxPasses}`,
    op: op.op,
    mask: mask.after ?? mask.before,
    ...(op.op === "delete" ? { deleted: !done.undone } : {}),
    masks,
    ...(warnings.length > 0 ? { warnings } : {}),
    history_names: done.historyNames,
    guardrail_actions: done.actions,
    metrics: metricsOf(done.rendered.metrics),
    delta_metrics: delta,
    converged_by_metrics: converged,
    cap_reached: t.endReason === "cap_reached",
    passes_left: s.maxPasses - n,
    ...(done.undone ? { undone: { limit: done.undone.limit, reason: done.undone.reason, note: "the mask change was written, then undone: the masks are as before this pass" } } : {}),
    ...(done.ai ? { ai: { route: done.ai.route, ...(done.ai.route === "dc" ? { switched_to_develop: true, fallback: done.ai.fallback } : {}), ...(done.ai.instance !== undefined ? { instance: done.ai.instance, people: done.ai.people } : {}), ...(done.ai.probe ? { probe: done.ai.probe } : {}) } } : {}),
    ...describe(done.rendered),
    timings: { total_ms: ms(started) },
  };
}
