// A correction as the tools show it (mask-ops.ts, session\masks.ts, the session log): id, name, kind,
// on/off, sliders in panel units, geometry, whether an AI mask has computed, and for one person's mask its
// person (instance) and the boxes of every person Lightroom found (mask-person.ts). Moved out of
// mask-table.ts in PR C step 2c (module size, rule 01). Field names from mask-table.ts (rule 03).

import { boundsOf, instanceOf, type Box } from "./mask-person.js";
import { C, IMAGE, LINEAR, LOCAL_PARAMS, M, RADIAL, RANGE, WHAT, componentKind, components, computed, type Component, type Correction } from "./mask-table.js";

export type MaskSummary = {
  id: string;
  name: string;
  kind: string;
  active: boolean;
  inverted: boolean;
  components: number;
  /** Local sliders not at 0, in the panel's units. */
  sliders: Record<string, number>;
  geometry?: Record<string, unknown>;
  /** AI kinds: whether Lightroom has computed the mask. */
  computed?: boolean;
  /** One person's mask: which person (InstanceID), and every person's box Lightroom found. */
  instance?: number;
  people?: Box[];
};

const round = (v: number): number => Math.round(v * 100) / 100;
const nameOf = (e: Correction): string => (typeof e[C.name] === "string" ? (e[C.name] as string) : String(e[C.id]));

function geometryOf(m: Component): Record<string, unknown> | undefined {
  const kind = componentKind(m);
  if (kind === "linear") return { zero: { x: m[LINEAR.zeroX], y: m[LINEAR.zeroY] }, full: { x: m[LINEAR.fullX], y: m[LINEAR.fullY] } };
  if (kind === "radial") return { left: m[RADIAL.left], top: m[RADIAL.top], right: m[RADIAL.right], bottom: m[RADIAL.bottom], feather: m[RADIAL.feather] };
  if (kind === "luminance") {
    const lum = (m[RANGE.holder] as Record<string, unknown>)[RANGE.lumRange];
    return { lum_range: typeof lum === "string" ? lum.split(/\s+/).map(Number) : lum };
  }
  const at = m[IMAGE.referencePoint];
  if (typeof at === "string") {
    const [x, y] = at.split(/\s+/).map(Number);
    return { point: { x, y } };
  }
  return undefined;
}

/** A correction as the tools show it. */
export function summarize(e: Correction): MaskSummary {
  const parts = components(e);
  const first = parts[0];
  const kinds = [...new Set(parts.map(componentKind))];
  const sliders: Record<string, number> = {};
  for (const [name, p] of LOCAL_PARAMS) {
    const v = e[p.field];
    if (typeof v === "number" && v !== 0) sliders[name] = round(v * p.scale);
  }
  const single = parts.length === 1 && first ? first : null;
  const geometry = single ? geometryOf(single) : undefined;
  const instance = instanceOf(single);
  const people = boundsOf(single);
  const ai = parts.filter((m) => m[M.what] === WHAT.image);
  return {
    id: String(e[C.id]),
    name: nameOf(e),
    kind: kinds.length === 1 ? (kinds[0] as string) : "mixed",
    active: e[C.active] !== false,
    inverted: parts.length > 0 && parts.every((m) => m[M.inverted] === true),
    components: parts.length,
    sliders,
    ...(geometry ? { geometry } : {}),
    ...(ai.length > 0 ? { computed: ai.every(computed) } : {}),
    ...(instance !== null ? { instance } : {}),
    ...(people.length > 0 ? { people } : {}),
  };
}
