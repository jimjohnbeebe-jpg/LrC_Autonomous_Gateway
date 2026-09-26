// The MCP server: registers the Phase 2 tools (tools.ts) and turns their results into MCP content.
// Arguments are validated with zod before a tool runs (rule 01-stack). A result is an `image` block
// (the preview, when there is one) followed by a `text` block with the JSON payload, the order the S3
// spike used [handle: spikes\S3\server.ts]; a failure is `isError` with {ok: false, error: {code,
// message, recoverable}} (PRD NFR-7). In Claude Desktop the image shows only inside the expanded
// tool-call box (Phase 0, P-04) [handle: docs\reports\phase0\S3.md].

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { toToolError } from "./errors.js";
import { DEFAULT_LONG_EDGE, MAX_LONG_EDGE, MIN_LONG_EDGE, PREVIEW_QUALITY, type ToolOutput, type Tools } from "./tools.js";
import { ENGINE_VERSION } from "./version.js";

const MEASURED =
  "Metrics are measured on the rendered preview (8-bit sRGB, as Lightroom exported it), not on the raw file: " +
  "clipping here can often be recovered from the raw data with highlights/whites or shadows/blacks. " +
  "clip_high_pct = % of pixels with any channel >= 253; clip_low_pct = % of pixels with all channels <= 2; " +
  "luma = Rec. 709 weights on the 8-bit values.";

const longEdge = z
  .number()
  .int()
  .min(MIN_LONG_EDGE)
  .max(MAX_LONG_EDGE)
  .optional()
  .describe(`Preview long edge in pixels, ${MIN_LONG_EDGE}-${MAX_LONG_EDGE} (default ${DEFAULT_LONG_EDGE}).`);

async function respond(fn: () => Promise<ToolOutput>): Promise<CallToolResult> {
  try {
    const out = await fn();
    const content: CallToolResult["content"] = [];
    if (out.image) content.push({ type: "image", data: out.image.toString("base64"), mimeType: "image/jpeg" });
    content.push({ type: "text", text: JSON.stringify(out.json) });
    return { content };
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: JSON.stringify({ ok: false, error: toToolError(err).body() }) }] };
  }
}

export function createServer(tools: Tools): McpServer {
  const server = new McpServer({ name: "lrc-avg", version: ENGINE_VERSION });

  server.registerTool(
    "lr_get_active_photo_context",
    {
      title: "Active photo context",
      description:
        "Describe the photo selected in Lightroom Classic: file, EXIF (ISO, shutter in seconds, aperture, focal length, lens, camera), " +
        "rating/label/pick, process version, camera profile, and every Develop setting under its canonical name " +
        "(`settings`; these names are the ones lr_set_settings accepts). Changes nothing. " +
        "`uuid` identifies the photo; pass it to lr_set_settings.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => respond(() => tools.getActivePhotoContext()),
  );

  server.registerTool(
    "lr_get_preview",
    {
      title: "Preview of the active photo",
      description:
        `Render the photo selected in Lightroom with its current Develop settings (a JPEG export, quality ${PREVIEW_QUALITY}, ` +
        "which takes about 3 seconds) and return it as an image, with its uuid, SHA-256 hash, size, basic metrics and timings. " +
        "Changes nothing. " +
        MEASURED,
      inputSchema: { long_edge: longEdge },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) => respond(() => tools.getPreview(args.long_edge !== undefined ? { long_edge: args.long_edge } : {})),
  );

  server.registerTool(
    "lr_get_metrics",
    {
      title: "Metrics of the last preview",
      description:
        "Return the full metrics of the last preview this engine rendered (luma mean and 256-bin luma histogram, " +
        "clipping overall and per channel), without rendering again. Call lr_get_preview first. " +
        MEASURED,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => respond(() => tools.getMetrics()),
  );

  server.registerTool(
    "lr_set_settings",
    {
      title: "Set Develop settings (temporary)",
      description:
        "Set Develop settings on the photo selected in Lightroom to ABSOLUTE values (not deltas), e.g. {\"exposure\": 0.83}. " +
        "Use the canonical names from lr_get_active_photo_context `settings`; `camera_profile` takes a profile name such as \"Adobe Landscape\". " +
        "`uuid` must be the photo's uuid from an earlier result: if another photo is selected now, nothing is written (TARGET_CHANGED). " +
        "Unknown names and out-of-range values are refused before anything is written. " +
        "The change is one named step in Lightroom's History panel (\"AVG … set n\"), so it can be undone there. " +
        "Every write is read back; a value Lightroom did not take is reported as WRITE_NOT_TAKEN. " +
        "By default the new preview is returned as an image with its metrics and the change against the previous preview " +
        "(return_image \"none\" skips the render). This is the temporary Phase 2 tool; no guardrails or step limits apply yet. " +
        MEASURED,
      inputSchema: {
        uuid: z.string().min(1).describe("uuid of the photo, from lr_get_active_photo_context or lr_get_preview"),
        settings: z
          .record(z.string(), z.union([z.number(), z.boolean(), z.string(), z.array(z.number())]))
          .refine((s) => Object.keys(s).length > 0, "settings must name at least one parameter")
          .describe("canonical name -> absolute value"),
        return_image: z.enum(["after", "none"]).optional().describe('"after" (default) returns the new preview; "none" skips it'),
        long_edge: longEdge,
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    (args) =>
      respond(() =>
        tools.setSettings({
          uuid: args.uuid,
          settings: args.settings,
          ...(args.return_image !== undefined ? { return_image: args.return_image } : {}),
          ...(args.long_edge !== undefined ? { long_edge: args.long_edge } : {}),
        }),
      ),
  );

  return server;
}
