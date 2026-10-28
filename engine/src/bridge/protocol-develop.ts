// Result schemas of the Develop parity commands (issue #214; plugin DevelopTools.lua, Snapshots.lua, Copies.lua),
// merged into COMMANDS by protocol.ts. Each answers for one photo, named by photo_uuid. It imports nothing from
// protocol-results.ts, which sits in a known import cycle with protocol.ts (.dependency-cruiser-known-violations.json).

import { z } from "zod";

/** A getDevelopSettings() table as the plugin sends it (protocol-results.ts sdkSettingsSchema). */
const sdkSettingsSchema = z.record(z.string(), z.unknown());
/** Lua sends an empty table as [] (Json.lua). */
const values = z.preprocess((v) => (Array.isArray(v) && v.length === 0 ? {} : v), z.record(z.string(), z.unknown()));
const snapshot = z.object({ id: z.string(), name: z.string() });
/** One photo through DevelopTools.lua: its outcome, the snapshot taken before a change, and the settings after. */
const developAnswer = {
  uuid: z.string(),
  reason: z.string().optional(),
  snapshot: snapshot.optional(),
  read_back: sdkSettingsSchema,
  ms: z.number(),
};

export const DEVELOP_RESULTS = {
  apply_auto: z.object({
    ...developAnswer,
    status: z.enum(["applied", "unchanged", "skipped", "failed"]),
    /** Each part asked for: tone, white_balance. */
    parts: z.record(z.string(), z.string()).optional(),
  }),
  reset_develop: z.object({ ...developAnswer, status: z.enum(["reset", "skipped", "failed"]) }),
  set_process_version: z.object({
    ...developAnswer,
    status: z.enum(["changed", "unchanged", "skipped", "failed"]),
    /** LrDevelopController.getProcessVersion() before and after: "Version 1" .. "Version 6". */
    previous: z.string().optional(),
    actual: z.string().optional(),
  }),
  // Issue #217 row 1 (MaskClean.lua): "unchanged" when the settings read back as before; its snapshot is then deleted again.
  delete_empty_masks: z.object({ ...developAnswer, status: z.enum(["deleted", "unchanged"]) }),
  // Issue #217 (MaskControl.lua): getValue of every param named, before and after; `written`: the params it set; `index`: the swatch touched.
  mask_controller: z.object({ uuid: z.string(), mask_id: z.string(), before: values, after: values, written: z.array(z.string()), index: z.number().optional(), settled: z.boolean(), ms: z.number() }),
  list_snapshots: z.object({
    uuid: z.string(),
    snapshots: z.array(z.object({ id: z.string(), name: z.string(), id_global: z.string().optional() })),
  }),
  delete_snapshot: z.object({ uuid: z.string(), snapshot_id: z.string() }),
  // Decisions D1-D3 of epic #207 (DevelopTools.lua setSettings, undoLastStep; Remove.lua).
  set_develop_settings: z.object({ ...developAnswer, status: z.enum(["set", "skipped", "failed"]) }),
  undo_last_step: z.object({ undone: z.boolean(), can_undo: z.boolean() }),
  remove_photos: z.object({
    status: z.enum(["removed", "failed"]),
    reason: z.string().optional(),
    removed: z.array(z.string()),
    not_removed: z.array(z.string()),
    /** uuids no photo in the catalog has. */
    missing: z.array(z.string()),
  }),
  copy_photo: z.object({
    uuid: z.string(),
    status: z.enum(["copied", "failed", "skipped"]),
    /** The new copy as Photos.describe reads it (create_virtual_copies' copies in protocol-results.ts). */
    copy: z.looseObject({ local_id: z.number(), uuid: z.string().optional(), copy_name: z.string().optional(), identity_ok: z.boolean() }).optional(),
    code: z.string().optional(),
    reason: z.string().optional(),
  }),
} as const;
