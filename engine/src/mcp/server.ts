// The MCP server: lists the engine's tools (tools.ts; their definitions are the defs-*.ts modules,
// one per group), validates each call's arguments with zod (rule 01-stack) and turns results into
// MCP content. A result is an `image` block (the preview, when there is one) followed by a `text`
// block with the JSON payload, the order the S3 spike used [handle: spikes\S3\server.ts]; a failure,
// invalid arguments included, is `isError` with {ok: false, error: {code, message, recoverable}}
// (PRD NFR-7), and every call, a rejected one included, is in the tool log. In Claude Desktop the
// image shows only inside the expanded tool-call box (Phase 0, P-04) [handle: docs\reports\phase0\S3.md].
//
// This uses the SDK's low-level Server, as Automaat does [upstream claim:
// vendor\automaat\server\src\create-server.ts:18-32], not McpServer: McpServer validates arguments
// itself and answers a failure with its own plain-text error before the tool handler runs
// [handle: node_modules\@modelcontextprotocol\sdk\dist\esm\server\mcp.js:125, 141, 166-178, SDK 1.30.1],
// so neither the error shape nor the log would cover it (Greptile, PR #17).
// A call whose request carries a progressToken gets notifications/progress while it runs (withProgress;
// GitHub issue #59, PR C step 2d: an AI mask's wait may take minutes).
// Issue #155: each call runs in its context with the client's clientInfo from the handshake (R1), the
// rejected ones included, and answers within the call deadline (deadline.ts, R3): a run still busy
// then answers `pending`, and its progress notifications stop with that answer.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { withCallContext } from "./call-context.js";
import { clientIdentity } from "./client-info.js";
import { createDeadline } from "./deadline.js";
import { CATALOG_DEFS } from "./defs-catalog.js";
import { METADATA_DEFS } from "./defs-metadata.js";
import { FILE_DEFS } from "./defs-files.js";
import { CONTEXT_DEFS } from "./defs-context.js";
import { INTENT_DEFS } from "./defs-intents.js";
import { MASK_DEFS } from "./defs-masks.js";
import { PROPAGATION_DEFS } from "./defs-propagation.js";
import { SESSION_DEFS } from "./defs-session.js";
import type { ToolDef } from "./defs-shared.js";
import { ToolError, toToolError } from "./errors.js";
import { capImage } from "./image-cap.js";
import type { Tools } from "./tools.js";
import type { ToolOutput } from "./tools-shared.js";
import { ENGINE_VERSION } from "./version.js";

/** The tool groups, in the order the server lists them. */
const DEFS: ToolDef[] = [...CONTEXT_DEFS, ...SESSION_DEFS, ...MASK_DEFS, ...INTENT_DEFS, ...PROPAGATION_DEFS, ...CATALOG_DEFS, ...METADATA_DEFS, ...FILE_DEFS];

/** The advertised JSON Schema of a tool's arguments, from the same zod schema that validates them. */
function inputSchema(schema: z.ZodObject): Tool["inputSchema"] {
  const { $schema: _dialect, ...json } = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  return { ...json, type: "object" } as Tool["inputSchema"];
}

function errorResult(error: ToolError): CallToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ ok: false, error: error.body() }) }] };
}

/** A tool's output as MCP content; an image over the cap is reduced and flagged (image-cap.ts, issue #78). Exported for tests. */
export async function respond(fn: () => Promise<ToolOutput>): Promise<CallToolResult> {
  try {
    const out = await fn();
    const content: CallToolResult["content"] = [];
    let json = out.json;
    if (out.image) {
      const capped = await capImage(out.image);
      if (capped.reduced) json = { ...json, image_reduced: capped.reduced };
      content.push({ type: "image", data: capped.image.toString("base64"), mimeType: "image/jpeg" });
    }
    content.push({ type: "text", text: JSON.stringify(json) });
    return { content };
  } catch (err) {
    return errorResult(toToolError(err));
  }
}

/**
 * How often a call that asked for progress (a progressToken) gets notifications/progress while it runs
 * [inference: often enough to show an AI mask's wait of up to 5 minutes, session\ai-update.ts]. Claude
 * Desktop sends no token, so this never runs there: 194 of 194 calls logged progress_token false [handle:
 * docs\reports\phase8.5\desktop-call-limit.md, Observed]. It stays for clients that send one.
 */
const PROGRESS_MS = 10_000;

type Notify = (n: { method: "notifications/progress"; params: { progressToken: string | number; progress: number; message?: string } }) => Promise<void>;

/** Run `fn`, sending notifications/progress every `everyMs` (with the session's HUD note as message) when the client gave a token. */
async function withProgress<T>(token: string | number | undefined, notify: Notify, note: () => string | null, everyMs: number, fn: () => Promise<T>): Promise<T> {
  if (token === undefined) return fn();
  let progress = 0;
  const timer = setInterval(() => {
    const message = note();
    notify({ method: "notifications/progress", params: { progressToken: token, progress: ++progress, ...(message ? { message } : {}) } }).catch(() => undefined);
  }, everyMs);
  try {
    return await fn();
  } finally {
    clearInterval(timer);
  }
}

export function createServer(tools: Tools, options: { progressMs?: number; deadlineMs?: number } = {}): Server {
  const server = new Server({ name: "lrc-avg", version: ENGINE_VERSION }, { capabilities: { tools: {} } });
  const byName = new Map(DEFS.map((d) => [d.name, d]));
  const deadline = createDeadline({ ...(options.deadlineMs !== undefined ? { ms: options.deadlineMs } : {}), log: (t, a, p) => tools.recordPending(t, a, p) });

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: DEFS.map((d) => ({
      name: d.name,
      title: d.title,
      description: d.description,
      inputSchema: inputSchema(d.schema),
      annotations: d.annotations,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, (request, extra) => {
    const { name } = request.params;
    const args: unknown = request.params.arguments ?? {};
    const progress = { token: request.params._meta?.progressToken, ms: options.progressMs ?? PROGRESS_MS };
    const context = { progressToken: progress.token !== undefined, client: clientIdentity(server.getClientVersion()) };
    return withCallContext(context, async () => {
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
      const run = () => respond(() => def.run(tools, parsed.data as Record<string, unknown>));
      return withProgress(progress.token, (n) => extra.sendNotification(n), () => tools.progressNote(), progress.ms, () => deadline(name, parsed.data, run));
    });
  });

  return server;
}
