// The engine's tools (contracts in MCP_TOOLS):
//   Phase 2: lr_get_active_photo_context, lr_get_preview, lr_get_metrics.
//   Phase 3: the intent tools, and the session tools (session\manager.ts): lr_begin_session,
//            lr_step, lr_probe, lr_set_regions, lr_end_session, lr_get_session_log;
//            lr_get_preview gains `session_id` and `region`, lr_get_metrics `session_id`.
// lr_set_settings, Phase 2's temporary "lr_step-lite", is no longer offered over MCP: lr_step
// replaces it (PHASES.md Phase 2, "Inputs for Phase 3"). setSettings() stays for the Phase 2 check
// (devtools\phase2-check.ts), which calls this class directly.
// This class does not depend on the MCP SDK: server.ts wraps it, and the checks call it directly, so
// both go through the same code. Every call is written to the tool log.

import { randomUUID } from "node:crypto";
import type { BridgeClient } from "../bridge/index.js";
import type { IntentLibrary } from "../intents/index.js";
import type { ToolLog } from "../log/index.js";
import { boxProblem, deltaMetrics, summarize, type Metrics, type Region, type RegionBox } from "../metrics/index.js";
import { ParamError, type CanonicalValue, type FromSdkResult, type ParamMap } from "../params/index.js";
import { cropRegion, type PreviewService, type RenderedPreview } from "../preview/index.js";
import { SessionManager, type BeginArgs, type EndArgs, type ProbeArgs, type RegionArgs, type StepArgs } from "../session/index.js";
import { ToolError, toToolError } from "./errors.js";

/** Preview long edge and JPEG quality: PRD section 6.2 defaults and range (the settings page is Phase 5). */
export const DEFAULT_LONG_EDGE = 1600;
export const MIN_LONG_EDGE = 800;
export const MAX_LONG_EDGE = 1920;
export const PREVIEW_QUALITY = 75;
/**
 * A write with its read-back took under 1 s in Phase 1 (0.45-1 s receipt to receipt)
 * [handle: docs\reports\phase1\PHASE1.md "Numbers"]; 30 s leaves room for a busy Lightroom.
 */
const WRITE_TIMEOUT_MS = 30000;
/**
 * The largest export a region crop asks for: the plugin refuses a long edge above 4096
 * [handle: plugin\LrC-AVG.lrplugin\Preview.lua:29, Preview.MAX_LONG_EDGE].
 */
export const REGION_EXPORT_MAX = 4096;

export type ToolOutput = {
  json: Record<string, unknown>;
  image?: Buffer;
  /** What the tool log records for this call, beyond the tool name, arguments and outcome. */
  log?: Record<string, unknown>;
};

export type LastRender = {
  uuid: string;
  preview_hash: string;
  rendered_at: string;
  width: number;
  height: number;
  metrics: Metrics;
};

export type SetSettingsArgs = {
  uuid: string;
  settings: Record<string, CanonicalValue>;
  return_image?: "after" | "none" | undefined;
  long_edge?: number | undefined;
};

export type SaveIntentArgs = { intent: unknown; confirmed: boolean; replace?: boolean | undefined };

export type ToolsDeps = {
  client: BridgeClient;
  map: ParamMap;
  previews: PreviewService;
  /** The intent library (Phase 3); the intent and session tools refuse without it. */
  intents?: IntentLibrary;
  /** The folder of the session logs and recipes (log\session-log.ts); the session tools refuse without it. */
  sessionLogDir?: string;
  engineVersion?: string;
  /** Resolves when the bridge is connected (bridge-gate.ts), or throws. */
  ensureBridge: () => Promise<void>;
  log?: ToolLog;
  /** History names are "<prefix> set <n>"; they must start with "AVG " (PRD FR-4.4, C-7). */
  historyPrefix?: string;
  /** Called when a tool call begins and ends (the gate's idle release, bridge-gate.ts). */
  onCallStart?: () => void;
  onCallEnd?: () => void;
  now?: () => Date;
};

const ms = (since: number): number => Math.round((performance.now() - since) * 10) / 10;

export class Tools {
  private readonly deps: ToolsDeps;
  private readonly historyPrefix: string;
  private readonly now: () => Date;
  private writes = 0;
  private last: LastRender | null = null;
  private readonly sessions: SessionManager | null;

  constructor(deps: ToolsDeps) {
    this.deps = deps;
    this.historyPrefix = deps.historyPrefix ?? `AVG ${randomUUID().slice(0, 4)}`;
    if (!this.historyPrefix.startsWith("AVG ")) throw new Error(`history prefix must start with "AVG ": ${this.historyPrefix}`);
    this.now = deps.now ?? (() => new Date());
    this.sessions =
      deps.intents && deps.sessionLogDir
        ? new SessionManager({
            client: deps.client,
            map: deps.map,
            intents: deps.intents,
            render: (r) => this.render(r.longEdge, r.targetUuid, r.regions, r.quality),
            logDir: deps.sessionLogDir,
            engineVersion: deps.engineVersion ?? "unknown",
            now: this.now,
          })
        : null;
  }

  /** The session manager (for the checks); null when the engine was started without intents or a log folder. */
  sessionManager(): SessionManager | null {
    return this.sessions;
  }

  /** The last preview this engine rendered, if any. */
  lastRender(): LastRender | null {
    return this.last;
  }

  async getActivePhotoContext(): Promise<ToolOutput> {
    return this.run("lr_get_active_photo_context", {}, async () => {
      const { client, map } = this.deps;
      await this.deps.ensureBridge();
      const ctx = await client.request("get_context", {});
      const sdk = (await client.request("get_settings", { target_uuid: ctx.uuid })).settings;
      let view: FromSdkResult | null = null;
      let settingsError: Record<string, unknown> | null = null;
      try {
        view = map.fromSdk(sdk);
      } catch (err) {
        if (!(err instanceof ParamError)) throw err;
        settingsError = toToolError(err).body(); // e.g. a legacy process version: the rest still helps
      }
      const field = (key: string): unknown => ctx[key] ?? null;
      const json: Record<string, unknown> = {
        ok: true,
        uuid: ctx.uuid,
        local_id: ctx.local_id,
        filename: field("filename"),
        path: field("path"),
        copy_name: field("copy_name"),
        is_virtual_copy: field("is_virtual_copy"),
        file_format: field("file_format"),
        width: field("width"),
        height: field("height"),
        exif: {
          iso: field("iso"),
          shutter: field("shutter"),
          aperture: field("aperture"),
          focal_length: field("focal_length"),
          lens: field("lens"),
          camera: field("camera"),
        },
        rating: field("rating"),
        label: field("label"),
        pick: field("pick"),
        process_version: view?.process_version ?? (typeof sdk["ProcessVersion"] === "string" ? sdk["ProcessVersion"] : null),
        camera_profile: view ? (view.camera_profile.name ?? view.camera_profile.camera_profile) : null,
        camera_profile_detail: view?.camera_profile ?? null,
        lens_profile_enabled: view ? view.settings["lens.profile_enable"] === 1 : null,
        settings: view?.settings ?? null,
        session_active: this.sessions?.current()?.uuid === ctx.uuid,
        ...(this.sessions?.current() ? { open_session: { session_id: this.sessions.current()?.id, uuid: this.sessions.current()?.uuid, pass: this.sessions.current()?.pass } } : {}),
        ...(settingsError ? { settings_error: settingsError } : {}),
        ...(ctx.metadata_errors?.length ? { metadata_errors: ctx.metadata_errors } : {}),
      };
      return {
        json,
        log: { uuid: ctx.uuid, filename: json["filename"], process_version: json["process_version"], camera_profile: json["camera_profile"] },
      };
    });
  }

  /**
   * A preview of the selected photo, or with `session_id` of the session's photo (refused if another
   * photo is selected, C-2), with the session's region metrics. With `region`, a crop of that box:
   * the photo is exported large enough for the crop to fill `long_edge` (up to REGION_EXPORT_MAX),
   * the crop is never enlarged, and `effective_scale` says how many output pixels it has per pixel
   * of the photo (1 = 100 %).
   */
  async getPreview(args: { long_edge?: number | undefined; session_id?: string | undefined; region?: RegionBox | undefined } = {}): Promise<ToolOutput> {
    return this.run("lr_get_preview", args, async () => {
      await this.deps.ensureBridge();
      const session = args.session_id !== undefined ? this.openSession(args.session_id) : null;
      const target = session?.uuid;
      const regions = session ? (this.sessions as SessionManager).regionsOf(session.id) : [];
      const longEdge = args.long_edge ?? DEFAULT_LONG_EDGE;
      if (!args.region) {
        // With a session, the manager renders it and keeps it as the session's last render, so
        // lr_get_metrics and the next step describe this image (Greptile, PR #23) [handle:
        // tests\mcp-tools.test.ts "says a session is open on the selected photo, and answers
        // lr_get_metrics from the session's last render"].
        const preview = session ? await (this.sessions as SessionManager).preview(session.id, longEdge) : await this.render(longEdge, target, regions);
        const json = { ok: true, ...(session ? { session_id: session.id } : {}), ...this.describe(preview), metrics: summarize(preview.metrics), timings: preview.timings };
        return { json, image: preview.jpeg, log: { uuid: preview.uuid, preview_hash: preview.sha256, metrics: json.metrics, timings: preview.timings } };
      }
      const problem = boxProblem(args.region);
      if (problem) throw new ToolError("INVALID_ARGUMENTS", `region: ${problem}`, false);
      const ctx = await this.deps.client.request("get_context", target !== undefined ? { target_uuid: target } : {});
      // The photo's size is getRawMetadata("width"/"height") (Develop.lua RAW_KEYS); whether that is
      // the whole sensor or the cropped size is [unverified], so effective_scale is too until a check
      // records both.
      const w = typeof ctx["width"] === "number" ? ctx["width"] : null;
      const h = typeof ctx["height"] === "number" ? ctx["height"] : null;
      const photoWidth = w !== null && h !== null ? Math.max(w, h) : null;
      // The crop's longer side as a fraction of the export's long edge: on a 3:2 landscape a box's
      // height counts 2/3 as much as its width (Greptile, PR #23: max(w, h) under-sized tall boxes)
      // [handle: tests\mcp-tools.test.ts "sizes the export by the crop's longer side in pixels"].
      const fraction = w !== null && h !== null && photoWidth ? Math.max(args.region.w * (w / photoWidth), args.region.h * (h / photoWidth)) : Math.max(args.region.w, args.region.h);
      // The epsilon keeps 800 / 0.26666666666666666 (= 3000.0000000000005) at 3000.
      const edgeFor = (f: number): number => Math.min(REGION_EXPORT_MAX, Math.max(longEdge, Math.ceil(longEdge / f - 1e-6)));
      let exportEdge = edgeFor(fraction);
      let preview = await this.render(exportEdge, ctx.uuid, regions);
      let crop = await cropRegion(preview.jpeg, args.region, { longEdge, quality: PREVIEW_QUALITY });
      // A crop or rotation in Lightroom can give the export another aspect than the raw width and
      // height (Greptile, PR #23) [inference: a Lightroom crop changes the exported image's shape; the
      // raw width/height semantics are unverified, above]. If the crop came out short, export once
      // more at the size the export's own aspect needs [handle: tests\mcp-tools.test.ts "exports once
      // more when a crop in Lightroom gave the export another aspect"].
      let retried = false;
      if (Math.max(crop.width, crop.height) < longEdge && exportEdge < REGION_EXPORT_MAX) {
        const long = Math.max(preview.width, preview.height);
        const needed = edgeFor(Math.max(args.region.w * (preview.width / long), args.region.h * (preview.height / long)));
        if (needed > exportEdge) {
          exportEdge = needed;
          preview = await this.render(exportEdge, ctx.uuid, regions);
          crop = await cropRegion(preview.jpeg, args.region, { longEdge, quality: PREVIEW_QUALITY });
          retried = true;
        }
      }
      const previewLong = Math.max(preview.width, preview.height);
      const effectiveScale = photoWidth ? Math.round(crop.scale * (previewLong / photoWidth) * 10000) / 10000 : null;
      const json = {
        ok: true,
        ...(session ? { session_id: session.id } : {}),
        uuid: preview.uuid,
        region: args.region,
        width: crop.width,
        height: crop.height,
        rect_in_export: crop.rect,
        export_long_edge: previewLong,
        ...(retried ? { export_retried: "the first export's aspect differed from the photo's size, so it was exported again larger" } : {}),
        effective_scale: effectiveScale,
        ...(effectiveScale === null ? { effective_scale_note: "the photo's size was not in the context; scale is per export pixel" } : {}),
        scale_in_export: crop.scale,
        preview_source: preview.source,
        preview_hash: preview.sha256,
        metrics: summarize(preview.metrics),
        timings: preview.timings,
      };
      return { json, image: crop.jpeg, log: { uuid: preview.uuid, region: args.region, effective_scale: effectiveScale, timings: preview.timings } };
    });
  }

  /** Metrics of the last preview: the session's with `session_id` (or while a session is open), else this engine's. */
  async getMetrics(args: { session_id?: string | undefined } = {}): Promise<ToolOutput> {
    return this.run("lr_get_metrics", args, { usesBridge: false }, async () => {
      const open = this.sessions?.current() ?? null;
      if (args.session_id !== undefined) this.openSession(args.session_id);
      if (open?.last) {
        const json = { ok: true, session_id: open.id, uuid: open.uuid, preview_hash: open.last.hash, width: open.last.width, height: open.last.height, metrics: open.last.metrics };
        return { json, log: { session_id: open.id, preview_hash: open.last.hash } };
      }
      const last = this.last;
      if (!last) throw new ToolError("NO_PREVIEW_YET", "No preview has been rendered yet in this engine run; call lr_get_preview first.", false);
      const json = {
        ok: true,
        uuid: last.uuid,
        preview_hash: last.preview_hash,
        rendered_at: last.rendered_at,
        width: last.width,
        height: last.height,
        metrics: last.metrics,
      };
      return { json, log: { uuid: last.uuid, preview_hash: last.preview_hash } };
    });
  }

  // --- Sessions (Phase 3; session\manager.ts).

  async beginSession(args: BeginArgs): Promise<ToolOutput> {
    return this.run("lr_begin_session", args, async () => {
      const sessions = this.sessionTools();
      await this.deps.ensureBridge();
      return sessions.begin(args);
    });
  }

  async step(args: StepArgs): Promise<ToolOutput> {
    return this.run("lr_step", args, async () => {
      const sessions = this.sessionTools();
      await this.deps.ensureBridge();
      return sessions.step(args);
    });
  }

  async probe(args: ProbeArgs): Promise<ToolOutput> {
    return this.run("lr_probe", args, async () => {
      const sessions = this.sessionTools();
      await this.deps.ensureBridge();
      return sessions.probe(args);
    });
  }

  async setRegions(args: RegionArgs): Promise<ToolOutput> {
    return this.run("lr_set_regions", args, { usesBridge: false }, async () => this.sessionTools().setRegions(args));
  }

  async endSession(args: EndArgs): Promise<ToolOutput> {
    return this.run("lr_end_session", args, async () => {
      const sessions = this.sessionTools();
      await this.deps.ensureBridge();
      return sessions.end(args);
    });
  }

  async getSessionLog(args: { session_id: string }): Promise<ToolOutput> {
    return this.run("lr_get_session_log", args, { usesBridge: false }, async () => this.sessionTools().getLog(args));
  }

  private sessionTools(): SessionManager {
    if (!this.sessions) throw new ToolError("INTERNAL_ERROR", "This engine was started without the intent library or a session log folder.", false);
    return this.sessions;
  }

  /** The open session with this id, or SESSION_NOT_ACTIVE. */
  private openSession(sessionId: string): { id: string; uuid: string } {
    const open = this.sessions?.current() ?? null;
    if (!open || open.id !== sessionId) {
      throw new ToolError("SESSION_NOT_ACTIVE", open ? `Session ${sessionId} is not the open one (${open.id}).` : `No session is open (asked for ${sessionId}).`, false);
    }
    return open;
  }

  async setSettings(args: SetSettingsArgs): Promise<ToolOutput> {
    return this.run("lr_set_settings", args, async () => {
      const { client, map } = this.deps;
      const started = performance.now();
      await this.deps.ensureBridge();

      // The settings before the write; the plugin refuses here already if another photo is selected.
      let t = performance.now();
      const before = await client.request("get_settings", { target_uuid: args.uuid });
      const getSettingsMs = ms(t);
      const view = map.fromSdk(before.settings); // refuses an unsupported process version
      const sdk = map.toSdk(args.settings, { processVersion: view.process_version }); // unknown or out-of-range: refused, nothing written

      this.writes++;
      const historyName = `${this.historyPrefix} set ${this.writes}`;
      t = performance.now();
      const res = await client.request(
        "apply_settings",
        { target_uuid: args.uuid, settings: sdk, history_name: historyName },
        { timeoutMs: WRITE_TIMEOUT_MS },
      );
      const writeMs = ms(t);

      // Every write is read back (Phase 0, P-12): Lightroom silently drops values it does not take
      // [handle: docs\reports\phase1\PHASE1.md "Run 3", range probe].
      const after = map.fromSdk(res.read_back);
      const changes = Object.keys(args.settings).map((name) => ({
        name,
        before: view.settings[name] ?? null,
        requested: args.settings[name] ?? null,
        after: after.settings[name] ?? null,
      }));
      const mismatches = map.verifyReadback(sdk, res.read_back);
      if (mismatches.length > 0) {
        throw new ToolError(
          "WRITE_NOT_TAKEN",
          `Lightroom did not take ${mismatches.map((m) => m.sdk_key).join(", ")} as written. The History step "${historyName}" exists; ` +
            "check `changes` for what the photo holds now.",
          false,
          { history_name: historyName, changes, mismatches },
        );
      }

      const timings: Record<string, unknown> = {
        get_settings_ms: getSettingsMs,
        write_ms: writeMs,
        plugin_apply_ms: Math.round(res.apply_ms * 10) / 10,
        ...(res.read_ms !== undefined ? { plugin_read_ms: Math.round(res.read_ms * 10) / 10 } : {}),
        ...(res.command_ms !== undefined ? { plugin_command_ms: Math.round(res.command_ms * 10) / 10 } : {}),
      };
      const json: Record<string, unknown> = { ok: true, uuid: res.uuid, history_name: historyName, changes, read_back: "as written" };
      let image: Buffer | undefined;
      if (args.return_image !== "none") {
        // The write has happened by now. If only the render fails, the call still reports the write
        // (ok, History name, changes) with `preview_error`, so it is not mistaken for a failed write
        // and repeated (Greptile, PR #17).
        const previous = this.last?.uuid === res.uuid ? this.last : null;
        try {
          const preview = await this.render(args.long_edge ?? DEFAULT_LONG_EDGE, res.uuid);
          Object.assign(json, this.describe(preview), {
            metrics: summarize(preview.metrics),
            delta_metrics: previous ? deltaMetrics(previous.metrics, preview.metrics) : null,
            ...(previous ? { delta_against: previous.preview_hash } : { delta_note: "no earlier preview of this photo in this engine run" }),
          });
          timings["preview"] = preview.timings;
          image = preview.jpeg;
        } catch (err) {
          json["preview_error"] = toToolError(err).body();
        }
      }
      timings["total_ms"] = ms(started);
      json["timings"] = timings;
      return {
        json,
        ...(image ? { image } : {}),
        log: {
          uuid: res.uuid,
          history_name: historyName,
          changes,
          preview_hash: json["preview_hash"] ?? null,
          delta_metrics: json["delta_metrics"] ?? null,
          ...(json["preview_error"] ? { preview_error: json["preview_error"] } : {}),
          timings,
        },
      };
    });
  }

  // --- Intents (Phase 3; ARCHITECTURE section 7). They read files only and never need Lightroom.

  async listIntents(): Promise<ToolOutput> {
    return this.run("lr_list_intents", {}, { usesBridge: false }, async () => {
      const library = this.library();
      const { intents, warnings } = library.list();
      const json: Record<string, unknown> = { ok: true, intents, folders: library.directories(), ...(warnings.length ? { warnings } : {}) };
      return { json, log: { count: intents.length, warnings } };
    });
  }

  async getIntent(args: { id: string }): Promise<ToolOutput> {
    return this.run("lr_get_intent", args, { usesBridge: false }, async () => {
      const found = this.library().get(args.id);
      const json = { ok: true, source: found.source, path: found.path, overrides_bundled: found.overrides_bundled, intent: found.intent };
      return { json, log: { id: args.id, source: found.source } };
    });
  }

  async saveIntent(args: SaveIntentArgs): Promise<ToolOutput> {
    return this.run("lr_save_intent", args, { usesBridge: false }, async () => {
      // The tool's schema requires `confirmed` to be a boolean; false is refused here.
      if (args.confirmed !== true) {
        throw new ToolError("NOT_CONFIRMED", "Ask the user to approve this intent in the chat first, then call again with confirmed: true.", false);
      }
      const saved = this.library().save(args.intent, { replace: args.replace === true });
      const id = (args.intent as { id?: unknown }).id;
      return { json: { ok: true, id, ...saved }, log: { id, ...saved } };
    });
  }

  private library(): IntentLibrary {
    if (!this.deps.intents) throw new ToolError("INTERNAL_ERROR", "This engine was started without the intent library.", false);
    return this.deps.intents;
  }

  /** Log a call refused before it reached a tool (unknown tool, invalid arguments; server.ts). */
  recordRejected(tool: string, args: unknown, error: ToolError): void {
    this.deps.log?.append({ ts: this.now().toISOString(), tool, ok: false, duration_ms: 0, args, error: error.body() });
  }

  private async render(longEdge: number, targetUuid?: string, regions: readonly Region[] = [], quality = PREVIEW_QUALITY): Promise<RenderedPreview> {
    const preview = await this.deps.previews.render({
      longEdge,
      quality,
      regions,
      ...(targetUuid !== undefined ? { targetUuid } : {}),
    });
    this.last = {
      uuid: preview.uuid,
      preview_hash: preview.sha256,
      rendered_at: preview.rendered_at,
      width: preview.width,
      height: preview.height,
      metrics: preview.metrics,
    };
    return preview;
  }

  private describe(preview: RenderedPreview): Record<string, unknown> {
    return {
      uuid: preview.uuid,
      preview_hash: preview.sha256,
      preview_source: preview.source,
      width: preview.width,
      height: preview.height,
      bytes: preview.bytes,
      reencoded: preview.reencoded,
    };
  }

  /**
   * Run a tool: log it, and tell the bridge gate a call is in progress. A tool that never uses
   * Lightroom (`usesBridge: false`, the intent tools) leaves the gate alone, so it does not restart
   * the idle release of a bridge lock this engine holds (Greptile, PR #22) [handle: the gate's idle
   * timer is cleared and restarted only in beginUse/endUse, engine\src\mcp\bridge-gate.ts; test
   * tests\intents.test.ts "leaves the bridge gate alone": three intent calls, 0 gate calls].
   */
  private run(tool: string, args: unknown, fn: () => Promise<ToolOutput>): Promise<ToolOutput>;
  private run(tool: string, args: unknown, options: { usesBridge: boolean }, fn: () => Promise<ToolOutput>): Promise<ToolOutput>;
  private async run(
    tool: string,
    args: unknown,
    optionsOrFn: { usesBridge: boolean } | (() => Promise<ToolOutput>),
    maybeFn?: () => Promise<ToolOutput>,
  ): Promise<ToolOutput> {
    const fn = typeof optionsOrFn === "function" ? optionsOrFn : (maybeFn as () => Promise<ToolOutput>);
    const usesBridge = typeof optionsOrFn === "function" ? true : optionsOrFn.usesBridge;
    const ts = this.now().toISOString();
    const started = performance.now();
    if (usesBridge) this.deps.onCallStart?.();
    try {
      const out = await fn();
      this.deps.log?.append({ ts, tool, ok: true, duration_ms: ms(started), args, ...out.log });
      return out;
    } catch (err) {
      const error = toToolError(err);
      this.deps.log?.append({ ts, tool, ok: false, duration_ms: ms(started), args, error: error.body() });
      throw error;
    } finally {
      if (usesBridge) this.deps.onCallEnd?.();
    }
  }
}
