// The engine's tools (contracts in MCP_TOOLS), one module per group:
//   context  (tools-context.ts): lr_get_active_photo_context, lr_get_preview, lr_get_metrics (Phase 2;
//            Phase 3 added `session_id` and `region` to lr_get_preview, `session_id` to lr_get_metrics).
//   session  (tools-session.ts): lr_begin_session, lr_step, lr_probe, lr_set_regions, lr_end_session,
//            lr_get_session_log (Phase 3; the loop is session\manager.ts); lr_select_variant (Phase 4);
//            lr_approve_pass (Phase 5); lr_list_masks, lr_create_mask, lr_edit_mask, lr_delete_mask
//            (engine 0.16.0, GitHub issue #59; their definitions are defs-masks.ts).
//   intents  (tools-intents.ts): lr_list_intents, lr_get_intent, lr_save_intent (Phase 3).
//   propagation (tools-propagation.ts): lr_sync_series (Phase 4; the sync is sync\sync.ts) and
//            lr_create_preset_from_active (Phase 4; the preset is presets\create.ts).
//   presets  (tools-presets.ts): lr_list_presets, lr_get_preset, lr_compare_presets, lr_export_preset,
//            lr_apply_preset, lr_create_checkpoint (GitHub issue #215; presets\lightroom.ts and its neighbours).
//   catalog (tools-catalog.ts): lr_search_photos, lr_get_selected_photos, lr_list_collections,
//            lr_set_rating, lr_set_keywords (Phase 6, kept from Automaat; library\); lr_list_keywords
//            and lr_set_gps (GitHub issue #60, from later Automaat commits).
//   metadata (tools-metadata.ts): lr_set_flag, lr_set_iptc, lr_get_metadata (GitHub issues #111,
//            #112, #139; library\metadata.ts).
//   files    (tools-collections.ts, tools-files.ts): lr_create_collection, lr_add_to_collection,
//            lr_export_photos, lr_import_photos (GitHub issue #55; library\files.ts).
//   develop  (tools-develop.ts, tools-snapshots.ts): lr_apply_auto, lr_reset, lr_set_process_version, the snapshot
//            tools and lr_create_virtual_copies (GitHub issue #214).
//   write    (tools-write.ts): setSettings, Phase 2's lr_set_settings, for the Phase 2 check only.
// What they share is in tools-shared.ts. The MCP definitions are the defs-*.ts modules, by the same
// groups.
// This class does not depend on the MCP SDK: server.ts wraps it, and the checks call it directly, so
// both go through the same code. Every call is written to the tool log.

import type { Deck, HudPublisher } from "../hud/index.js";
import type { ApproveArgs, BeginArgs, CreateMaskArgs, DeleteMaskArgs, EditMaskArgs, EndArgs, ListMasksArgs, ProbeArgs, RegionArgs, SelectArgs, SessionManager, StepArgs } from "../session/index.js";
import type { ToolLogPendingRecord } from "../log/index.js";
import { callLogFields } from "./call-context.js";
import type { ToolError } from "./errors.js";
import {
  getSelectedPhotos,
  listCollections,
  listKeywords,
  searchPhotos,
  setGps,
  setKeywords,
  setRating,
  type ListKeywordsArgs,
  type SearchPhotosArgs,
  type SetGpsArgs,
  type SetKeywordsArgs,
  type SetRatingArgs,
} from "./tools-catalog.js";
import { addToCollection, createCollection, type AddToCollectionArgs, type CreateCollectionArgs } from "./tools-collections.js";
import { getActivePhotoContext, getMetrics, getPreview, type MetricsArgs, type PreviewArgs } from "./tools-context.js";
import { applyDenoise, type ApplyDenoiseArgs } from "./tools-denoise.js";
import { applyAuto, resetDevelop, setProcessVersion, type ApplyAutoArgs, type ProcessVersionArgs, type ResetArgs } from "./tools-develop.js";
import {
  applySnapshot,
  createSnapshot,
  createVirtualCopies,
  deleteSnapshot,
  listSnapshots,
  type CreateSnapshotArgs,
  type SnapshotArgs,
  type SnapshotListArgs,
  type VirtualCopiesArgs,
} from "./tools-snapshots.js";
import { exportPhotos, importPhotos, type Budget, type ExportPhotosArgs, type ImportPhotosArgs } from "./tools-files.js";
import { deleteIntent, getIntent, listIntents, saveIntent, type DeleteIntentArgs, type SaveIntentArgs } from "./tools-intents.js";
import { getMetadata, setFlag, setIptc, type GetMetadataArgs, type SetFlagArgs, type SetIptcArgs } from "./tools-metadata.js";
import * as presets from "./tools-presets.js";
import { createPresetFromActive, syncSeries, type CreatePresetArgs, type SyncSeriesArgs } from "./tools-propagation.js";
import { approvePass, beginSession, createMask, deleteMask, editMask, endSession, getSessionLog, listMasks, probe, selectVariant, setRegions, step } from "./tools-session.js";
import { createContext, type LastRender, type ToolContext, type ToolOutput, type ToolsDeps } from "./tools-shared.js";
import { setSettings, type SetSettingsArgs } from "./tools-write.js";

export class Tools {
  private readonly ctx: ToolContext;

  constructor(deps: ToolsDeps) {
    this.ctx = createContext(deps);
  }

  /** The session manager (for the checks); null when the engine was started without intents or a log folder. */
  sessionManager(): SessionManager | null {
    return this.ctx.sessions;
  }

  /** The last preview this engine rendered, if any. */
  lastRender(): LastRender | null {
    return this.ctx.last;
  }

  /** The HUD's updates (for the checks: its stats); null without sessions or with `hud: false`. */
  hud(): HudPublisher | null {
    return this.ctx.hud;
  }

  /** The Deck and its HUD channel (main.ts opens and closes the channel with the bridge lock); null without `deck`. */
  deck(): Deck | null {
    return this.ctx.deck;
  }

  /** The open session's HUD note while an operation runs, for MCP progress notifications (server.ts); null otherwise. */
  progressNote(): string | null {
    return this.ctx.sessions?.workNote() ?? null;
  }

  /** Log a call refused before it reached a tool (unknown tool, invalid arguments; server.ts). */
  recordRejected(tool: string, args: unknown, error: ToolError): void {
    this.ctx.deps.log?.append({ ts: this.ctx.now().toISOString(), tool, ok: false, duration_ms: 0, args, ...callLogFields(), error: error.body() });
  }

  /** Log a call deadline event (deadline.ts, issue #155): no `ok`, the run's own line follows when it ends. */
  recordPending(tool: string, args: unknown, pending: ToolLogPendingRecord["pending"]): void {
    this.ctx.deps.log?.append({ ts: this.ctx.now().toISOString(), tool, pending, args, ...callLogFields() });
  }

  // --- Context.

  getActivePhotoContext(): Promise<ToolOutput> {
    return getActivePhotoContext(this.ctx);
  }

  getPreview(args: PreviewArgs = {}): Promise<ToolOutput> {
    return getPreview(this.ctx, args);
  }

  getMetrics(args: MetricsArgs = {}): Promise<ToolOutput> {
    return getMetrics(this.ctx, args);
  }

  // --- Sessions.

  beginSession(args: BeginArgs): Promise<ToolOutput> {
    return beginSession(this.ctx, args);
  }

  step(args: StepArgs): Promise<ToolOutput> {
    return step(this.ctx, args);
  }

  selectVariant(args: SelectArgs): Promise<ToolOutput> {
    return selectVariant(this.ctx, args);
  }

  approvePass(args: ApproveArgs): Promise<ToolOutput> {
    return approvePass(this.ctx, args);
  }

  probe(args: ProbeArgs): Promise<ToolOutput> {
    return probe(this.ctx, args);
  }

  setRegions(args: RegionArgs): Promise<ToolOutput> {
    return setRegions(this.ctx, args);
  }

  endSession(args: EndArgs): Promise<ToolOutput> {
    return endSession(this.ctx, args);
  }

  getSessionLog(args: { session_id: string }): Promise<ToolOutput> {
    return getSessionLog(this.ctx, args);
  }

  // --- Masks, inside a session.

  listMasks(args: ListMasksArgs): Promise<ToolOutput> {
    return listMasks(this.ctx, args);
  }

  createMask(args: CreateMaskArgs): Promise<ToolOutput> {
    return createMask(this.ctx, args);
  }

  editMask(args: EditMaskArgs): Promise<ToolOutput> {
    return editMask(this.ctx, args);
  }

  deleteMask(args: DeleteMaskArgs): Promise<ToolOutput> {
    return deleteMask(this.ctx, args);
  }

  // --- Intents.

  listIntents(): Promise<ToolOutput> {
    return listIntents(this.ctx);
  }

  getIntent(args: { id: string }): Promise<ToolOutput> {
    return getIntent(this.ctx, args);
  }

  saveIntent(args: SaveIntentArgs): Promise<ToolOutput> {
    return saveIntent(this.ctx, args);
  }

  deleteIntent(args: DeleteIntentArgs): Promise<ToolOutput> {
    return deleteIntent(this.ctx, args);
  }

  // --- Propagation.

  syncSeries(args: SyncSeriesArgs): Promise<ToolOutput> {
    return syncSeries(this.ctx, args);
  }

  createPresetFromActive(args: CreatePresetArgs): Promise<ToolOutput> {
    return createPresetFromActive(this.ctx, args);
  }

  // --- Develop presets and checkpoints (issue #215).

  listPresets(args: presets.ListPresetsArgs = {}): Promise<ToolOutput> {
    return presets.listPresetsTool(this.ctx, args);
  }

  getPreset(args: presets.GetPresetArgs): Promise<ToolOutput> {
    return presets.getPresetTool(this.ctx, args);
  }

  comparePresets(args: presets.ComparePresetsArgs): Promise<ToolOutput> {
    return presets.comparePresetsTool(this.ctx, args);
  }

  exportPreset(args: presets.ExportPresetArgs): Promise<ToolOutput> {
    return presets.exportPresetTool(this.ctx, args);
  }

  applyPreset(args: presets.ApplyPresetArgs, budget?: Budget): Promise<ToolOutput> {
    return presets.applyPresetTool(this.ctx, args, budget);
  }

  createCheckpoint(args: presets.CheckpointArgs): Promise<ToolOutput> {
    return presets.createCheckpointTool(this.ctx, args);
  }

  // --- Catalog.

  searchPhotos(args: SearchPhotosArgs = {}): Promise<ToolOutput> {
    return searchPhotos(this.ctx, args);
  }

  getSelectedPhotos(args: { limit?: number | undefined } = {}): Promise<ToolOutput> {
    return getSelectedPhotos(this.ctx, args);
  }

  listCollections(args: { limit?: number | undefined; offset?: number | undefined } = {}): Promise<ToolOutput> {
    return listCollections(this.ctx, args);
  }

  setRating(args: SetRatingArgs): Promise<ToolOutput> {
    return setRating(this.ctx, args);
  }

  setKeywords(args: SetKeywordsArgs): Promise<ToolOutput> {
    return setKeywords(this.ctx, args);
  }

  listKeywords(args: ListKeywordsArgs = {}): Promise<ToolOutput> {
    return listKeywords(this.ctx, args);
  }

  setGps(args: SetGpsArgs): Promise<ToolOutput> {
    return setGps(this.ctx, args);
  }

  // --- Catalog metadata (GitHub issues #111, #112, #139).

  setFlag(args: SetFlagArgs): Promise<ToolOutput> {
    return setFlag(this.ctx, args);
  }

  setIptc(args: SetIptcArgs): Promise<ToolOutput> {
    return setIptc(this.ctx, args);
  }

  getMetadata(args: GetMetadataArgs): Promise<ToolOutput> {
    return getMetadata(this.ctx, args);
  }

  // --- Collections and files (GitHub issue #55).

  createCollection(args: CreateCollectionArgs): Promise<ToolOutput> {
    return createCollection(this.ctx, args);
  }

  addToCollection(args: AddToCollectionArgs): Promise<ToolOutput> {
    return addToCollection(this.ctx, args);
  }

  exportPhotos(args: ExportPhotosArgs, budget?: Budget): Promise<ToolOutput> {
    return exportPhotos(this.ctx, args, budget);
  }

  importPhotos(args: ImportPhotosArgs, budget?: Budget): Promise<ToolOutput> {
    return importPhotos(this.ctx, args, budget);
  }

  applyDenoise(args: ApplyDenoiseArgs, budget?: Budget): Promise<ToolOutput> {
    return applyDenoise(this.ctx, args, budget);
  }

  // --- Develop parity (GitHub issue #214; tools-develop.ts, tools-snapshots.ts).

  applyAuto(args: ApplyAutoArgs, budget?: Budget): Promise<ToolOutput> {
    return applyAuto(this.ctx, args, budget);
  }

  resetDevelop(args: ResetArgs, budget?: Budget): Promise<ToolOutput> {
    return resetDevelop(this.ctx, args, budget);
  }

  setProcessVersion(args: ProcessVersionArgs, budget?: Budget): Promise<ToolOutput> {
    return setProcessVersion(this.ctx, args, budget);
  }

  listSnapshots(args: SnapshotListArgs): Promise<ToolOutput> {
    return listSnapshots(this.ctx, args);
  }

  createSnapshot(args: CreateSnapshotArgs): Promise<ToolOutput> {
    return createSnapshot(this.ctx, args);
  }

  applySnapshot(args: SnapshotArgs): Promise<ToolOutput> {
    return applySnapshot(this.ctx, args);
  }

  deleteSnapshot(args: SnapshotArgs): Promise<ToolOutput> {
    return deleteSnapshot(this.ctx, args);
  }

  createVirtualCopies(args: VirtualCopiesArgs, budget?: Budget): Promise<ToolOutput> {
    return createVirtualCopies(this.ctx, args, budget);
  }

  // --- Phase 2's write, for the Phase 2 check (not offered over MCP).

  setSettings(args: SetSettingsArgs): Promise<ToolOutput> {
    return setSettings(this.ctx, args);
  }
}
