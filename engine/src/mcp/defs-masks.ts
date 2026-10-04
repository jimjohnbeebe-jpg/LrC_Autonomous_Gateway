// The MCP definitions of the mask tools (tools-session.ts; the work is session\masks.ts, GitHub issue
// #59, engine 0.16.0). The local sliders are params\mask-table.ts LOCAL_PARAMS, in the Masking panel's
// units [handle: docs\reports\phase6\masks-capture\capture2-calibration.json `fields`]. Inverting a mask
// (MaskInverted true, captured only as false) and a luminance entry made by the engine are [unverified]
// in Lightroom until Jim's mask tools check (it creates a luminance range; it does not invert).

import { z } from "zod";
import { AI_KINDS, LOCAL_PARAMS, REFUSED_KINDS } from "../params/index.js";
import { MASKS_PLUGIN } from "../session/index.js";
import { sessionId, target, type ToolDef } from "./defs-shared.js";

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
    lum_range: z.array(unit).length(4).optional().describe("luminance: [a, b, c, d] in 0-1, each at least the one before: luminance a..d is masked, fully from b to c"),
  })
  .describe("In 0-1 of the uncropped photo, from its top-left corner. linear: zero and full points; radial: the ellipse's box left, top, right, bottom; luminance: lum_range. AI kinds take none.");
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
const KINDS = ["linear", "radial", "luminance", ...AI_NAMES, ...Object.keys(REFUSED_KINDS)] as [string, ...string[]];
const group = (prefix: string): string => AI_NAMES.filter((k) => k.startsWith(prefix)).join(", ");

const listArgs = z.object({ session_id: sessionId, target: target.describe('Variants mode: which photo ("master", "A", …); default the photo the last call worked on') });
const createArgs = z.object({
  ...passFields,
  kind: z
    .enum(KINDS)
    .describe(
      "linear, radial, luminance (geometry). Found by Lightroom's AI: subject, sky, background; landscape, one category per mask: " +
        `${group("landscape_")}; every person in the photo, one part per mask: ${group("people_")}; one person, with point on them: ` +
        `${group("person_")}. people, landscape (name the part or category), brush, objects, color_range and depth_range are refused, with the reason`,
    ),
  name: name.optional().describe('the name the Masks panel shows (default "AVG <kind>")'),
  geometry: geometry.optional(),
  point: point.optional().describe(`${group("person_")} only: a point on that person (on the face, for face skin), in 0-1 of the photo`),
  sliders: sliders.optional(),
});
const editArgs = z.object({
  ...passFields,
  mask_id: maskId,
  name: name.optional().describe("rename"),
  active: z.boolean().optional().describe("false hides the mask (its effect is off), true shows it"),
  inverted: z.boolean().optional().describe("true inverts the mask (not yet checked in Lightroom: look at the preview)"),
  geometry: geometry.optional(),
  sliders: sliders.optional(),
  combine: z.object({ mode: z.enum(["add", "subtract", "intersect"]) }).optional().describe("refused for now: combining components was not captured"),
});
const deleteArgs = z.object({ ...passFields, mask_id: maskId });

const PASS_NOTE =
  "Each mask change is ONE pass of the session (it counts against max_passes, so raise max_passes at lr_begin_session when masks " +
  "are planned; it may follow convergence, and approve_each_pass mode gates it like lr_step). It writes the photo's whole mask " +
  "table as one History step \"AVG <id> pass n/N mask <op>\", reads it back, renders and measures, and is undone (\"… clip revert\") " +
  "when clipping goes over a limit the photo was within; global sliders are never moved for a mask. If the masks changed in " +
  "Lightroom meanwhile: MASKS_CHANGED, nothing written. While the photo has a mask the tools cannot write back safely (several " +
  "components, a blend mode, a kind not listed here): MASKS_UNCAPTURED_KIND, nothing written (lr_list_masks still reads). " +
  "Returns the mask, every mask of the photo (`masks`, with fresh ids), " +
  `metrics, delta_metrics and the image. Needs plugin ${MASKS_PLUGIN}. Not offered: brush painting, Select Objects, colour or ` +
  "depth range sampling, reading mask pixels, mask presets.";

export const MASK_DEFS: ToolDef[] = [
  {
    name: "lr_list_masks",
    title: "List the photo's masks",
    description:
      "List the masks on the session's photo: id, name, kind (lr_create_mask's kinds; \"ai\" or \"other\" for a kind Lightroom made that the tools do not know), " +
      "on/off, inverted, components, the local sliders not at 0 (Masking panel units), geometry, and for AI masks whether they have computed. " +
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
      "geometry.lum_range; the AI kinds are found by Lightroom: the engine adds the mask to the table and asks Lightroom to compute it " +
      "(the call waits up to 5 minutes for Lightroom, and the HUD says it is working). If the photo has none of that kind, MASK_NOTHING_FOUND: " +
      "the mask is taken out again and the pass is not used. If Lightroom stays busy or shows a dialog, the HUD says: \"Lightroom is busy or shows a dialog: if a dialog is open in Lightroom, click OK.\" " +
      "If the mask then computes the pass goes on; if Lightroom reports the update failed or dropped it, the engine puts the photo back as it was before the session and ENDS " +
      "the session (LIGHTROOM_DIALOG). Nothing is written to the photo while Lightroom has not given the mask's result: no result in 5 minutes, or Lightroom not answering, " +
      "is LIGHTROOM_STUCK, the session stays open and refuses writes, renders and reverts (AI_UPDATE_PENDING); tell the user to restart Lightroom: once it is back the engine " +
      "puts the photo back and ends the session by itself (later calls naming it get SESSION_ENDED). Tell the user what happened, and start a " +
      "new session only if they ask. If the update fails with a Lightroom or plugin error, subject, sky and background are made by " +
      "Lightroom's Develop module instead (Lightroom then switches to Develop; `ai.route` \"dc\", `switched_to_develop`); people and " +
      "landscape kinds have no such fallback. If nothing works, FEATURE_UNAVAILABLE (details.routes_tried): the masks are as before and " +
      "the pass is not used. One person's kinds (person_*) take the person whose box holds the point: `ai.people` lists every person's " +
      "box Lightroom found (left, top, right, bottom in 0-1 of the photo) and `ai.instance` the one chosen (lr_list_masks shows both); " +
      "no person at the point: MASK_NOTHING_FOUND with the boxes, so a point inside the right box can be given. " +
      PASS_NOTE,
    schema: createArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (tools, args) => tools.createMask(args as z.infer<typeof createArgs>),
  },
  {
    name: "lr_edit_mask",
    title: "Edit a mask",
    description:
      "Change one mask by its id: set local sliders (absolute values in panel units), its geometry (linear, radial, luminance), invert it, rename it, " +
      "or hide/show it (`active`). A mask of several components can be renamed, hidden and given sliders, not reshaped or inverted; combining " +
      "components is refused. MASK_NOT_FOUND: call lr_list_masks for the current ids. " +
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
