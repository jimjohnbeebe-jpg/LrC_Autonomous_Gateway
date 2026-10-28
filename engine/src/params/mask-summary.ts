// A correction as the tools show it (mask-ops.ts, session\masks.ts, the session log): id, name, kind,
// on/off, sliders in panel units, geometry, whether an AI mask has computed, and for one person's mask its
// person (instance) and the boxes of every person Lightroom found (mask-person.ts); for a mask of several parts,
// each part (issue #131, mask-combine.ts modeOf). Moved out of
// mask-table.ts in PR C step 2c (module size, rule 01). Field names from mask-table.ts (rule 03).

import { IDENTITY, boxToView, isIdentity, radialToBox, toView, type CropFrame } from "./crop-frame.js";
import { ellipseOf } from "./mask-build.js";
import { modeOf } from "./mask-combine.js";
import { boundsOf, instanceOf, type Box } from "./mask-person.js";
import { pointColorsOf, type Swatch } from "./mask-point-colors.js";
import { BRUSH, C, IMAGE, LINEAR, LOCAL_PARAMS, M, RADIAL, RANGE, WHAT, componentKind, components, computed, type Component, type Correction } from "./mask-table.js";

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
  /** A mask of several parts (issue #131): each part in order (lr_edit_mask `part` 1 is the first), its kind, mode after the first ("other": none of the three), inversion and geometry. */
  parts?: MaskPart[];
  /** Point Color swatches (issue #217 row 4), in order (lr_edit_mask point_colors index 1 is the first); stored strings that do not read are shown as stored. */
  point_colors?: Array<Swatch | string>;
};
export type MaskPart = { kind: string; mode?: string; inverted: boolean; geometry?: Record<string, unknown> };

const round = (v: number): number => Math.round(v * 100) / 100;
const nameOf = (e: Correction): string => (typeof e[C.name] === "string" ? (e[C.name] as string) : String(e[C.id]));

/**
 * The photo's points and boxes in the preview's frame (crop-frame.ts, issue #179), to 6 decimals once mapped;
 * outside 0-1 where a mask reaches past the crop. Nothing is mapped on a photo whose frame is refused: its
 * geometry says why instead.
 */
const viewOf = (f: CropFrame) => {
  const r6 = (v: number): number => (isIdentity(f) ? v : Math.round(v * 1e6) / 1e6);
  const box = (b: Box): Box => ({ left: r6(b.left), top: r6(b.top), right: r6(b.right), bottom: r6(b.bottom) });
  return {
    point: (x: unknown, y: unknown): { x: unknown; y: unknown } => {
      if (isIdentity(f)) return { x, y };
      const p = toView(f, { x: Number(x), y: Number(y) });
      return { x: r6(p.x), y: r6(p.y) };
    },
    radial: (m: Component): Box => box(radialToBox(f, ellipseOf(m))),
    people: (bs: Box[]): Box[] => bs.map((b) => box(boxToView(f, b))),
  };
};

function geometryOf(m: Component, f: CropFrame): Record<string, unknown> | undefined {
  const kind = componentKind(m);
  const range = m[RANGE.holder] as Record<string, unknown> | undefined;
  const numbers = (v: unknown): unknown => (typeof v === "string" ? v.split(/\s+/).map(Number) : v);
  if (kind === "luminance") return { lum_range: numbers(range?.[RANGE.lumRange]) };
  if (kind === "depth_range") return { depth_range: numbers(range?.[RANGE.depthRange]) };
  if (kind === "brush") {
    const strokes = (m[BRUSH.masks] as Component[] | undefined) ?? [];
    return { strokes: strokes.length, dabs: strokes.reduce((n, s) => n + ((s[BRUSH.dabs] as unknown[] | undefined) ?? []).filter((t) => String(t).startsWith("d ")).length, 0) };
  }
  if (kind === "color_range") {
    const model = (range?.[RANGE.pointModels] as unknown[] | undefined)?.[0];
    // sample: Lightroom's l, a, b as stored (mask-range.ts, issue #210), for geometry.sample or copy_sample_from.
    const [l, a, b, x, y] = typeof model === "string" ? model.trim().split(/\s+/).map(Number) : [];
    const lab = { sample: { l, a, b }, color_amount: range?.[RANGE.colorAmount] }; // not a place: shown on a refused frame too
    if (f.refused) return { unavailable: `not shown: ${f.refused}`, ...lab };
    return { point: viewOf(f).point(x, y), ...lab };
  }
  const at = m[IMAGE.referencePoint];
  const placed = kind === "linear" || kind === "radial" || typeof at === "string";
  if (placed && f.refused) return { unavailable: `not shown: ${f.refused}` };
  const v = viewOf(f);
  if (kind === "linear") return { zero: v.point(m[LINEAR.zeroX], m[LINEAR.zeroY]), full: v.point(m[LINEAR.fullX], m[LINEAR.fullY]) };
  if (kind === "radial") return { ...v.radial(m), feather: m[RADIAL.feather] };
  if (typeof at === "string") {
    const [x, y] = at.split(/\s+/).map(Number);
    return { point: v.point(x, y) };
  }
  return undefined;
}

// Lightroom stores an ordinary Intersect part as MaskBlendMode 1 + MaskInverted true + MaskValue 0 [handle:
// docs\reports\phase8.5\mask-combine.md:62; docs\reports\phase8.5\mask-carry\mask_carry_2026-10-11T22-37-39-161Z.json
// `table_before[2]`], so a part after the first reads inverted only when its fields are none of the three modes (issue #193).
const invertedOf = (m: Component, i: number): boolean => m[M.inverted] === true && (i === 0 || modeOf(m) === null);

function partOf(f: CropFrame) {
  return (m: Component, i: number): MaskPart => {
    const geometry = geometryOf(m, f);
    return { kind: String(componentKind(m)), ...(i > 0 ? { mode: modeOf(m) ?? "other" } : {}), inverted: invertedOf(m, i), ...(geometry ? { geometry } : {}) };
  };
}

/** A correction as the tools show it; its geometry, points and people's boxes in the preview's frame (`frame`, the photo's crop frame). */
export function summarize(e: Correction, frame: CropFrame = IDENTITY): MaskSummary {
  const parts = components(e);
  const first = parts[0];
  const kinds = [...new Set(parts.map(componentKind))];
  const sliders: Record<string, number> = {};
  for (const [name, p] of LOCAL_PARAMS) {
    const v = e[p.field];
    if (typeof v === "number" && v !== 0) sliders[name] = round(v * p.scale);
  }
  const single = parts.length === 1 && first ? first : null;
  const geometry = single ? geometryOf(single, frame) : undefined;
  const instance = instanceOf(single);
  const people = frame.refused ? [] : viewOf(frame).people(boundsOf(single));
  const ai = parts.filter((m) => m[M.what] === WHAT.image);
  const swatches = pointColorsOf(e);
  return {
    id: String(e[C.id]),
    name: nameOf(e),
    kind: kinds.length === 1 ? (kinds[0] as string) : "mixed",
    active: e[C.active] !== false,
    inverted: parts.length > 0 && parts.every(invertedOf),
    components: parts.length,
    sliders,
    ...(geometry ? { geometry } : {}),
    ...(ai.length > 0 ? { computed: ai.every(computed) } : {}),
    ...(instance !== null ? { instance } : {}),
    ...(people.length > 0 ? { people } : {}),
    ...(parts.length > 1 ? { parts: parts.map(partOf(frame)) } : {}),
    ...(swatches ? { point_colors: swatches } : {}),
  };
}
