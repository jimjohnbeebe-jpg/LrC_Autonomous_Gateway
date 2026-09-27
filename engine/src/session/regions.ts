// lr_set_regions: region boxes measured on every render; `preserve` guards their hue and
// saturation (guardrail.ts regionDrift). No Lightroom call: the regions are measured on the last preview.

import { ToolError } from "../mcp/errors.js";
import { boxProblem, measureImage } from "../metrics/index.js";
import { saveLog } from "./io.js";
import { REGION_PRESERVE } from "./rules.js";
import { MAX_REGIONS, type RegionArgs, type RegionState, type Session, type SessionOutput } from "./types.js";

export async function setRegions(s: Session, args: RegionArgs): Promise<SessionOutput> {
  if (args.regions.length > MAX_REGIONS) throw new ToolError("INVALID_ARGUMENTS", `At most ${MAX_REGIONS} regions.`, false);
  const labels = new Set<string>();
  for (const r of args.regions) {
    const problem = boxProblem(r.box);
    if (problem) throw new ToolError("INVALID_ARGUMENTS", `Region "${r.label}": ${problem}.`, false);
    if (labels.has(r.label)) throw new ToolError("INVALID_ARGUMENTS", `Two regions are labelled "${r.label}"; labels must differ.`, false);
    labels.add(r.label);
  }
  if (!s.last) throw new ToolError("NO_PREVIEW_YET", "The session has no preview to measure the regions on yet.", true);
  const regions = args.regions.map((r) => ({ label: r.label, box: r.box }));
  const metrics = await measureImage(s.last.jpeg, regions);
  s.last = { ...s.last, metrics };
  s.regions = args.regions.map((r): RegionState => {
    const measured = metrics.regions.find((m) => m.label === r.label);
    const preserve = r.preserve === true;
    return {
      kind: r.kind,
      label: r.label,
      box: r.box,
      preserve,
      baseline: preserve && measured ? { hue_mean: measured.hue_mean, saturation_mean: measured.saturation_mean } : null,
    };
  });
  s.log.regions = s.regions.map((r) => ({ ...r, box: { ...r.box } }));
  saveLog(s);
  return {
    json: {
      ok: true,
      session_id: s.id,
      regions: metrics.regions,
      preserved: s.regions.filter((r) => r.preserve).map((r) => ({ label: r.label, baseline: r.baseline })),
      note:
        `Region metrics appear in every later metrics.regions[]. A preserved region's mean hue may drift at most ${REGION_PRESERVE.hueDegrees} degrees ` +
        `and its mean saturation ${REGION_PRESERVE.saturationPoints} points from the values measured now; a step that drifts further is undone.`,
    },
    log: { session_id: s.id, regions: s.regions.map((r) => ({ label: r.label, preserve: r.preserve })) },
  };
}
