// lr_set_regions: region boxes measured on every render; `preserve` guards their hue and
// saturation (guardrail.ts regionDrift). No Lightroom call: the regions are measured on the last
// preview of each photo the session edits (the master, or in Variants mode each copy), and a
// preserved region keeps a baseline per photo, since the copies look different.

import { ToolError } from "../mcp/errors.js";
import { boxProblem, measureImage, type Metrics } from "../metrics/index.js";
import { saveLog } from "./io.js";
import { REGION_PRESERVE } from "./rules.js";
import { MAX_REGIONS, type RegionArgs, type RegionBaseline, type RegionState, type Rendered, type Session, type SessionOutput, type Target, type TargetId } from "./types.js";

export async function setRegions(s: Session, args: RegionArgs): Promise<SessionOutput> {
  if (args.regions.length > MAX_REGIONS) throw new ToolError("INVALID_ARGUMENTS", `At most ${MAX_REGIONS} regions.`, false);
  const labels = new Set<string>();
  for (const r of args.regions) {
    const problem = boxProblem(r.box);
    if (problem) throw new ToolError("INVALID_ARGUMENTS", `Region "${r.label}": ${problem}.`, false);
    if (labels.has(r.label)) throw new ToolError("INVALID_ARGUMENTS", `Two regions are labelled "${r.label}"; labels must differ.`, false);
    labels.add(r.label);
  }
  const photos = (s.mode === "variants" ? s.variants : [s.master]).filter((t): t is Target & { last: Rendered } => t.last !== null);
  if (photos.length === 0) throw new ToolError("NO_PREVIEW_YET", "The session has no preview to measure the regions on yet.", true);
  const regions = args.regions.map((r) => ({ label: r.label, box: r.box }));
  const measured = new Map<TargetId, Metrics>();
  for (const t of photos) {
    const metrics = await measureImage(t.last.jpeg, regions);
    t.last = { ...t.last, metrics };
    measured.set(t.id, metrics);
  }
  s.regions = args.regions.map((r): RegionState => {
    const preserve = r.preserve === true;
    const baselines: Partial<Record<TargetId, RegionBaseline>> = {};
    if (preserve) {
      for (const [id, metrics] of measured) {
        const m = metrics.regions.find((x) => x.label === r.label);
        if (m) baselines[id] = { hue_mean: m.hue_mean, saturation_mean: m.saturation_mean };
      }
    }
    return { kind: r.kind, label: r.label, box: r.box, preserve, baselines };
  });
  saveLog(s);
  // The regions as measured on the photo the last call worked on (else the first measured).
  const shown = measured.has(s.active.id) ? s.active.id : (photos[0] as Target).id;
  const variants = s.mode === "variants";
  return {
    json: {
      ok: true,
      session_id: s.id,
      ...(variants ? { measured_on: shown, photos: [...measured.keys()] } : {}),
      regions: (measured.get(shown) as Metrics).regions,
      preserved: s.regions
        .filter((r) => r.preserve)
        .map((r) => ({ label: r.label, baseline: r.baselines[shown] ?? null, ...(variants ? { baselines: r.baselines } : {}) })),
      note:
        `Region metrics appear in every later metrics.regions[]. A preserved region's mean hue may drift at most ${REGION_PRESERVE.hueDegrees} degrees ` +
        `and its mean saturation ${REGION_PRESERVE.saturationPoints} points from the values measured now` +
        `${variants ? " on each copy" : ""}; a step that drifts further is undone.`,
    },
    log: { session_id: s.id, regions: s.regions.map((r) => ({ label: r.label, preserve: r.preserve })) },
  };
}
