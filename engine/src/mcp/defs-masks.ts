// The MCP definitions of the mask tools (tools-session.ts; the work is session\masks.ts, GitHub issue
// #59, engine 0.16.0). The local sliders are params\mask-table.ts LOCAL_PARAMS, in the Masking panel's
// units [handle: docs\reports\phase6\masks-capture\capture2-calibration.json `fields`]. An inverted radial
// reads back MaskInverted true, Flipped false [handle: docs\reports\phase8\S10\census\s10__DSC0103.NEF__Copy 1.json
// "AVG vignette"; issue #79]. Inverting another kind and a luminance entry made by the engine are [unverified]
// in Lightroom until Jim's mask tools check (it creates a luminance range; it does not invert). Parts of a mask
// (issue #131): only the forms params\mask-combine.ts VERIFIED_FORMS lists are written, and the tool text names
// them from that list; how a form renders is checked by `npm run masks:combine` (docs\reports\phase8.5\mask-combine.md).
// Every point and box is in the preview's frame (FRAME, issue #179), mapped to the uncropped photo by
// params\crop-frame.ts; where Lightroom puts it on a cropped, angled or turned photo is [unverified] until
// `npm run masks:crop` (docs\reports\phase9\issue179.md).

import { z } from "zod";
import { AI_KINDS, BRUSH_LIMITS, BRUSH_RADIUS, LOCAL_PARAMS, MODE_NAMES, REFUSED_KINDS, VERIFIED_FORMS } from "../params/index.js";
import { AI_PART_PLUGIN, MASKS_PLUGIN } from "../session/index.js";
import { FRAME, sessionId, target, type ToolDef } from "./defs-shared.js";

const unit = z.number().min(0).max(1);
const point = z.object({ x: unit, y: unit });
const geometry = z
  .object({
    zero: point.optional().describe("linear: where the effect fades to nothing"),
    full: point.optional().describe("linear: where the effect is full"),
    left: unit.optional(),
    top: unit.optional(),
    right: unit.optional(),
    bottom: unit.optional(),
    feather: z.number().min(0).max(100).optional().describe("radial: feather 0-100 (new radial: 50)"),
    lum_range: z.array(unit).length(4).optional().describe("luminance: [a, b, c, d] in 0-1, each at least the one before: luminance a..d is masked, fully from b to c (at least 0.01 wide)"),
    depth_range: z.array(unit).length(4).optional().describe("depth_range: as lum_range, in distances, 0 the nearest; only on photos with a depth map (DEPTH_MAP_MISSING otherwise)"),
    color_amount: z.number().gt(0).max(1).optional().describe("color_range: how far the selection reaches from the colour at `point` (Lightroom's Refine), above 0 to 1, default 0.5"),
    strokes: z
      .array(
        z.object({
          points: z.array(point).min(1).max(BRUSH_LIMITS.points).describe("the stroke's path; the engine fills in dabs between the points"),
          radius: z.number().min(0.001).max(1).optional().describe(`the brush's radius as a fraction of the whole photo's long edge (before any crop), default ${BRUSH_RADIUS}`),
          flow: z.number().min(0.01).max(1).optional().describe("0.01-1, default 1"),
        }),
      )
      .min(1)
      .max(BRUSH_LIMITS.strokes)
      .optional()
      .describe(`brush: 1-${BRUSH_LIMITS.strokes} strokes painted with the mask's sliders (no erase)`),
  })
  .describe(
    `In ${FRAME}, as lr_get_preview \`region\` and lr_set_regions are; the engine maps it through the photo's crop (its angle included). ` +
      "linear: zero and full points; radial: the ellipse's box left, top, right, bottom (the ellipse is square to the preview); luminance: lum_range (tones, not a place); " +
        "depth_range: depth_range; color_range: color_amount (the colour is `point`'s); brush: strokes. AI kinds take none.",
  );
const sliders = z
  .record(z.string(), z.number())
  .describe(`local slider -> the value to SET (not a change), in the Masking panel's units: ${[...LOCAL_PARAMS].map(([k, p]) => `${k} ${p.min}..${p.max}`).join(", ")}`);
const passFields = {
  session_id: sessionId,
  target: target.describe('Variants mode: masks go on the pick only (after lr_select_variant). Converge mode: "master" or left out'),
  rationale: z.string().min(1).max(500).describe("one line: what you saw and why this mask change"),
  return_image: z.enum(["after", "before_after", "none"]).optional().describe('"after" (default), "before_after" or "none"'),
};
const name = z.string().min(1).max(60);
const maskId = z.string().min(1).describe("the mask's id from lr_list_masks or a mask tool's result (`masks[].id`)");

const AI_NAMES = Object.keys(AI_KINDS);
// color_range, depth_range and brush are described from engine 1.1.0 (#191) but were left out of this list, so the
// schema refused them before the engine saw them (found for issue #210) [handle: engine\tests\mcp-mask-defs.test.ts].
const KINDS = ["linear", "radial", "luminance", "color_range", "depth_range", "brush", ...AI_NAMES, ...Object.keys(REFUSED_KINDS)] as [string, ...string[]];
const group = (prefix: string): string => AI_NAMES.filter((k) => k.startsWith(prefix)).join(", ");

const listArgs = z.object({ session_id: sessionId, target: target.describe('Variants mode: which photo ("master", "A", …); default the photo the last call worked on') });
const createArgs = z.object({
  ...passFields,
  kind: z
    .enum(KINDS)
    .describe(
      "linear, radial, luminance, depth_range, brush (geometry); color_range (point, color_amount). Found by Lightroom's AI: subject, sky, background; landscape, one category per mask: " +
        `${group("landscape_")}; every person in the photo, one part per mask: ${group("people_")}; one person, with point on them: ` +
        `${group("person_")}. people, landscape (name the part or category) and objects are refused, with the reason`,
    ),
  name: name
    .optional()
    .describe('the name the Masks panel shows (default "AVG <kind>"); a suggested style is "N. Subject - Purpose", for example "4. Lone Juniper - Foliage Separation"; any clear name works'),
  geometry: geometry.optional(),
  point: point.optional().describe(`${group("person_")}: a point on that person (on the face, for face skin); color_range: a point on the colour to select (sampled from the preview there); in ${FRAME}`),
  sliders: sliders.optional(),
});
const editArgs = z.object({
  ...passFields,
  mask_id: maskId,
  name: name.optional().describe('rename (a rename alone uses no pass); the same suggested style, "N. Subject - Purpose"'),
  active: z.boolean().optional().describe("false hides the mask (its effect is off), true shows it"),
  inverted: z.boolean().optional().describe("true inverts the mask (a radial's inversion checked in Lightroom; other kinds not yet: look at the preview)"),
  geometry: geometry.optional(),
  sliders: sliders.optional(),
  combine: z
    .object({ mode: z.enum(MODE_NAMES), kind: z.enum(KINDS).optional(), geometry: geometry.optional() })
    .optional()
    .describe("without part: add a part of kind (with its geometry; AI kinds take none) to the mask in mode add, subtract or intersect. With part: that part's new mode (mode only)"),
  part: z.number().int().min(1).optional().describe("edit one part of the mask (1 = the first, in the order of lr_list_masks `parts`): with exactly one of geometry (reshape), inverted, combine (its mode) or remove_part"),
  remove_part: z.literal(true).optional().describe("with part (2 or more): remove that part from the mask"),
});
const deleteArgs = z.object({ ...passFields, mask_id: maskId });

// An undone pass still counts: masks.ts sets t.passes = n after applyPlan, undo or not [handle:
// engine\src\session\masks.ts maskPass `t.passes = n`]; a preserved region's drift undoes it too (masks.ts
// applyPlan `regionDrift` and the undo after it). Regions are measured on every mask pass's render
// (session\io.ts:128-141; masks.ts applyPlan `render` returns them,
// metrics\compute.ts:78, :269-271). An AI mask's point: the engine writes 0.5/0.5 (params\mask-ops.ts:156)
// and Lightroom moved it to 0.767134/0.656632 on mask 524781EC [handle: logs\20261010-72a50c.json:1904-1909,
// gitignored, read 2026-10-11; issue #129]; that it says nothing of the mask's extent is [inference].
// converged_by_metrics is session\plan.ts convergedByRegions, never an end reason (masks.ts maskPass `convergedByRegions`; issue
// #130 item 4) [handle: tests\session-masks-converge.test.ts]; a mask that overlaps no region reads as
// converged [inference]. A rename alone goes through session\masks.ts renameMask (engine 0.35.0, hands-on batch 1): no pass, no
// render; a name does not change pixels [inference].
const PASS_NOTE =
  "Each mask change is ONE pass of the session (it counts against max_passes, so raise max_passes at lr_begin_session when masks " +
  "are planned; it may follow convergence, and approve_each_pass mode gates it like lr_step). A rename alone (lr_edit_mask " +
  "with only mask_id and name) is not a pass: one History step, no render, and it works at the pass cap. A mask change writes the photo's whole mask " +
  "table as one History step \"AVG <id> pass n/N mask <op>\", reads it back, renders and measures, and is undone (\"… clip revert\" / " +
  "\"… region revert\"; the pass still counts) when clipping goes over a limit the photo was within, or a preserved region " +
  "drifts; global sliders are never moved for a mask. To measure a local edit, name its area with lr_set_regions first: every " +
  "mask pass returns its metrics in `metrics.regions[]` and `delta_metrics.regions[]`. converged_by_metrics: every region's " +
  "change is under the convergence thresholds (mean luma < 1/255, clipping < 0.1 point); false without regions or when the pass " +
  "was undone; a signal only, the session goes on. An AI mask's geometry.point is Lightroom's reference point " +
  "(Lightroom may move it while it computes), not where the mask reaches. If the masks changed in " +
  "Lightroom meanwhile: MASKS_CHANGED, nothing written. The other masks on the photo, the user's own included, are written back " +
  "unchanged and checked on read-back. Editing a mask the tools cannot write back safely (several parts in a form not listed " +
  "under lr_edit_mask, a blend mode on its first part, a kind not listed here) is refused: MASKS_UNCAPTURED_KIND, nothing " +
  "written; deleting it is allowed. A mirrored photo refuses geometry and points (CROP_FRAME_UNSUPPORTED); " +
  "`warnings` flags a mask 90 % or more outside the preview. " +
  "Returns the mask, every mask of the photo (`masks`, with fresh ids), " +
  `metrics, delta_metrics and the image. Needs plugin ${MASKS_PLUGIN}. color_range, depth_range, brush: not reshaped, not parts. ` +
  "Not offered: Select Objects, brush erase, mask pixels, mask presets.";

export const MASK_DEFS: ToolDef[] = [
  {
    name: "lr_list_masks",
    title: "List the photo's masks",
    description:
      "List the masks on the session's photo: id, name, kind (lr_create_mask's kinds; \"ai\", \"range\" or \"other\" for a kind Lightroom made that the tools do not know; \"mixed\" for components of several kinds), " +
      "on/off, inverted, components, the local sliders not at 0 (Masking panel units), geometry, and for AI masks whether they have computed. " +
      `Geometry, points and people's boxes are in ${FRAME}, as lr_create_mask takes them; a mask drawn past the crop in Lightroom reads outside 0-1. ` +
      "On a mirrored photo geometry reads { unavailable: <why> }. " +
      "A mask of several parts also lists `parts`, in order (lr_edit_mask `part` 1 is the first): each part's kind, mode (add, subtract, intersect; \"other\" for none of them), inverted and geometry. " +
      "Also lists the local sliders and their ranges. Does not use a pass and writes nothing.",
    schema: listArgs,
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (tools, args) => tools.listMasks(args as z.infer<typeof listArgs>),
  },
  {
    name: "lr_create_mask",
    title: "Create a mask",
    description:
      "Create one mask on the session's photo, with its local sliders set in the same pass. linear and radial take geometry; luminance takes " +
      "geometry.lum_range; Lightroom finds and computes the AI kinds (the call waits up to 5 minutes; the Deck's Abort ends the wait: SESSION_ENDED). " +
      "If the photo has none of that kind, MASK_NOTHING_FOUND: " +
      "the mask is taken out again and the pass is not used. If Lightroom stays busy or shows a dialog, the HUD tells the user to click OK in it. " +
      "If the mask then computes the pass goes on; if Lightroom reports the update failed or dropped it, the engine puts the photo back as it was before the session and ENDS " +
      "the session (LIGHTROOM_DIALOG). No result in 5 minutes, or Lightroom not answering, is LIGHTROOM_STUCK: Lightroom's AI mask is still computing, " +
      "nothing is written to the photo, and the session stays open and refuses writes, renders and reverts (AI_UPDATE_PENDING) until Lightroom's " +
      "result shows. Lightroom does not notify you: when the user says to go on, your next call (lr_step, lr_end_session or a linear or radial mask; not the same AI mask again) picks it up. Tell the user to wait, or to press Abort in the Deck (lr_help, 9, says what it does). " +
      "For the rest of the session prefer linear or radial masks to AI masks. If Lightroom reports the update over with no result, AI_MASK_FAILED: " +
      "the user should save their work and restart Lightroom; start a " +
      "new session only if they ask. If the update fails with a Lightroom or plugin error, subject, sky and background are made by " +
      "Lightroom's Develop module instead (Lightroom then switches to Develop; `ai.route` \"dc\", `switched_to_develop`); people and " +
      "landscape kinds have no such fallback. If nothing works, FEATURE_UNAVAILABLE (details.routes_tried): the masks are as before and " +
      "the pass is not used. One person's kinds (person_*) take the person whose box holds the point: `ai.people` lists every person's " +
      "box Lightroom found (left, top, right, bottom, in geometry's frame) and `ai.instance` the one chosen (lr_list_masks shows both); " +
      "no person at the point: MASK_NOTHING_FOUND with the boxes. " +
      PASS_NOTE,
    schema: createArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (tools, args) => tools.createMask(args as z.infer<typeof createArgs>),
  },
  {
    name: "lr_edit_mask",
    title: "Edit a mask",
    // Sliders merge into the stored ones [handle: engine\src\params\mask-ops.ts:236, Object.assign].
    description:
      "Change one mask by its id: set local sliders (absolute values in panel units; sliders not given keep their values), its geometry (linear, radial, luminance), invert it, rename it, " +
      "or hide/show it (`active`). MASK_NOT_FOUND: call lr_list_masks for the current ids. " +
      "Parts: `combine` adds a part (kind, geometry) in mode add, subtract or intersect; `part` names one part to reshape (geometry), invert, set to a mode (combine.mode) " +
      "or remove (remove_part); a mask of several parts is inverted or reshaped only part by part. Only these forms, which were checked in Lightroom, are written: " +
      `${[...VERIFIED_FORMS].map((f) => `"${f}"`).join(", ")} (a mask's parts in order, each after the first with its mode; a part edit as "<form>: <edit>"; sky stands for every AI kind, though only sky was checked). ` +
      "Any other form (other kinds or orders of parts, three parts, other part edits) is refused: MASK_OP_NOT_CAPTURED names the form, nothing is written and the pass is not used. " +
      `An AI part needs plugin ${AI_PART_PLUGIN} and is computed by Lightroom as an AI mask is (the same waits and errors); when Lightroom finds nothing, the mask is put back as it was. ` +
      PASS_NOTE,
    schema: editArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (tools, args) => tools.editMask(args as z.infer<typeof editArgs>),
  },
  {
    name: "lr_delete_mask",
    title: "Delete a mask",
    description: "Delete one mask by its id (the table is written without it; History and the session's revert bring it back). " + PASS_NOTE,
    schema: deleteArgs,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    run: (tools, args) => tools.deleteMask(args as z.infer<typeof deleteArgs>),
  },
];
