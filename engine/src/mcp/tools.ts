// The engine's tools (contracts in MCP_TOOLS), one module per group:
//   context  (tools-context.ts): lr_get_active_photo_context, lr_get_preview, lr_get_metrics (Phase 2;
//            Phase 3 added `session_id` and `region` to lr_get_preview, `session_id` to lr_get_metrics).
//   session  (tools-session.ts): lr_begin_session, lr_step, lr_probe, lr_set_regions, lr_end_session,
//            lr_get_session_log (Phase 3; the loop is session\manager.ts); lr_select_variant (Phase 4);
//            lr_approve_pass (Phase 5).
//   intents  (tools-intents.ts): lr_list_intents, lr_get_intent, lr_save_intent (Phase 3).
//   propagation (tools-propagation.ts): lr_sync_series (Phase 4; the sync is sync\sync.ts) and
//            lr_create_preset_from_active (Phase 4; the preset is presets\create.ts).
//   write    (tools-write.ts): setSettings, Phase 2's lr_set_settings, for the Phase 2 check only.
// What they share is in tools-shared.ts. The MCP definitions are the defs-*.ts modules, by the same
// groups.
// This class does not depend on the MCP SDK: server.ts wraps it, and the checks call it directly, so
// both go through the same code. Every call is written to the tool log.

import type { HudPublisher } from "../hud/index.js";
import type { ApproveArgs, BeginArgs, EndArgs, ProbeArgs, RegionArgs, SelectArgs, SessionManager, StepArgs } from "../session/index.js";
import type { ToolError } from "./errors.js";
import { getActivePhotoContext, getMetrics, getPreview, type MetricsArgs, type PreviewArgs } from "./tools-context.js";
import { getIntent, listIntents, saveIntent, type SaveIntentArgs } from "./tools-intents.js";
import { createPresetFromActive, syncSeries, type CreatePresetArgs, type SyncSeriesArgs } from "./tools-propagation.js";
import { approvePass, beginSession, endSession, getSessionLog, probe, selectVariant, setRegions, step } from "./tools-session.js";
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

  /** Log a call refused before it reached a tool (unknown tool, invalid arguments; server.ts). */
  recordRejected(tool: string, args: unknown, error: ToolError): void {
    this.ctx.deps.log?.append({ ts: this.ctx.now().toISOString(), tool, ok: false, duration_ms: 0, args, error: error.body() });
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

  // --- Propagation.

  syncSeries(args: SyncSeriesArgs): Promise<ToolOutput> {
    return syncSeries(this.ctx, args);
  }

  createPresetFromActive(args: CreatePresetArgs): Promise<ToolOutput> {
    return createPresetFromActive(this.ctx, args);
  }

  // --- Phase 2's write, for the Phase 2 check (not offered over MCP).

  setSettings(args: SetSettingsArgs): Promise<ToolOutput> {
    return setSettings(this.ctx, args);
  }
}
