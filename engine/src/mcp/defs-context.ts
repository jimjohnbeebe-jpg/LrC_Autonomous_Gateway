// The MCP definitions of the context tools (tools-context.ts).

import { z } from "zod";
import { FRAME, MEASURED, box, longEdge, noArgs, sessionId, target, type ToolDef } from "./defs-shared.js";
import { PREVIEW_QUALITY } from "./tools-shared.js";

const sessionTarget = target.describe(
  'with session_id, in Variants mode: the photo, "A", "B", "C" or "master" (default: the photo the last session call worked on, the pick once there is one)',
);
const previewArgs = z.object({
  long_edge: longEdge,
  session_id: sessionId.optional().describe("render the session's photo, with its region metrics; refused if another photo is selected; ignored when no session is open"),
  target: sessionTarget,
  region: box.optional().describe(`return a crop of this box {x, y, w, h} in ${FRAME}, exported large enough to show it at up to 100 %; see effective_scale`),
  uuid: z.string().min(1).optional().describe("render this photo (a uuid from lr_search_photos, lr_get_selected_photos or lr_import_photos), selected or not; the selection is not touched; not with session_id"),
  quality: z
    .enum(["exact", "fast"])
    .optional()
    .describe('"exact" (default): the export, about 3 s. "fast": Lightroom\'s cached preview, quicker but possibly stale (source "thumbnail", stale_possible true); for browsing, not for judging an edit; not with session_id, target or region'),
});
const metricsArgs = z.object({ session_id: sessionId.optional(), target: sessionTarget });

export const CONTEXT_DEFS: ToolDef[] = [
  {
    name: "lr_get_active_photo_context",
    title: "Active photo context",
    description:
      "Describe the photo selected in Lightroom Classic: file, GPS position (`gps`, null for none), EXIF (ISO, shutter in seconds, aperture, focal length, lens, camera), " +
      "rating/label/pick, process version, camera profile, and every Develop setting under its canonical name " +
      "(`settings`; these names are the ones lr_step takes). `pipeline` is \"raw\" (camera raw files) or \"rendered\" (JPEG, TIFF, " +
      "PNG, PSD, HEIC, AVIF and other non-raw files): `white_balance_unit` says what temperature and tint mean on this photo, " +
      "Kelvin on raw, a relative -100..100 on rendered. Rendered photos have their own profiles (Color, Monochrome). Also says whether a session is open on it, and which Lightroom " +
      "version runs (`lightroom`; tell the user its `notices`, empty when the version is supported and tested). `left_open` lists sessions an engine " +
      "that stopped (the AI client closed or restarted it) left open, with `left_open_note`: ask the user, for each, to revert, accept or " +
      "abandon it, and end it with lr_end_session. Changes nothing.",
    schema: noArgs,
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (tools) => tools.getActivePhotoContext(),
  },
  {
    name: "lr_get_preview",
    title: "Preview of the active photo",
    description:
      `Render the photo selected in Lightroom with its current Develop settings (a JPEG export, quality ${PREVIEW_QUALITY}, ` +
      "which takes about 3 seconds) and return it as an image, with its uuid, SHA-256 hash, size, metrics and timings. " +
        "With `uuid`: that photo instead, without selecting it (to look through a shoot, for culling or keywording). " +
      "With `session_id`: the session's photo (refused with TARGET_CHANGED if another photo is selected) and its region metrics; " +
      "in Variants mode `target` names the copy, which is selected in Lightroom first. " +
      `With \`region\` (a box in ${FRAME}, as mask geometry and lr_set_regions are): a crop of that box for judging sharpness, noise or fringing; the photo is exported larger (up to 4096 px) ` +
      "so the crop fills `long_edge`, never enlarged; `effective_scale` = output pixels per photo pixel (1 = 100 %). With `region`, " +
      "the result's `metrics` describe the whole export (`metrics_scope` \"frame\") and `crop_metrics` the requested box, both " +
      "measured at export resolution. Changes nothing. " +
      MEASURED,
    schema: previewArgs,
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (tools, args) => tools.getPreview(args as z.infer<typeof previewArgs>),
  },
  {
    name: "lr_get_metrics",
    title: "Metrics of the last preview",
    description:
      "Return the full metrics of the last preview (the open session's, of `target` in Variants mode, or else this engine's last render): the metrics " +
      "lr_get_preview returns plus 256-bin luma, red, green and blue histograms, without rendering again. " +
      MEASURED,
    schema: metricsArgs,
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (tools, args) => tools.getMetrics(args as z.infer<typeof metricsArgs>),
  },
];
