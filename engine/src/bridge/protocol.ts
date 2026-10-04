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
//
// Lua cannot tell an empty array from an empty object, and the plugin's Json.lua writes every empty
// table as []. Payload schemas below never require a non-empty table to be an object.

import { z } from "zod";
import { hudUpdateResultSchema, type HudUpdatePayload } from "./hud-protocol.js";

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
  /**
   * Plugin 0.16.0 (Bridge.lua): when the plugin's Lua state first loaded the bridge; another value at a
   * reconnect means Lightroom restarted [inference: a Reload Plug-in keeps the Lua state, a restart does not]
   * (session\restart.ts, D16).
   */
  process_started_at: z.string().optional(),
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
  /** Plugin 0.4.0 (Photos.lua describe). */
  filename: z.string().optional(),
  /**
   * Plugin 0.8.0: absent for an unrated photo, whose getRawMetadata("rating") is nil [handle:
   * https://lrc.mcor.dev/modules/LrPhoto.html, "either nil or number of stars"; vault LR_SDK_NOTES
   * "Recorded in Phase 2", metadata keys].
   */
  rating: z.number().optional(),
  /**
   * Plugin 0.8.0: getFormattedMetadata("dateTimeOriginal"), e.g. "09/15/2005 17:32:50" [handle: the
   * LrPhoto page above]; on Jim's PC "9/6/2026 11:12:07.000 AM" [handle:
   * docs\reports\phase6\catalog-tools-check\check.txt section 4, `selection`].
   */
  capture_time: z.string().optional(),
};

/** A photo in a listing (get_selection, search_photos). A photo whose uuid could not be read has none. */
const listedPhoto = z.object({ ...photoIdentity, uuid: z.string().optional() });

/**
 * One step of create_ai_mask_dc (MaskProbe.lua record()): an LrDevelopController or LrApplicationView
 * call, its result as the SDK gave it (functions and userdata as "<type>"), or the error it raised.
 */
const probeStep = z.object({ step: z.string(), ok: z.boolean(), result: z.unknown().optional(), error: z.string().optional(), ms: z.number() });

/** One entry of a findPhotos search descriptor (engine\src\library\search.ts builds them). */
export type SearchCriterion = { criteria: string; operation: string; value: string | number; value2?: string };

/**
 * A photo's GPS position as set_gps reads it (plugin 0.10.0, Library.lua gpsOf), `false` for none:
 * a Lua table cannot hold a nil field, so "none" needs a value the plugin's Json.lua writes [inference].
 */
const gpsWire = z.union([z.object({ latitude: z.number(), longitude: z.number() }), z.literal(false)]);

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
  // Plugin 0.4.0 (Catalog.lua): the selected photos, the active one first; `count` is how many are
  // selected, `photos` at most the `max` asked for. A photo whose uuid could not be read has none.
  get_selection: z.object({ count: z.number(), photos: z.array(listedPhoto) }),
  // Plugin 0.8.0 (Library.lua): `count` matched, `photos` from offset + 1, at most `limit`.
  search_photos: z.object({ count: z.number(), photos: z.array(listedPhoto) }),
  // Every collection; `set_path` names its collection sets, "Set / Subset", absent at the top level.
  list_collections: z.object({
    collections: z.array(
      z.object({ local_id: z.number(), name: z.string(), set_path: z.string().optional(), smart: z.boolean(), photo_count: z.number() }),
    ),
  }),
  // One photo, read before and after the write (0: no rating); not written when it already held it.
  // Once `before` is read the plugin answers ok: a write gate that raised gives `write_error`, a
  // read-back that failed gives `after_error` and no `after` (Greptile, PR #57).
  set_rating: z.object({
    ...targeted,
    filename: z.string().optional(),
    before: z.number(),
    after: z.number().optional(),
    write_error: z.string().optional(),
    after_error: z.string().optional(),
  }),
  // Plugin 0.10.0 (Library.lua listKeywords): the keyword tree's paths ("Parent|Child"), a parent
  // before its children, siblings by name; `count` matched the query, `keywords` from offset + 1, at
  // most `limit`.
  list_keywords: z.object({ count: z.number(), keywords: z.array(z.string()) }),
  // One photo's keywords before and after; not written when nothing would change. As set_rating.
  // Plain names up to plugin 0.9.0; paths ("Parent|Child"; a top-level keyword is its name) from 0.10.0.
  set_keywords: z.object({
    ...targeted,
    filename: z.string().optional(),
    before: z.array(z.string()),
    after: z.array(z.string()).optional(),
    write_error: z.string().optional(),
    after_error: z.string().optional(),
  }),
  // Plugin 0.10.0: one photo's GPS position before and after; not written when it already held it.
  // As set_rating.
  set_gps: z.object({
    ...targeted,
    filename: z.string().optional(),
    before: gpsWire,
    after: gpsWire.optional(),
    write_error: z.string().optional(),
    after_error: z.string().optional(),
  }),
  // Plugin 0.17.0 (Transfer.lua, GitHub issue #55). create_collection: the collection asked for, new or
  // found (`created` false); `set_path` as list_collections gives it.
  create_collection: z.object({
    local_id: z.number(),
    name: z.string(),
    set_path: z.string().optional(),
    smart: z.boolean(),
    photo_count: z.number(),
    created: z.boolean(),
  }),
  // collection_photos: which of the photos found were in the collection before and after the add or
  // removal; once `before_in` is read the plugin answers ok, as set_rating does.
  collection_photos: z.object({
    collection_id: z.number(),
    name: z.string(),
    before_in: z.array(z.string()),
    after_in: z.array(z.string()).optional(),
    not_found: z.array(z.string()),
    write_error: z.string().optional(),
    after_error: z.string().optional(),
  }),
  // export_photo: the files Lightroom wrote for one photo, all in `dir`, a new folder under
  // <temp>\LrC-AVG\exports that the engine empties into the user's folder (library\files.ts).
  export_photo: z.object({
    uuid: z.string(),
    filename: z.string().optional(),
    dir: z.string().min(1),
    files: z.array(z.string().min(1)).min(1),
    export_ms: z.number(),
  }),
  // import_photo: the photo at that path, added now or already in the catalog.
  import_photo: z.object({ status: z.enum(["imported", "already"]), uuid: z.string(), filename: z.string().optional() }),
  // Plugin 0.5.0 (Prefs.lua getPrefs): the settings page's values, each already checked by the
  // plugin, under their wire names. The engine checks each field again on its own
  // (settings\page.ts parsePage), so one bad field costs only that field; `invalid` lists what the
  // plugin replaced by its default.
  get_prefs: z.looseObject({
    invalid: z.array(z.looseObject({ key: z.string(), reason: z.string() })),
  }),
  // Plugin 0.6.0 (Hud.lua update): the HUD's state; the contract is in hud-protocol.ts.
  hud_update: hudUpdateResultSchema,
  // Plugin 0.11.0 (Masks.lua, issue #59). update_ai_settings: photo:updateAISettings() in its own write
  // gate. A Lightroom without the call answers feature_unavailable. Up to 0.12.0 it waited for the
  // update (call_ms, `gate` what withWriteAccessDo returned); 0.13.0 used an asynchronous gate, which
  // still waited for the update when the catalog was free (`status` "executed"); from 0.14.0 the update
  // runs in the plugin's own task and the answer comes at once [unverified until capture 5]: `status` "started", `state` what the task
  // did so far (started, running, done, failed, abandoned; probe_write_gate reports it later). From 0.16.0
  // (Pending.lua, D16) the payload's `watch` makes the plugin refuse every write to the photo, with
  // ai_compute_pending, until the entries it lists show a digest or an ErrorReason; `guarded` says it took.
  update_ai_settings: z.object({
    ...targeted,
    status: z.string().optional(),
    state: z.string().optional(),
    guarded: z.boolean().optional(),
    call_ms: z.number().optional(),
    command_ms: z.number().optional(),
    gate: z.string().optional(),
  }),
  // create_ai_mask_dc (plugin 0.12.0): LrDevelopController.createNewMask("aiSelection", subtype) on the
  // selected photo (the target), and the mask ids getAllMasks lists that were not there before it
  // (`new_ids`, each a table CorrectionID [handle: docs\reports\phase6\masks-capture\12_probe_dc.json
  // getAllMasks_after_sky against getDevelopSettings_after_sky]); `steps` say whether createNewMask
  // itself ran; `stopped` says why it ran no further step (the selection changed, or its own deadline
  // passed). It switches to Develop and does not switch back [inference: no step of it leaves Develop].
  create_ai_mask_dc: z.object({
    uuid: z.string().optional(),
    filename: z.string().optional(),
    steps: z.array(probeStep),
    stopped: z.string().optional(),
    new_ids: z.array(z.string()),
    waited_ms: z.number(),
  }),
  // probe_write_gate (plugin 0.13.0, PR C step 2b): an empty write gate with a 0.5 s timeout; `status`
  // "executed" (the catalog is free) or "aborted" (another write holds it, such as a Lightroom dialog
  // inside the update's gate), and the last update_ai_settings' record (Masks.lua).
  probe_write_gate: z.object({
    status: z.string(),
    ms: z.number(),
    update: z.object({ uuid: z.string().optional(), request_id: z.string().optional(), state: z.string(), error: z.string().optional() }).optional(),
  }),
} as const;

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
  apply_settings: Target & { settings: Record<string, unknown>; history_name: string };
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
  /** The criteria intersected; with `collection_id`, only that collection's photos. limit 1-500. */
  search_photos: { criteria: SearchCriterion[]; collection_id?: number; offset: number; limit: number };
  list_collections: Record<string, never>;
  /** query: only paths that contain it, case aside. limit 1-500. */
  list_keywords: { query?: string; offset: number; limit: number };
  /** rating 0-5, 0 clears it. Refused with unknown_photo when no photo has the uuid. */
  set_rating: { photo_uuid: string; rating: number };
  /** Keyword names or paths (library\keywords.ts); at least one between add and remove. */
  set_keywords: { photo_uuid: string; add: string[]; remove: string[] };
  /** A position in decimal degrees, or clear: true to remove the photo's position. */
  set_gps: { photo_uuid: string; latitude: number; longitude: number } | { photo_uuid: string; clear: true };
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
  /** Plugin 0.11.0: the photo with that uuid, checked against `expect`; the selection is not touched. `watch`: plugin 0.16.0 (params\mask-ops.ts aiWatch). */
  update_ai_settings: { photo_uuid: string; expect?: PhotoExpect; request_id?: string; watch?: AiWatch };
  /** Plugin 0.12.0: on the selected photo, refused with target_mismatch unless it is target_uuid's; waits up to wait_seconds (1-15, default 12) for the mask after createNewMask; switches Lightroom to Develop. */
  create_ai_mask_dc: { target_uuid: string; subtype: string; wait_seconds?: number };
  probe_write_gate: Record<string, never>;
};
