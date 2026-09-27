// The MCP definitions of the context tools (tools-context.ts).

import { z } from "zod";
import { MEASURED, box, longEdge, noArgs, sessionId, type ToolDef } from "./defs-shared.js";
import { PREVIEW_QUALITY } from "./tools-shared.js";

const previewArgs = z.object({
  long_edge: longEdge,
  session_id: sessionId.optional().describe("render the session's photo, with its region metrics; refused if another photo is selected"),
  region: box.optional().describe("return a crop of this box, exported large enough to show it at up to 100 %; see effective_scale"),
});
const metricsArgs = z.object({ session_id: sessionId.optional() });

export const CONTEXT_DEFS: ToolDef[] = [
  {
    name: "lr_get_active_photo_context",
    title: "Active photo context",
    description:
      "Describe the photo selected in Lightroom Classic: file, EXIF (ISO, shutter in seconds, aperture, focal length, lens, camera), " +
      "rating/label/pick, process version, camera profile, and every Develop setting under its canonical name " +
      "(`settings`; these names are the ones lr_step takes). Also says whether a session is open on it. Changes nothing.",
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
      "With `session_id`: the session's photo (refused with TARGET_CHANGED if another photo is selected) and its region metrics. " +
      "With `region`: a crop of that box for judging sharpness, noise or fringing; the photo is exported larger (up to 4096 px) " +
      "so the crop fills `long_edge`, never enlarged; `effective_scale` = output pixels per photo pixel (1 = 100 %). Changes nothing. " +
      MEASURED,
    schema: previewArgs,
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (tools, args) => tools.getPreview(args as z.infer<typeof previewArgs>),
  },
  {
    name: "lr_get_metrics",
    title: "Metrics of the last preview",
    description:
      "Return the full metrics of the last preview (the open session's, or else this engine's last render): the metrics " +
      "lr_get_preview returns plus 256-bin luma, red, green and blue histograms, without rendering again. " +
      MEASURED,
    schema: metricsArgs,
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (tools, args) => tools.getMetrics(args as z.infer<typeof metricsArgs>),
  },
];
