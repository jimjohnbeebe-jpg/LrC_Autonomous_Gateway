// The MCP definitions of the Develop parity tools (issue #214; tools-develop.ts, tools-snapshots.ts): lr_apply_auto,
// lr_reset, lr_set_process_version, lr_list_snapshots, lr_create_snapshot, lr_apply_snapshot, lr_delete_snapshot and
// lr_create_virtual_copies; lr_set_develop_settings, lr_undo_last_step and lr_remove_photos (decisions D1-D3 of epic
// #207; tools-remove.ts). Upstream's names, for users of both: apply_auto_adjustments, reset_develop_adjustments,
// set_process_version, list/create/apply/delete_develop_snapshot, create_virtual_copies, set_develop_settings,
// undo_last_step, remove_photos_from_catalog [upstream claim: Automaat/
// lightroom-mcp 1040453, server\src\tool-contracts.ts].

import { z } from "zod";
import { TIMED, type ToolDef } from "./defs-shared.js";
import { deleteEmptyMasks, setDevelopSettings, undoLastStep } from "./tools-develop.js";
import { removePhotos } from "./tools-remove.js";

const distinct = (list: readonly unknown[]): boolean => new Set(list).size === list.length;
const uuids = (max: number) =>
  z
    .array(z.string().min(1))
    .min(1)
    .max(max)
    .refine(distinct, "uuids must differ")
    .describe(`the photos' uuids, 1-${max} (from lr_search_photos, lr_get_selected_photos or lr_get_active_photo_context)`);
const uuid = z.string().min(1).describe("the photo's uuid (from lr_search_photos, lr_get_selected_photos or lr_get_active_photo_context)");
const confirm = z.literal(true).describe("must be true: the user agreed to this change");
const snapshotId = z.string().min(1).describe("the snapshot's id, from lr_list_snapshots");

const autoArgs = z
  .object({
    uuids: uuids(100),
    tone: z.boolean().optional().describe("Lightroom's Auto Tone (Basic panel Auto): exposure, contrast, highlights, shadows, whites, blacks, and more"),
    white_balance: z.boolean().optional().describe("Lightroom's Auto white balance"),
  })
  .refine((a) => a.tone === true || a.white_balance === true, "set tone or white_balance (or both) to true");
const resetArgs = z.object({ uuids: uuids(100), confirm });
const emptyMasksArgs = z.object({ uuids: uuids(100) });
const versionArgs = z.object({
  uuids: uuids(100),
  version: z.number().int().min(1).max(6).describe("Lightroom's process Version 1-6 (Settings > Process); 6 is the current one, and this engine edits photos at 6 and 5"),
  confirm,
});
const listArgs = z.object({ uuid });
const createArgs = z.object({ uuid, name: z.string().trim().min(1).max(200).describe('the snapshot\'s name; "AVG " is put in front unless it starts with it') });
const snapshotArgs = z.object({ uuid, snapshot_id: snapshotId, confirm });
const sdkSettingsArgs = z.object({
  uuids: uuids(100),
  settings: z
    .record(z.string().min(1), z.union([z.number(), z.boolean(), z.array(z.number())]))
    .refine((s) => Object.keys(s).length > 0, "settings must name at least one key")
    .describe('Lightroom SDK key -> the value to set, absolute (e.g. {"Exposure2012": 0.5, "LensManualDistortionAmount": 10}); a point curve as [x0, y0, x1, y1, ...]'),
});
const undoArgs = z.object({ confirm: z.literal(true).describe("must be true: the user agreed to undo whatever Lightroom's last step is") });
const removeArgs = z.object({ uuids: uuids(100), confirm: z.literal(true).describe("must be true: the user agreed to remove these photos from the catalog") });
const copiesArgs = z.object({
  uuids: uuids(25),
  copy_name: z.string().trim().min(1).max(200).optional().describe("the name of each new copy (Lightroom's Copy Name); omitted, Lightroom names it"),
});

const PER_PHOTO =
  "Each photo is made the active one in Develop in turn; Lightroom's module, folder or collection and selection are put back after each. " +
  "Each photo's result names what `changed` (by setting name; by Lightroom's own key names, `names: \"sdk\"`, when the photo's process version is " +
  "older than this engine reads), with the `snapshot` taken just before, which puts it back; `undo` says how. Not while a session is open, and a " +
  "photo a stopped session left open is refused.";
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } as const;

export const DEVELOP_DEFS: ToolDef[] = [
  {
    name: "lr_apply_auto",
    title: "Apply Lightroom's Auto",
    description:
      "Apply Lightroom's own Auto Tone and/or Auto white balance to photos named by uuid, as its Basic panel buttons do. Each photo's `status`: " +
      `applied, unchanged (Auto gave the settings it had) or failed (\`reason\`). Use it as a baseline to compare against. ${PER_PHOTO} ${TIMED}`,
    schema: autoArgs,
    annotations: WRITE,
    run: (tools, args) => tools.applyAuto(args as z.infer<typeof autoArgs>),
  },
  // "also clears the crop and the masks" [upstream claim: tool-contracts.ts reset_develop_adjustments, PR #410]; [unverified] until develop:check.
  {
    name: "lr_reset",
    title: "Reset Develop settings",
    description:
      "Lightroom's Reset on photos named by uuid: every Develop setting back to Lightroom's default, which also clears the crop and the masks. " +
      `Ask the user first and pass confirm: true. Each photo's \`status\`: reset or failed. ${PER_PHOTO} ${TIMED}`,
    schema: resetArgs,
    annotations: DESTRUCTIVE,
    run: (tools, args) => tools.resetDevelop(args as z.infer<typeof resetArgs>),
  },
  // "masks with no component tools" [upstream claim: Automaat/lightroom-mcp 1040453, server\src\tool-contracts.ts
  // delete_empty_masks]; what Lightroom deletes is [unverified]: no current check makes an empty mask (docs\reports\phase11\MASK-PARITY.md).
  {
    name: "lr_delete_empty_masks",
    title: "Delete empty masks",
    description:
      "Lightroom's own clean-up of empty masks (masks left with no part, such as after every part was removed) on photos named by uuid " +
      "(Lightroom Classic 14 or later, else FEATURE_UNAVAILABLE). Lightroom decides what is empty; masks with a part stay. Each photo's `status`: " +
      "deleted (with `masks` before and after and the `snapshot` taken just before) or unchanged (nothing was empty, no snapshot kept). The photos are " +
      `not opened in Develop. Not while a session is open, and a photo a stopped session left open is refused; \`undo\` says how to put a photo back. ${TIMED}`,
    schema: emptyMasksArgs,
    annotations: DESTRUCTIVE,
    run: (tools, args) => tools.call(deleteEmptyMasks, args as z.infer<typeof emptyMasksArgs>),
  },
  {
    name: "lr_set_process_version",
    title: "Set the process version",
    description:
      "Set the process version (Version 1-6) of photos named by uuid, as Develop's Settings > Process does; updating an old photo to Version 6 lets " +
      "the sessions edit it. A new version can change how the photo looks: ask the user first and pass confirm: true. A lower version on a photo with " +
      "masks is refused (`status` skipped). Each photo's `status`: changed, unchanged, skipped or failed, with `previous` and `actual` " +
      `(Lightroom's "Version N"). ${PER_PHOTO} ${TIMED}`,
    schema: versionArgs,
    annotations: DESTRUCTIVE,
    run: (tools, args) => tools.setProcessVersion(args as z.infer<typeof versionArgs>),
  },
  {
    name: "lr_list_snapshots",
    title: "List a photo's snapshots",
    description:
      "List the Develop snapshots of a photo named by uuid: id and name; `by_avg` true for those LrC-AVG made (\"AVG …\", e.g. a session's " +
      "\"AVG pre-session …\"); `session` names the session that puts the photo back with it (open, or left open by an engine that stopped). Changes nothing.",
    schema: listArgs,
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (tools, args) => tools.listSnapshots(args as z.infer<typeof listArgs>),
  },
  {
    name: "lr_create_snapshot",
    title: "Create a snapshot",
    description:
      "Save a photo's current Develop settings as a snapshot (Develop, Snapshots panel), named \"AVG <name>\". A name the photo already has is " +
      "refused, nothing changed. Returns its id, for lr_apply_snapshot. Not while a session is open.",
    schema: createArgs,
    annotations: WRITE,
    run: (tools, args) => tools.createSnapshot(args as z.infer<typeof createArgs>),
  },
  {
    name: "lr_apply_snapshot",
    title: "Apply a snapshot",
    description:
      "Put a photo's Develop settings back to one of its snapshots (ids from lr_list_snapshots), replacing what it has now: ask the user first and pass " +
      "confirm: true. A snapshot of the settings just before (`snapshot`) is taken first, so this can be undone; `changed` names what moved. " +
      "Lightroom shows the photo in Develop meanwhile, then its module and selection are put back. Not while a session is open.",
    schema: snapshotArgs,
    annotations: DESTRUCTIVE,
    run: (tools, args) => tools.applySnapshot(args as z.infer<typeof snapshotArgs>),
  },
  {
    name: "lr_delete_snapshot",
    title: "Delete a snapshot",
    description:
      "Delete one snapshot of a photo (id from lr_list_snapshots); the photo's settings do not change, but the snapshot cannot be brought back by a " +
      "tool: ask the user first and pass confirm: true. A snapshot a session puts the photo back with is refused (SNAPSHOT_IN_USE). Not while a session is open.",
    schema: snapshotArgs,
    annotations: DESTRUCTIVE,
    run: (tools, args) => tools.deleteSnapshot(args as z.infer<typeof snapshotArgs>),
  },
  {
    name: "lr_create_virtual_copies",
    title: "Create virtual copies",
    description:
      "Make one virtual copy of each photo named by uuid (up to 25), named copy_name or by Lightroom. Each photo's `copy_uuid` is the new copy, " +
      "for the other tools; `status` copied or failed (`reason`). The photo is selected for the copy, then Lightroom's folder or collection and " +
      `selection are put back. The masters do not change. Not while a session is open. ${TIMED}`,
    schema: copiesArgs,
    annotations: WRITE,
    run: (tools, args) => tools.createVirtualCopies(args as z.infer<typeof copiesArgs>),
  },
  // Decisions D1-D3 of epic #207 [stated: Jim, 2026-10-28, "Go with recommendations"]; upstream's set_develop_settings,
  // undo_last_step and remove_photos_from_catalog [upstream claim: Automaat/lightroom-mcp 1040453, tool-contracts.ts].
  {
    name: "lr_set_develop_settings",
    title: "Set Develop settings by Lightroom key",
    description:
      "Set Develop settings on photos named by uuid by Lightroom's own SDK key names, as absolute values (lr_get_metadata raw: true shows a photo's). " +
      "Only keys Lightroom reports for the photo's kind (raw or rendered) are taken, case-sensitive. A key the canonical names cover is checked as lr_step " +
      "checks it (type and range; Temperature/Tint also set white balance Custom; a point curve on an HDR photo goes to its HDR key). Other number and " +
      "true/false keys are written as given and listed in `unranged`: no range is known, so Lightroom decides. Text and table keys (profile, " +
      "ProcessVersion, masks) are refused, named with the tool that sets them. Prefer lr_step in a session: this has no per-pass limits or clipping " +
      "guard. Each photo is written as one History step \"AVG set develop settings …\" and read back; `status` set, or not_taken when Lightroom did " +
      `not take a key as written (\`not_taken\`), and the photo was then put back from the snapshot. ${PER_PHOTO} ${TIMED}`,
    schema: sdkSettingsArgs,
    annotations: WRITE,
    run: (tools, args) => tools.call(setDevelopSettings, args as z.infer<typeof sdkSettingsArgs>),
  },
  {
    name: "lr_undo_last_step",
    title: "Undo Lightroom's last step",
    description:
      "Undo exactly one step of Lightroom's own history (Edit > Undo). The history is Lightroom's, shared with the user and other plug-ins: this " +
      "undoes whatever is last, which may not be an LrC-AVG change, and does not say what it was. Ask the user first and pass confirm: true. " +
      "Refused while an edit session is open or one was left open (end it with lr_end_session; to undo a pass, use the session's own revert). " +
      "Right after this engine's lr_set_develop_settings call, it instead puts that photo back from the write's \"AVG pre-set\" snapshot " +
      "(`via`: \"snapshot\") and reads it back: `last_write` says whether that write is undone (`reverted`), and when it is not, which " +
      "settings still differ. Returns `undone` and, for Edit > Undo, `can_undo` (whether Lightroom has another step to undo).",
    schema: undoArgs,
    annotations: DESTRUCTIVE,
    run: (tools, args) => tools.call(undoLastStep, args as z.infer<typeof undoArgs>),
  },
  {
    name: "lr_remove_photos",
    title: "Remove photos from the catalog",
    description:
      "Remove photos named by uuid (1-100) from the Lightroom catalog (Lightroom Classic 14.3 or later, else FEATURE_UNAVAILABLE). Their catalog edits " +
      "and metadata are lost; the files stay on disk. Ask the user first and pass confirm: true. A master is refused unless every one of its virtual " +
      "copies is named too (COPIES_NOT_INCLUDED, nothing removed). Lightroom shows the Library grid on All Photographs meanwhile, then its module, " +
      "folder or collection and the surviving selection are put back; if Lightroom has not removed them within 10 s (it may be asking the user to " +
      "confirm), `status` is failed and the grid stays on exactly those photos. Returns `removed`, `not_removed` and `missing` (uuids no photo has). " +
      "Not while a session is open, and a photo a stopped session left open is refused. Variants copies the user did not pick can be removed " +
      "this way after lr_end_session.",
    schema: removeArgs,
    annotations: DESTRUCTIVE,
    run: (tools, args) => tools.call(removePhotos, args as z.infer<typeof removeArgs>),
  },
];
