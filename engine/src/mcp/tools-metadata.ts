// The catalog metadata tools (GitHub issues #111, #112, #139 gap 4; library\metadata.ts; plugin
// 0.22.0, Metadata.lua): lr_set_flag and lr_set_iptc write as lr_set_rating does (tools-catalog.ts):
// one photo per plugin command, read before and after, only between sessions (SessionManager.whenIdle).
// Issue #218 rows 2-4 (plugin 1.5.0): lr_set_color_label, and lr_set_iptc's creator, copyright, location and
// accessibility fields, which go to the plugin by SDK key (library\metadata.ts TEXT_KEYS).
// lr_get_metadata reads, at any time, one photo per command: a photo Lightroom refused (no photo
// with that uuid) is listed in `failed` and the others are still read; a command with no answer stops
// the call (sync\target.ts UNANSWERED).

import {
  FLAGS,
  METADATA_PLUGIN,
  TEXT_FIELDS,
  TEXT_KEYS,
  flagName,
  textFromWire,
  textNotTaken,
  textToWire,
  writeEach,
  type ColorLabel,
  type FlagName,
  type IptcText,
} from "../library/index.js";
import { UNANSWERED, WRITE_TIMEOUT_MS } from "../sync/target.js";

import { toToolError } from "./errors.js";
import { written } from "./tools-catalog.js";
import { needPlugin, run, sessionTools, type ToolContext, type ToolOutput } from "./tools-shared.js";

export type SetFlagArgs = { uuids: string[]; flag: FlagName };
export type SetIptcArgs = { uuids: string[] } & { [F in keyof IptcText]?: string | undefined };

/**
 * raw: true (issue #214, upstream get_photo_metadata's develop settings, PR #347 [upstream claim]): the photo's
 * getDevelopSettings() table as Lightroom sent it (`sdk`), and by canonical name where the map reads it (params\map.ts
 * fromSdk); a photo the map refuses (a legacy process version, an unknown pipeline) has `settings` null and `settings_error`.
 */
async function developOf(ctx: ToolContext, uuid: string): Promise<Record<string, unknown>> {
  const sdk = (await ctx.deps.client.request("get_settings", { photo_uuid: uuid })).settings;
  try {
    const r = ctx.deps.map.fromSdk(sdk);
    return { process_version: r.process_version, pipeline: r.pipeline, settings: r.settings, sdk };
  } catch (err) {
    return { settings: null, settings_error: toToolError(err).body(), sdk };
  }
}
export type GetMetadataArgs = { uuids: string[]; raw?: boolean | undefined };
export type SetColorLabelArgs = { uuids: string[]; label: ColorLabel };

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
    if (Object.keys(want).some((f) => !["title", "caption", "headline"].includes(f))) needPlugin(ctx, "lr_set_iptc", "1.5.0", "it writes creator, copyright, location and alt text");
    return sessions.whenIdle("lr_set_iptc", async () => {
      const out = await writeEach(
        args.uuids,
        async (uuid) => {
          const r = await ctx.deps.client.request("set_iptc", { photo_uuid: uuid, ...textToWire(want) }, { timeoutMs: WRITE_TIMEOUT_MS });
          return { ...r, before: textFromWire(r.before), after: r.after === undefined ? undefined : textFromWire(r.after) };
        },
        (r) => textNotTaken(r.after, want),
        "text fields",
        "IPTC_NOT_TAKEN",
      );
      return written(out, { written: want, undo: "To put a photo back, call lr_set_iptc on it with the `before` value of each field written." });
    });
  });
}

/** Issue #218 row 2: the colour label, written and read back as lr_set_flag (Metadata.lua setColorLabel). */
export async function setColorLabel(ctx: ToolContext, args: SetColorLabelArgs): Promise<ToolOutput> {
  return run(ctx, "lr_set_color_label", args, async () => {
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    return sessions.whenIdle("lr_set_color_label", async () => {
      const out = await writeEach(
        args.uuids,
        (uuid) => ctx.deps.client.request("set_color_label", { photo_uuid: uuid, label: args.label }, { timeoutMs: WRITE_TIMEOUT_MS }),
        (r) => (r.after === args.label ? null : `Lightroom read back label ${r.after}, not ${args.label}.`),
        "colour label",
        "LABEL_NOT_TAKEN",
      );
      return written(out, { label: args.label, undo: "To put a photo back, call lr_set_color_label on it with its `before` label." });
    });
  });
}

/** get_metadata's text fields by tool name (library\metadata.ts TEXT_KEYS), the other keys as they came. */
function byToolNames(r: Record<string, unknown>): Record<string, unknown> {
  const wire = new Set<string>(Object.values(TEXT_KEYS));
  return { ...Object.fromEntries(Object.entries(r).filter(([k]) => !wire.has(k))), ...textFromWire(r) };
}

export type MetadataRead = { photos: Array<Record<string, unknown>>; failed: Array<{ uuid: string; code: string; message: string }>; not_read: string[] };

/** get_metadata for each photo in turn, until `deadline` (ms since the epoch; the photos left are `not_read`); raw adds `develop` (developOf). */
export async function readMetadata(ctx: ToolContext, uuids: readonly string[], deadline = Infinity, raw = false): Promise<MetadataRead> {
  const photos: MetadataRead["photos"] = [];
  const failed: MetadataRead["failed"] = [];
  for (const [i, uuid] of uuids.entries()) {
    if (i > 0 && Date.now() >= deadline) return { photos, failed, not_read: uuids.slice(i) };
    try {
      const { gps, stack, flag, ...r } = await ctx.deps.client.request("get_metadata", { photo_uuid: uuid });
      photos.push({
        ...byToolNames(r),
        filename: r.filename ?? null,
        ...(flag !== undefined ? { flag: flagName(flag) } : {}),
        ...(gps !== undefined ? { gps: gps === false ? null : gps } : {}),
        ...(stack !== undefined ? { stack: stack === false ? null : stack } : {}),
        ...(raw ? { develop: await developOf(ctx, uuid) } : {}),
      });
    } catch (err) {
      const error = toToolError(err);
      if (UNANSWERED.has(error.code)) throw error;
      failed.push({ uuid, code: error.code, message: error.message });
    }
  }
  return { photos, failed, not_read: [] };
}

export async function getMetadata(ctx: ToolContext, args: GetMetadataArgs): Promise<ToolOutput> {
  return run(ctx, "lr_get_metadata", args, async () => {
    await ctx.deps.ensureBridge();
    needPlugin(ctx, "lr_get_metadata", METADATA_PLUGIN, "it reads title, caption, headline, flags and stacks");
    const { photos, failed } = await readMetadata(ctx, args.uuids, Infinity, args.raw === true);
    return { json: { photos, failed }, log: { returned: photos.length, failed: failed.length } };
  });
}
