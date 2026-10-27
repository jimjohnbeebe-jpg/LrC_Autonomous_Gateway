// lr_set_ai_metadata and lr_get_ai_metadata (GitHub issue #218 row 9; upstream's set_ai_metadata and get_ai_metadata
// [upstream claim: Automaat/lightroom-mcp@1040453 plugin/LightroomMCP.lrplugin/HandlerAiMetadata.lua]): an AI's score
// (0-100) and reason kept in the plugin's private metadata (plugin\LrC-AVG.lrplugin\PluginMetadata.lua), one photo
// per command, read before and after (library\write.ts writeEach), between sessions as lr_set_rating. The read also
// gives the AVG stamp an accepted session leaves (session\avg-stamp.ts): session id, look and date.

import { writeEach } from "../library/index.js";
import { UNANSWERED, WRITE_TIMEOUT_MS } from "../sync/target.js";
import { toToolError } from "./errors.js";
import { written } from "./tools-catalog.js";
import { run, sessionTools, type ToolContext, type ToolOutput } from "./tools-shared.js";

export type SetAiMetadataArgs = { uuids: string[]; score?: number | null | undefined; reason?: string | null | undefined };
type Fields = { aiScore: string; aiReason: string; avgSession: string; avgLook: string; avgDate: string };
type AiValue = { score: number | null; reason: string | null };

const ai = (f: Fields): AiValue => ({ score: f.aiScore === "" ? null : Number(f.aiScore), reason: f.aiReason === "" ? null : f.aiReason });
const stamp = (f: Fields) => (f.avgSession === "" ? null : { session_id: f.avgSession, look: f.avgLook || null, date: f.avgDate || null });

export async function setAiMetadata(ctx: ToolContext, args: SetAiMetadataArgs): Promise<ToolOutput> {
  return run(ctx, "lr_set_ai_metadata", args, async () => {
    const fields: Record<string, string> = {};
    if (args.score !== undefined) fields["aiScore"] = args.score === null ? "" : String(args.score);
    if (args.reason !== undefined) fields["aiReason"] = args.reason ?? "";
    const want: Partial<AiValue> = { ...(args.score !== undefined ? { score: args.score } : {}), ...(args.reason !== undefined ? { reason: args.reason } : {}) };
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    return sessions.whenIdle("lr_set_ai_metadata", async () => {
      const out = await writeEach(
        args.uuids,
        async (uuid) => {
          const r = await ctx.deps.client.request("set_plugin_metadata", { photo_uuid: uuid, fields }, { timeoutMs: WRITE_TIMEOUT_MS });
          return { ...r, before: ai(r.before), after: r.after === undefined ? undefined : ai(r.after) };
        },
        (r) => ((Object.keys(want) as Array<keyof AiValue>).every((k) => r.after[k] === want[k]) ? null : `Lightroom read back ${JSON.stringify(r.after)}, not what was written.`),
        "AI metadata",
        "AI_METADATA_NOT_TAKEN",
      );
      return written(out, { written: want, undo: "To put a photo back, call lr_set_ai_metadata on it with its `before` score and reason (null clears)." });
    });
  });
}

export async function getAiMetadata(ctx: ToolContext, args: { uuids: string[] }): Promise<ToolOutput> {
  return run(ctx, "lr_get_ai_metadata", args, async () => {
    await ctx.deps.ensureBridge();
    const photos: Array<Record<string, unknown>> = [];
    const failed: Array<{ uuid: string; code: string; message: string }> = [];
    for (const uuid of args.uuids) {
      try {
        const r = await ctx.deps.client.request("get_plugin_metadata", { photo_uuid: uuid });
        photos.push({ uuid: r.uuid, filename: r.filename ?? null, ...ai(r.fields), avg_edit: stamp(r.fields) });
      } catch (err) {
        const e = toToolError(err);
        if (UNANSWERED.has(e.code)) throw e;
        failed.push({ uuid, code: e.code, message: e.message });
      }
    }
    return { json: { photos, failed }, log: { returned: photos.length, failed: failed.length } };
  });
}
