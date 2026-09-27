// The MCP server: lists the engine's tools (tools.ts), validates each call's arguments with zod
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
  "luma = Rec. 709 weights on the 8-bit values (0-255); luma_percentiles p1-p99 by nearest rank; " +
  "dynamic_range = (p99 - p1) / 255; rb_ratio = mean red / mean blue (a white-balance proxy); " +
  "saturation_mean = mean HSV saturation, 0-100; hue_histogram = 12 bins of 30 degrees (bin i centred on i*30: " +
  "0 red, 60 yellow, 120 green, 180 cyan, 240 blue, 300 magenta), % of the chromatic pixels (HSV saturation and value " +
  ">= 0.1, chromatic_pct of all); hue_mean = their circular mean hue in degrees. Percentages are 0-100.";

const longEdge = z
  .number()
  .int()
  .min(MIN_LONG_EDGE)
  .max(MAX_LONG_EDGE)
  .optional()
  .describe(`Preview long edge in pixels, ${MIN_LONG_EDGE}-${MAX_LONG_EDGE} (default ${DEFAULT_LONG_EDGE}).`);

const noArgs = z.object({});
const sessionId = z.string().min(1).describe("the session_id from lr_begin_session");
const box = z
  .object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
  .describe("a box in 0-1 of the image's width and height, from the top-left corner: {x, y, w, h}");
const returnImage = z
  .enum(["after", "before_after", "none"])
  .optional()
  .describe('"after" (default): the new preview; "before_after": the previous and the new preview in one labelled image; "none": no image');
const previewArgs = z.object({
  long_edge: longEdge,
  session_id: sessionId.optional().describe("render the session's photo, with its region metrics; refused if another photo is selected"),
  region: box.optional().describe("return a crop of this box, exported large enough to show it at up to 100 %; see effective_scale"),
});
const metricsArgs = z.object({ session_id: sessionId.optional() });
const beginArgs = z.object({
  intent_id: z.string().min(1).describe("an intent id from lr_list_intents, e.g. landscape_golden_hour"),
  mode: z.enum(["converge"]).optional().describe('"converge" (the default and, until Phase 4, the only mode)'),
  max_passes: z.number().int().min(1).max(8).optional().describe("passes after pass 0, 1-8 (default 4)"),
  guardrails: z
    .object({ clip_high_pct: z.number().min(0).max(100).optional(), clip_low_pct: z.number().min(0).max(100).optional() })
    .optional()
    .describe("clipping limits for this session, replacing the intent's and the defaults (0.5 % high, 1.0 % low)"),
  notes: z.string().max(2000).optional().describe("the user's own words about the photo, kept in the log"),
  long_edge: longEdge,
  return_image: returnImage,
});
const stepArgs = z.object({
  session_id: sessionId,
  target: z.enum(["master"]).optional().describe('"master" (the only target until Variants mode, Phase 4)'),
  settings: z
    .record(z.string(), z.union([z.number(), z.boolean(), z.string(), z.array(z.number())]))
    .refine((s) => Object.keys(s).length > 0, "settings must name at least one parameter")
    .describe("canonical name -> CHANGE for numeric sliders (e.g. {\"exposure\": 0.3, \"highlights\": -20}); the value to set for camera_profile, switches, booleans and curves"),
  rationale: z.string().min(1).max(500).describe("one line: what you saw and why this change"),
  return_image: returnImage,
});
const probeArgs = z.object({
  session_id: sessionId,
  sliders: z.array(z.string().min(1)).min(1).max(3).refine((s) => new Set(s).size === s.length, "sliders must differ").describe("1-3 numeric sliders, e.g. [\"exposure\", \"whites\"]"),
  magnitude: z.number().min(0.1).max(1).optional().describe("the probe's size as a fraction of the slider's per-pass maximum (default 0.5)"),
});
const regionsArgs = z.object({
  session_id: sessionId,
  regions: z
    .array(
      z.object({
        kind: z.enum(["skin", "fur", "sky", "custom"]),
        label: z.string().min(1).max(40).describe("a short name, e.g. \"face\""),
        box,
        preserve: z.boolean().optional().describe("true: guard this region's hue and saturation from here on"),
      }),
    )
    .max(8)
    .describe("the whole set of regions (it replaces any earlier set); [] removes them"),
});
const endArgs = z.object({
  session_id: sessionId,
  outcome: z.enum(["accept", "revert"]).describe('"accept" keeps the edit and writes the recipe; "revert" applies the pre-session snapshot'),
});
const sessionLogArgs = z.object({ session_id: sessionId });

const getIntentArgs = z.object({ id: z.string().min(1).describe("the intent's id, from lr_list_intents") });
const saveIntentArgs = z.object({
  intent: z.record(z.string(), z.unknown()).describe("the whole intent object (schema v1; see lr_get_intent for an example)"),
  // A boolean rather than literal(true), so that false reaches the tool and gets NOT_CONFIRMED
  // rather than a generic INVALID_ARGUMENTS (Greptile, PR #22).
  confirmed: z.boolean().describe("true only after the user approved this exact intent in the chat"),
  replace: z.boolean().optional().describe("true to replace an existing user intent with the same id"),
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
        "(`settings`; these names are the ones lr_step takes). Also says whether a session is open on it. Changes nothing.",
      schema: noArgs,
      annotations: { readOnlyHint: true, openWorldHint: false },
      run: () => tools.getActivePhotoContext(),
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
      run: (args) => tools.getPreview(args as z.infer<typeof previewArgs>),
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
      run: (args) => tools.getMetrics(args as z.infer<typeof metricsArgs>),
    },
    {
      name: "lr_begin_session",
      title: "Begin an editing session",
      description:
        "Start an editing session on the photo selected in Lightroom, following an intent (lr_list_intents). The engine: " +
        "creates a Develop snapshot \"AVG pre-session …\" (lr_end_session revert returns to it); renders the photo as it is; " +
        "runs pass 0, one History step \"AVG <id> pass 0/N\" with the intent's camera profile, lens corrections and priors " +
        "(a numeric prior is added to the photo's value); then, while clipping is over a limit, pulls whites/highlights/exposure or " +
        "blacks/shadows/exposure back in fixed steps until under, at most 8 (\"… baseline k\"; a limit still over is `unmet` in " +
        "guardrail_actions). Returns session_id, the intent's brief (follow it), the " +
        "guardrails, pass0_applied, the full settings, metrics, and the preview. Then call lr_step for each pass. " +
        "One session at a time; the session stays open until lr_end_session. " +
        MEASURED,
      schema: beginArgs,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      run: (args) => tools.beginSession(args as z.infer<typeof beginArgs>),
    },
    {
      name: "lr_step",
      title: "One editing pass",
      description:
        "Apply one pass to the session's photo. `settings` maps canonical names to a CHANGE for numeric sliders " +
        "(e.g. {\"exposure\": 0.3, \"highlights\": -20} adds 0.3 EV and lowers highlights by 20) and to the value to set for " +
        "camera_profile, switches, booleans and curves. Each change is capped at the slider's per-pass maximum × the pass's decay " +
        "(1.0, 0.6, 0.4, 0.25: exposure 1 EV, contrast/texture/clarity/dehaze 40, highlights/shadows/whites/blacks 60, " +
        "vibrance/saturation 30, temperature 1500 K, tint 30, HSL 40, grading 30) and at the slider's range (`clamped`). " +
        "A change that would push further into a clipping limit already reached is refused (`refused`); the rest is written as " +
        "one History step \"AVG <id> pass n/N\", read back, rendered and measured. If clipping then exceeds a limit, the engine " +
        "pulls back the sliders that caused it, else takes fixed steps, at most 3 (\"… guard k\", in `guardrail_actions`). The pass " +
        "is undone (\"… clip revert\" / \"… region revert\", a `reverted` action; the pass still counts) when clipping is still over " +
        "a limit the photo was within before the pass, or a preserved region drifts. Returns the applied changes, full settings, " +
        "metrics, delta_metrics against the previous pass, and the image. " +
        "`converged_by_metrics` (the metrics stopped moving) or `cap_reached` end the passes: then call lr_end_session. " +
        "Unknown names or wrong types are refused before anything is written. " +
        MEASURED,
      schema: stepArgs,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      run: (args) => tools.step(args as z.infer<typeof stepArgs>),
    },
    {
      name: "lr_probe",
      title: "Probe slider sensitivity",
      description:
        "Measure how 1-3 numeric sliders move the metrics on this photo: each is changed by `magnitude` × its per-pass maximum, " +
        "rendered and measured (about 3.5 s each), and the photo is put back (History: \"AVG <id> probe <slider>\" … \"probe revert\"). " +
        "Returns the metric change per unit of each slider; later lr_step calls use it to cap changes that would cross a " +
        "clipping limit. Does not use a pass. Only when the intent sets allow_probe.",
      schema: probeArgs,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      run: (args) => tools.probe(args as z.infer<typeof probeArgs>),
    },
    {
      name: "lr_set_regions",
      title: "Set measured regions",
      description:
        "Name parts of the photo (skin, fur, sky or custom) as boxes in 0-1 of the image; their metrics appear in every later " +
        "`metrics.regions[]`, starting with the last preview (returned now). `preserve: true` guards a region: a pass that moves " +
        "its mean hue more than 6 degrees or its mean saturation more than 8 points from now is undone. The list replaces any " +
        "earlier one. Does not touch Lightroom.",
      schema: regionsArgs,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      run: (args) => tools.setRegions(args as z.infer<typeof regionsArgs>),
    },
    {
      name: "lr_end_session",
      title: "End the editing session",
      description:
        "End the session. \"accept\": keep the edit; the log is finalised and a recipe (the final settings under canonical names) " +
        "is written next to it. \"revert\": apply the pre-session snapshot, putting every setting back as it was before " +
        "lr_begin_session (the result lists any setting that still differs). Returns the log and recipe paths and the final settings.",
      schema: endArgs,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      run: (args) => tools.endSession(args as z.infer<typeof endArgs>),
    },
    {
      name: "lr_get_session_log",
      title: "Session log",
      description:
        "Return a session's provenance log (every pass: settings before/after, changes, metrics, preview hash, rationale, " +
        "guardrail actions), open or ended. Does not touch Lightroom.",
      schema: sessionLogArgs,
      annotations: { readOnlyHint: true, openWorldHint: false },
      run: (args) => tools.getSessionLog(args as z.infer<typeof sessionLogArgs>),
    },
    {
      name: "lr_list_intents",
      title: "List editing intents",
      description:
        "List the editing intents a session can start from (id, label, category, and whether it is bundled with the engine " +
        "or the user's own; a user intent with the same id replaces the bundled one). Files that failed validation are listed " +
        "under `warnings` and are not usable. Changes nothing; does not need Lightroom.",
      schema: noArgs,
      annotations: { readOnlyHint: true, openWorldHint: false },
      run: () => tools.listIntents(),
    },
    {
      name: "lr_get_intent",
      title: "Get an editing intent",
      description:
        "Return one intent in full: `brief` (instructions for the edit), `default_camera_profile`, `priors` (applied at pass 0: " +
        "a number is added to the photo's current value; a switch, boolean or curve is set as given), `variants` (A/B/C prior sets), " +
        "`guardrail_overrides` (clipping limits replacing the defaults of 0.5 % high and 1.0 % low), `regions_expected`, " +
        "`convergence_hints` and `allow_probe`. Changes nothing; does not need Lightroom.",
      schema: getIntentArgs,
      annotations: { readOnlyHint: true, openWorldHint: false },
      run: (args) => tools.getIntent(args as z.infer<typeof getIntentArgs>),
    },
    {
      name: "lr_save_intent",
      title: "Save an editing intent",
      description:
        "Save a new or changed intent as <id>.json in the user's intents folder. ONLY call this after the user has explicitly " +
        "approved the exact intent in this chat; `confirmed: true` states that they did. The intent is validated first (schema v1, " +
        "canonical parameter names and values, camera profile name) and nothing is written if it is invalid (INVALID_INTENT, with " +
        "`details.problems`). An existing user intent with the same id is replaced only with `replace: true` (else INTENT_EXISTS); " +
        "a bundled intent with the same id is overridden, and its file is not changed. Does not touch Lightroom.",
      schema: saveIntentArgs,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      run: (args) => tools.saveIntent(args as z.infer<typeof saveIntentArgs>),
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
