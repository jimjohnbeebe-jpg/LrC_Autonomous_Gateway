// The MCP server: lists the Phase 2 tools (tools.ts), validates each call's arguments with zod
// (rule 01-stack) and turns results into MCP content. A result is an `image` block (the preview, when
// there is one) followed by a `text` block with the JSON payload, the order the S3 spike used
// [handle: spikes\S3\server.ts]; a failure, invalid arguments included, is `isError` with
// {ok: false, error: {code, message, recoverable}} (PRD NFR-7), and every call, a rejected one
// included, is in the tool log. In Claude Desktop the image shows only inside the expanded tool-call
// box (Phase 0, P-04) [handle: docs\reports\phase0\S3.md].
//
// This uses the SDK's low-level Server, as Automaat does [upstream claim:
// vendor\automaat\server\src\create-server.ts:18-32], not McpServer: McpServer validates arguments
// itself and answers a failure with its own plain-text error before the tool handler runs
// [handle: node_modules\@modelcontextprotocol\sdk\dist\esm\server\mcp.js:125, 141, 166-178, SDK 1.30.1],
// so neither the error shape nor the log would cover it (Greptile, PR #17).

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ToolError, toToolError } from "./errors.js";
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

const noArgs = z.object({});
const previewArgs = z.object({ long_edge: longEdge });
const setSettingsArgs = z.object({
  uuid: z.string().min(1).describe("uuid of the photo, from lr_get_active_photo_context or lr_get_preview"),
  settings: z
    .record(z.string(), z.union([z.number(), z.boolean(), z.string(), z.array(z.number())]))
    .refine((s) => Object.keys(s).length > 0, "settings must name at least one parameter")
    .describe("canonical name -> absolute value"),
  return_image: z.enum(["after", "none"]).optional().describe('"after" (default) returns the new preview; "none" skips it'),
  long_edge: longEdge,
});

type ToolDef = {
  name: string;
  title: string;
  description: string;
  schema: z.ZodObject;
  annotations: Tool["annotations"];
  run: (args: Record<string, unknown>) => Promise<ToolOutput>;
};

/** The advertised JSON Schema of a tool's arguments, from the same zod schema that validates them. */
function inputSchema(schema: z.ZodObject): Tool["inputSchema"] {
  const { $schema: _dialect, ...json } = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  return { ...json, type: "object" } as Tool["inputSchema"];
}

function errorResult(error: ToolError): CallToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ ok: false, error: error.body() }) }] };
}

async function respond(fn: () => Promise<ToolOutput>): Promise<CallToolResult> {
  try {
    const out = await fn();
    const content: CallToolResult["content"] = [];
    if (out.image) content.push({ type: "image", data: out.image.toString("base64"), mimeType: "image/jpeg" });
    content.push({ type: "text", text: JSON.stringify(out.json) });
    return { content };
  } catch (err) {
    return errorResult(toToolError(err));
  }
}

function definitions(tools: Tools): ToolDef[] {
  return [
    {
      name: "lr_get_active_photo_context",
      title: "Active photo context",
      description:
        "Describe the photo selected in Lightroom Classic: file, EXIF (ISO, shutter in seconds, aperture, focal length, lens, camera), " +
        "rating/label/pick, process version, camera profile, and every Develop setting under its canonical name " +
        "(`settings`; these names are the ones lr_set_settings accepts). Changes nothing. " +
        "`uuid` identifies the photo; pass it to lr_set_settings.",
      schema: noArgs,
      annotations: { readOnlyHint: true, openWorldHint: false },
      run: () => tools.getActivePhotoContext(),
    },
    {
      name: "lr_get_preview",
      title: "Preview of the active photo",
      description:
        `Render the photo selected in Lightroom with its current Develop settings (a JPEG export, quality ${PREVIEW_QUALITY}, ` +
        "which takes about 3 seconds) and return it as an image, with its uuid, SHA-256 hash, size, basic metrics and timings. " +
        "Changes nothing. " +
        MEASURED,
      schema: previewArgs,
      annotations: { readOnlyHint: true, openWorldHint: false },
      run: (args) => tools.getPreview(args as z.infer<typeof previewArgs>),
    },
    {
      name: "lr_get_metrics",
      title: "Metrics of the last preview",
      description:
        "Return the full metrics of the last preview this engine rendered (luma mean and 256-bin luma histogram, " +
        "clipping overall and per channel), without rendering again. Call lr_get_preview first. " +
        MEASURED,
      schema: noArgs,
      annotations: { readOnlyHint: true, openWorldHint: false },
      run: () => tools.getMetrics(),
    },
    {
      name: "lr_set_settings",
      title: "Set Develop settings (temporary)",
      description:
        "Set Develop settings on the photo selected in Lightroom to ABSOLUTE values (not deltas), e.g. {\"exposure\": 0.83}. " +
        "Use the canonical names from lr_get_active_photo_context `settings`; `camera_profile` takes a profile name such as \"Adobe Landscape\". " +
        "`uuid` must be the photo's uuid from an earlier result: if another photo is selected now, nothing is written (TARGET_CHANGED). " +
        "Unknown names and out-of-range values are refused before anything is written. " +
        "The change is one named step in Lightroom's History panel (\"AVG … set n\"), so it can be undone there. " +
        "Every write is read back; a value Lightroom did not take is reported as WRITE_NOT_TAKEN. " +
        "By default the new preview is returned as an image with its metrics and the change against the previous preview " +
        "(return_image \"none\" skips the render); if only the render fails, the write is still reported, with `preview_error`. " +
        "This is the temporary Phase 2 tool; no guardrails or step limits apply yet. " +
        MEASURED,
      schema: setSettingsArgs,
      annotations: { readOnlyHint: false, openWorldHint: false },
      run: (args) => tools.setSettings(args as z.infer<typeof setSettingsArgs>),
    },
  ];
}

export function createServer(tools: Tools): Server {
  const server = new Server({ name: "lrc-avg", version: ENGINE_VERSION }, { capabilities: { tools: {} } });
  const defs = definitions(tools);
  const byName = new Map(defs.map((d) => [d.name, d]));

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: defs.map((d) => ({
      name: d.name,
      title: d.title,
      description: d.description,
      inputSchema: inputSchema(d.schema),
      annotations: d.annotations,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;
    const args: unknown = request.params.arguments ?? {};
    const def = byName.get(name);
    if (!def) {
      const error = new ToolError("UNKNOWN_TOOL", `There is no tool named "${name}" (tools: ${[...byName.keys()].join(", ")}).`, false);
      tools.recordRejected(name, args, error);
      return errorResult(error);
    }
    const parsed = def.schema.safeParse(args);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.length ? i.path.join(".") : "arguments"}: ${i.message}`).join("; ");
      const error = new ToolError("INVALID_ARGUMENTS", `Invalid arguments for ${name}: ${issues}`, false);
      tools.recordRejected(name, args, error);
      return errorResult(error);
    }
    return respond(() => def.run(parsed.data as Record<string, unknown>));
  });

  return server;
}
