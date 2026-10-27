// The sharpness advisory (issue #216): a step that changed a sharpening or noise-reduction slider and
// left the frame's sharpness (metrics\sharpness.ts) more than SHARPNESS_DROP_PCT % lower gets a guardrail
// action of kind "advisory", limit "sharpness", as the single-channel clipping advisory does
// (guardrail.ts advisory()): nothing is moved or refused, the pass stands, and the reason asks for a
// look at a crop. Noise reduction lowers the Laplacian variance by design (noise is fine detail to it)
// [inference], so the advisory is a prompt to check, not a verdict.

import type { GuardrailAction } from "../log/index.js";
import { summarize, type Metrics } from "../metrics/index.js";
import type { Change } from "./plan.js";

/**
 * The drop that raises the advisory, in % of the sharpness before the pass [inference: provisional,
 * chosen for issue #216 without a measurement; to be tuned from Jim's runs, docs\reports\phase11\METRICS-PARITY.md].
 */
export const SHARPNESS_DROP_PCT = 15;
const DETAIL = /^(sharpening|noise)\./;

export function sharpnessAdvisory(changes: readonly Change[], before: Metrics, after: Metrics): GuardrailAction[] {
  const touched = changes.filter((c) => DETAIL.test(c.name)).map((c) => c.name);
  const [was, now] = [before.sharpness, after.sharpness];
  if (touched.length === 0 || was === null || now === null || was <= 0) return [];
  const drop = ((was - now) / was) * 100;
  if (drop <= SHARPNESS_DROP_PCT) return [];
  const reason =
    `sharpness fell ${Math.round(drop)} % (${was} to ${now}, over the advisory's ${SHARPNESS_DROP_PCT} %) in a pass that changed ${touched.join(", ")}; ` +
    "look at a crop (lr_get_preview with region) before going on; nothing was moved";
  return [{ kind: "advisory", limit: "sharpness", reason, history_name: null, changes: {}, metrics_after: summarize(after) }];
}
