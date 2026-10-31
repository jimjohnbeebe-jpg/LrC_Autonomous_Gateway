// Reference photos (Phase 10 row 8, PHASE10_PLAN "Third re-plan" R1 and R4): lr_begin_session's
// `references`, else the intent's, by catalog uuid and by collection name. Each reference is rendered at the
// session's preview size and measured once, at begin, before the snapshot; the set's range per key
// measure (metrics\reference-gap.ts) is kept, and every pass result reports where the photo lies against
// it. Reported only: nothing is steered toward it, and nothing is refused for it. A reference render is a
// read: export_preview with photo_uuid exports that photo, selected or not, and does not touch the
// selection [handle: plugin\LrC-AVG.lrplugin\Preview.lua:53 Develop.target, Develop.lua:46-55;
// engine\src\bridge\protocol.ts:78-81], the export lr_get_photo_stats makes (mcp\tools-stats.ts:65). That
// it changes nothing in Lightroom here is [unverified] until Jim's run of this row.

import { aggregate, referenceGap, type Metrics } from "../metrics/index.js";
import type { ReferenceSet, ReferenceSize, ReferenceSpec } from "./reference-types.js";
import type { Session, SessionContext } from "./types.js";

/** At most this many references are rendered, as the row 7+8 brief sets (uuids 1-8, a collection's first 8): each costs one export at begin, about 2.6 s at 1600 px [handle: docs\reports\phase0\S1.md]. */
export const MAX_REFERENCES = 8;

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** The uuids the spec names: its own, then the collection's, without repeats, at most MAX_REFERENCES. */
async function uuidsOf(ctx: SessionContext, spec: ReferenceSpec, warnings: string[]): Promise<string[]> {
  const uuids = [...(spec.uuids ?? [])];
  if (spec.collection !== undefined) {
    const find = ctx.deps.collectionPhotos;
    if (!find) warnings.push(`collection "${spec.collection}": this engine cannot read collections, so it was not used`);
    else {
      try {
        const found = await find(spec.collection, MAX_REFERENCES);
        uuids.push(...found.uuids);
        if (found.count > MAX_REFERENCES) warnings.push(`collection "${spec.collection}" holds ${found.count} photos; only its first ${MAX_REFERENCES} are used`);
      } catch (err) {
        warnings.push(`collection "${spec.collection}": ${message(err)}`);
      }
    }
  }
  const unique = [...new Set(uuids)];
  if (unique.length > MAX_REFERENCES) warnings.push(`${unique.length} references were named; only the first ${MAX_REFERENCES} are used`);
  return unique.slice(0, MAX_REFERENCES);
}

/** Render and measure the references; null when none were asked for. A reference that fails is left out with a warning. */
export async function loadReferences(ctx: SessionContext, spec: ReferenceSpec | undefined, source: ReferenceSet["source"], size: ReferenceSize): Promise<ReferenceSet | null> {
  if (!spec || (spec.uuids === undefined && spec.collection === undefined)) return null;
  const warnings: string[] = [];
  const uuids = await uuidsOf(ctx, spec, warnings);
  const render = ctx.deps.renderReference;
  if (!render && uuids.length > 0) warnings.push("this engine cannot render references, so none were measured");
  const measured: ReferenceSet["measured"] = [];
  for (const uuid of uuids) {
    if (!render) break;
    try {
      const preview = await render({ uuid, ...size });
      measured.push({ uuid, perceptual: preview.metrics.perceptual });
    } catch (err) {
      warnings.push(`reference ${uuid}: ${message(err)}; left out`);
    }
  }
  if (uuids.length > 0 && measured.length === 0) warnings.push("no reference could be measured, so passes report no reference_gap");
  return { source, collection: spec.collection ?? null, uuids, measured, warnings, aggregate: aggregate(measured.map((m) => m.perceptual)) };
}

/** The begin result's `references`: what was measured, and what went wrong. */
export function referencesJson(s: Session): Record<string, unknown> {
  const r = s.references;
  if (!r) return {};
  return { references: { source: r.source, collection: r.collection, measured: r.measured.map((m) => m.uuid), ...(r.warnings.length ? { warnings: r.warnings } : {}), note: GAP_NOTE } };
}

const GAP_NOTE = "reference_gap in each pass: the photo's value of each key measure, the references' [min, median, max], and below / within / above. Reported only, not a target.";

/** A pass result's `reference_gap`, when the session has measured references. */
export function gapJson(s: Session, metrics: Pick<Metrics, "perceptual">): Record<string, unknown> {
  const r = s.references;
  if (!r || r.measured.length === 0) return {};
  return { reference_gap: { n: r.measured.length, ...referenceGap(metrics.perceptual, r.aggregate) } };
}
