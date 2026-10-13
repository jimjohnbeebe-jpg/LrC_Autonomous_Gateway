// The catalog metadata tools (GitHub issues #111, #112, #139 gap 4; library\metadata.ts; plugin
// 0.22.0, Metadata.lua): lr_set_flag and lr_set_iptc write as lr_set_rating does (tools-catalog.ts):
// one photo per plugin command, read before and after, only between sessions (SessionManager.whenIdle).
// lr_get_metadata reads, at any time, one photo per command: a photo Lightroom refused (no photo
// with that uuid) is listed in `failed` and the others are still read; a command with no answer stops
// the call (sync\target.ts UNANSWERED).

import {
  FLAGS,
  METADATA_PLUGIN,
  TEXT_FIELDS,
  flagName,
  textNotTaken,
  writeEach,
  type FlagName,
  type IptcText,
} from "../library/index.js";
import { UNANSWERED, WRITE_TIMEOUT_MS } from "../sync/target.js";

import { toToolError } from "./errors.js";
import { written } from "./tools-catalog.js";
import { needPlugin, run, sessionTools, type ToolContext, type ToolOutput } from "./tools-shared.js";

export type SetFlagArgs = { uuids: string[]; flag: FlagName };
export type SetIptcArgs = { uuids: string[] } & { [F in keyof IptcText]?: string | undefined };
export type GetMetadataArgs = { uuids: string[] };

export async function setFlag(ctx: ToolContext, args: SetFlagArgs): Promise<ToolOutput> {
  return run(ctx, "lr_set_flag", args, async () => {
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    needPlugin(ctx, "lr_set_flag", METADATA_PLUGIN, "it writes pick flags");
    const flag = FLAGS[args.flag];
    return sessions.whenIdle("lr_set_flag", async () => {
      const out = await writeEach(
        args.uuids,
        async (uuid) => {
          const r = await ctx.deps.client.request("set_flag", { photo_uuid: uuid, flag }, { timeoutMs: WRITE_TIMEOUT_MS });
          return { ...r, before: flagName(r.before), after: r.after === undefined ? undefined : flagName(r.after) };
        },
        (r) => (r.after === args.flag ? null : `Lightroom read back flag ${String(r.after)}, not ${args.flag}.`),
        "flag",
        "FLAG_NOT_TAKEN",
      );
      return written(out, { flag: args.flag });
    });
  });
}

export async function setIptc(ctx: ToolContext, args: SetIptcArgs): Promise<ToolOutput> {
  return run(ctx, "lr_set_iptc", args, async () => {
    const want: Partial<IptcText> = {};
    for (const f of TEXT_FIELDS) if (args[f] !== undefined) want[f] = args[f];
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    needPlugin(ctx, "lr_set_iptc", METADATA_PLUGIN, "it writes title, caption and headline");
    return sessions.whenIdle("lr_set_iptc", async () => {
      const out = await writeEach(
        args.uuids,
        (uuid) => ctx.deps.client.request("set_iptc", { photo_uuid: uuid, ...want }, { timeoutMs: WRITE_TIMEOUT_MS }),
        (r) => textNotTaken(r.after, want),
        "title, caption and headline",
        "IPTC_NOT_TAKEN",
      );
      return written(out, { written: want });
    });
  });
}

export async function getMetadata(ctx: ToolContext, args: GetMetadataArgs): Promise<ToolOutput> {
  return run(ctx, "lr_get_metadata", args, async () => {
    await ctx.deps.ensureBridge();
    needPlugin(ctx, "lr_get_metadata", METADATA_PLUGIN, "it reads title, caption, headline, flags and stacks");
    const photos: Array<Record<string, unknown>> = [];
    const failed: Array<{ uuid: string; code: string; message: string }> = [];
    for (const uuid of args.uuids) {
      try {
        const { gps, stack, flag, ...r } = await ctx.deps.client.request("get_metadata", { photo_uuid: uuid });
        photos.push({
          ...r,
          filename: r.filename ?? null,
          ...(flag !== undefined ? { flag: flagName(flag) } : {}),
          ...(gps !== undefined ? { gps: gps === false ? null : gps } : {}),
          ...(stack !== undefined ? { stack: stack === false ? null : stack } : {}),
        });
      } catch (err) {
        const error = toToolError(err);
        if (UNANSWERED.has(error.code)) throw error;
        failed.push({ uuid, code: error.code, message: error.message });
      }
    }
    return { json: { photos, failed }, log: { returned: photos.length, failed: failed.length } };
  });
}
