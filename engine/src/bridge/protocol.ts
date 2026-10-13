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
// Develop.lua, Preview.lua, Catalog.lua, Photos.lua, Library.lua (with KeywordTree.lua), Prefs.lua,
// Hud.lua (with hud-protocol.ts) and Masks.lua (with MaskProbe.lua).

import { z } from "zod";
import type { HudUpdatePayload } from "./hud-protocol.js";
import { METADATA_RESULTS } from "./protocol-metadata.js";
import { COMMAND_RESULTS } from "./protocol-results.js";

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

/** One entry of a findPhotos search descriptor (engine\src\library\search.ts builds them). */
export type SearchCriterion = { criteria: string; operation: string; value: string | number; value2?: string };

/** Every command the engine sends, by name, with the schema of its result (protocol-results.ts, protocol-metadata.ts). */
export const COMMANDS = { ...COMMAND_RESULTS, ...METADATA_RESULTS };

export type CommandName = keyof typeof COMMANDS;
export type CommandResult<N extends CommandName> = z.infer<(typeof COMMANDS)[N]>;

/**
 * What the plugin's AI-mask guard reads (plugin 0.16.0, Pending.lua): the entries asked for, by their
 * CorrectionID, and the table's field names, which only the engine's params hold (rule 03; params\mask-ops.ts aiWatch).
 */
export type AiWatch = { ids: string[]; table: string; id: string; masks: string; digest: string; error: string };

/** What the plugin checks a photo found by uuid against (Photos.lua); each field optional. */
export type PhotoExpect = { copy_name?: string; master_local_id?: number; is_virtual_copy?: boolean };

/**
 * The photo a command acts on. `target_uuid`: the selected photo, refused if another is selected.
 * `photo_uuid` (plugin 0.4.0): the photo with that uuid, selected or not, checked against `expect`;
 * the selection is not touched (Develop.lua target()). Not both.
 */
type Target = { target_uuid?: string; photo_uuid?: never; expect?: never } | { photo_uuid: string; expect?: PhotoExpect; target_uuid?: never };

export type CommandPayloads = {
  hello: { protocol: number; engine_version: string };
  ping: { nonce?: string };
  get_context: Target;
  get_settings: Target;
  /** `put_back` (plugin 0.19.0): values the photo held before, let through to a photo whose original is missing (Develop.lua applySettings). */
  apply_settings: Target & { settings: Record<string, unknown>; history_name: string; put_back?: boolean };
  /** long_edge in pixels; quality 0-100 (the plugin converts it to the export setting's scale). */
  export_preview: Target & { long_edge: number; quality: number };
  create_snapshot: Target & { name: string };
  apply_snapshot: Target & { snapshot_id: string };
  /** target_uuid is required here: the selected photo must be the master (PRD section 6.6 step 1). 2-4 names, each "AVG …". */
  create_virtual_copies: { target_uuid: string; names: string[] };
  /** Refused with identity_mismatch when the photo found differs from a field given in `expect`. */
  select_photo: { uuid: string; expect?: PhotoExpect };
  /** max: how many photos to describe, 1-500 (the plugin's default 100). Refused with no_target_photo when none is selected. */
  get_selection: { max?: number };
  /** The criteria intersected; with `collection_id`, only that collection's photos; with `folder` (plugin 0.22.0, a full path), only that folder's. limit 1-500. */
  search_photos: { criteria: SearchCriterion[]; collection_id?: number; folder?: string; include_subfolders?: boolean; offset: number; limit: number };
  list_collections: Record<string, never>;
  /** query: only paths that contain it, case aside. limit 1-500. */
  list_keywords: { query?: string; offset: number; limit: number };
  /** rating 0-5, 0 clears it. Refused with unknown_photo when no photo has the uuid. */
  set_rating: { photo_uuid: string; rating: number };
  /** Keyword names or paths (library\keywords.ts); at least one between add and remove. */
  set_keywords: { photo_uuid: string; add: string[]; remove: string[] };
  /** A position in decimal degrees, or clear: true to remove the photo's position. */
  set_gps: { photo_uuid: string; latitude: number; longitude: number } | { photo_uuid: string; clear: true };
  /** Plugin 0.22.0 (Metadata.lua): the pick flag, 1 picked, 0 none, -1 rejected. */
  set_flag: { photo_uuid: string; flag: -1 | 0 | 1 };
  /** Plugin 0.22.0: at least one field; "" empties it. */
  set_iptc: { photo_uuid: string; title?: string; caption?: string; headline?: string };
  /** Plugin 0.22.0: one photo's title, caption, headline, flag, keywords, gps and stack. */
  get_metadata: { photo_uuid: string };
  /** set_path: the collection sets, top level first; [] for the top level. */
  create_collection: { name: string; set_path: string[] };
  /** 1-500 uuids; remove: true takes them out. Refused with smart_collection for a smart collection. */
  collection_photos: { collection_id: number; uuids: string[]; remove: boolean };
  /** quality 1-100 (JPEG), bit_depth 8 or 16 (PNG, TIFF); long_edge, or width and height together, or neither (full size). */
  export_photo: {
    photo_uuid: string;
    format: "jpeg" | "png" | "tiff" | "original";
    quality?: number;
    bit_depth?: 8 | 16;
    long_edge?: number;
    width?: number;
    height?: number;
  };
  /** An absolute file path; added in place. */
  import_photo: { path: string };
  get_prefs: Record<string, never>;
  /** Refused with bad_request when a field is unknown or of the wrong type (hud-protocol.ts). */
  hud_update: HudUpdatePayload;
  /** Plugin 0.18.0: a Deck is connected to the engine (true) or not. */
  hud_deck: { connected: boolean };
  /** Plugin 0.11.0: the photo with that uuid, checked against `expect`; the selection is not touched. `watch`: plugin 0.16.0 (params\mask-ops.ts aiWatch). */
  update_ai_settings: { photo_uuid: string; expect?: PhotoExpect; request_id?: string; watch?: AiWatch };
  /** Plugin 0.12.0: on the selected photo, refused with target_mismatch unless it is target_uuid's; waits up to wait_seconds (1-15, default 12) for the mask after createNewMask; switches Lightroom to Develop. */
  create_ai_mask_dc: { target_uuid: string; subtype: string; wait_seconds?: number };
  probe_write_gate: Record<string, never>;
  clear_pending_ai: { photo_uuid: string };
};
