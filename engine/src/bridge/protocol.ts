// Bridge protocol between the engine and the Lightroom plugin (ARCHITECTURE section 3).
//
// One JSON object per line, UTF-8, in both directions:
//   engine -> plugin (port 8765, the plugin's receive socket): { id, type: "cmd", name, ts, token, payload }
//     `token` is the one the plugin writes at start to %USERPROFILE%\.lrc-avg\bridge_token; the plugin
//     refuses any command without it ("unauthorized"). Chosen by Jim 2026-09-26 [stated] after
//     Greptile's security finding on PR #14.
//   plugin -> engine (port 8766, the plugin's send socket):
//     { id, type: "res", name, ts, ok: true, payload }  or  { ..., ok: false, error: { code, message, recoverable } }
//     { id, type: "evt", name, ts, payload }
// Every inbound line is validated here with zod before the engine acts on it (rule 01-stack).
// The plugin side is plugin\LrC-AVG.lrplugin\Bridge.lua, Dispatch.lua (the handler table),
// Develop.lua, Preview.lua and Catalog.lua.
//
// Lua cannot tell an empty array from an empty object, and the plugin's Json.lua writes every empty
// table as []. Payload schemas below never require a non-empty table to be an object.

import { z } from "zod";

export const PROTOCOL_VERSION = 1;

export const bridgeErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
  recoverable: z.boolean(),
});
export type BridgeErrorBody = z.infer<typeof bridgeErrorSchema>;

const envelopeBase = {
  id: z.string().min(1),
  name: z.string().min(1),
  ts: z.string().optional(),
};

export const responseSchema = z.object({
  ...envelopeBase,
  type: z.literal("res"),
  ok: z.boolean(),
  payload: z.unknown().optional(),
  error: bridgeErrorSchema.optional(),
});
export type ResponseEnvelope = z.infer<typeof responseSchema>;

export const eventSchema = z.object({
  ...envelopeBase,
  type: z.literal("evt"),
  payload: z.unknown().optional(),
});
export type EventEnvelope = z.infer<typeof eventSchema>;

export const inboundSchema = z.discriminatedUnion("type", [responseSchema, eventSchema]);
export type InboundEnvelope = z.infer<typeof inboundSchema>;

/** A getDevelopSettings() table as the plugin sends it. */
export const sdkSettingsSchema = z.record(z.string(), z.unknown());

export const helloResultSchema = z.looseObject({
  protocol: z.number(),
  plugin_version: z.string(),
  lrc_version: z.string(),
  sdk_declared: z.number(),
  ports: z.object({ receive: z.number(), send: z.number() }),
});
export type HelloResult = z.infer<typeof helloResultSchema>;

const targeted = { uuid: z.string().min(1) };

/** Metadata fields are passed through as the SDK returns them; only the identity is required. */
export const contextResultSchema = z.looseObject({
  ...targeted,
  local_id: z.number(),
  lrc_version: z.string(),
  metadata_errors: z.array(z.string()).optional(),
});

/**
 * A photo as Catalog.lua describes it. A photo that is not a virtual copy has no copy_name, and its
 * master_local_id is its own local_id [handle: docs\reports\phase4\S7\s7_run_2026-09-27T12-53-05.json
 * "master"]. A metadata read that fails leaves its field out.
 */
const photoIdentity = {
  local_id: z.number(),
  is_virtual_copy: z.boolean().optional(),
  master_local_id: z.number().optional(),
  copy_name: z.string().optional(),
};

export const COMMANDS = {
  hello: helloResultSchema,
  ping: z.object({ pong: z.literal(true), nonce: z.string().optional() }),
  get_context: contextResultSchema,
  get_settings: z.object({ ...targeted, settings: sdkSettingsSchema }),
  // apply_ms times applyDevelopSettings inside the write gate. read_ms (the getDevelopSettings
  // read-back) and command_ms (the whole command in the plugin) come with the Phase 2 plugin; the
  // Phase 1 plugin does not send them (PHASE1.md "Consequences": time the write command itself).
  apply_settings: z.object({
    ...targeted,
    apply_ms: z.number(),
    read_ms: z.number().optional(),
    command_ms: z.number().optional(),
    read_back: sdkSettingsSchema,
  }),
  // An LrExportSession JPEG of the target photo, written by the plugin under its temp folder
  // (Phase 0, P-01 and D-01: the export is the only post-change preview, and it crosses as a path).
  export_preview: z.object({
    ...targeted,
    path: z.string().min(1),
    export_ms: z.number(),
  }),
  create_snapshot: z.object({
    ...targeted,
    snapshot_id: z.string().min(1),
    id_global: z.string().optional(),
    name: z.string(),
    same_name_count: z.number(),
  }),
  apply_snapshot: z.object({ ...targeted, read_back: sdkSettingsSchema }),
  // Plugin 0.3.0 (Catalog.lua). `uuid` and `local_id` are the master's. Once a copy exists the
  // plugin answers ok, so `copies` lists every copy it made; `failure` says why it stopped before
  // `requested`. Only copies with identity_ok are copies of the master with the asked name (P-18).
  create_virtual_copies: z.object({
    ...targeted,
    local_id: z.number(),
    requested: z.number(),
    copies: z.array(z.object({ ...photoIdentity, uuid: z.string().optional(), identity_ok: z.boolean() })),
    failure: z.object({ code: z.string().min(1), message: z.string() }).optional(),
    master_selected: z.boolean(),
    master_select_error: z.string().optional(),
  }),
  // The photo found by uuid, checked against `expect`, and now the only selected photo.
  select_photo: z.object({ ...targeted, ...photoIdentity }),
} as const;

export type CommandName = keyof typeof COMMANDS;
export type CommandResult<N extends CommandName> = z.infer<(typeof COMMANDS)[N]>;

/** Optional guard: the plugin refuses the command if the selected photo has another uuid. */
type Target = { target_uuid?: string };

export type CommandPayloads = {
  hello: { protocol: number; engine_version: string };
  ping: { nonce?: string };
  get_context: Target;
  get_settings: Target;
  apply_settings: Target & { settings: Record<string, unknown>; history_name: string };
  /** long_edge in pixels; quality 0-100 (the plugin converts it to the export setting's scale). */
  export_preview: Target & { long_edge: number; quality: number };
  create_snapshot: Target & { name: string };
  apply_snapshot: Target & { snapshot_id: string };
  /** target_uuid is required here: the selected photo must be the master (PRD section 6.6 step 1). 2-4 names, each "AVG …". */
  create_virtual_copies: { target_uuid: string; names: string[] };
  /** Refused with identity_mismatch when the photo found differs from a field given in `expect`. */
  select_photo: { uuid: string; expect?: { copy_name?: string; master_local_id?: number; is_virtual_copy?: boolean } };
};
