// The Phase 2 tools (PHASES.md Phase 2; contracts in MCP_TOOLS; plan approved by Jim 2026-09-26):
//   lr_get_active_photo_context, lr_get_preview, lr_get_metrics, and lr_set_settings, a temporary
//   "lr_step-lite" that Phase 3's lr_step replaces.
// Jim's decisions for Phase 2 (2026-09-26) [stated: "go with recommendations"]:
//   1. lr_set_settings takes absolute values; deltas, decay and guardrails come with lr_step (Phase 3).
//   2. lr_get_preview has no region crop yet; it comes with lr_set_regions (Phase 3).
//   3. lr_set_settings names the photo by the uuid of an earlier result, and the plugin refuses the
//      write if another photo is selected (ARCHITECTURE section 3, C-2).
// This class does not depend on the MCP SDK: server.ts wraps it, and the Phase 2 check calls it
// directly, so both go through the same code. Every call is written to the tool log.

import { randomUUID } from "node:crypto";
import type { BridgeClient } from "../bridge/index.js";
import type { ToolLog } from "../log/index.js";
import { deltaMetrics, summarize, type BasicMetrics } from "../metrics/index.js";
import { ParamError, type CanonicalValue, type FromSdkResult, type ParamMap } from "../params/index.js";
import type { PreviewService, RenderedPreview } from "../preview/index.js";
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
  metrics: BasicMetrics;
};

export type SetSettingsArgs = {
  uuid: string;
  settings: Record<string, CanonicalValue>;
  return_image?: "after" | "none" | undefined;
  long_edge?: number | undefined;
};

export type ToolsDeps = {
  client: BridgeClient;
  map: ParamMap;
  previews: PreviewService;
  /** Resolves when the bridge is connected (bridge-gate.ts), or throws. */
  ensureBridge: () => Promise<void>;
  log?: ToolLog;
  /** History names are "<prefix> set <n>"; they must start with "AVG " (PRD FR-4.4, C-7). */
  historyPrefix?: string;
  now?: () => Date;
};

const ms = (since: number): number => Math.round((performance.now() - since) * 10) / 10;

export class Tools {
  private readonly deps: ToolsDeps;
  private readonly historyPrefix: string;
  private readonly now: () => Date;
  private writes = 0;
  private last: LastRender | null = null;

  constructor(deps: ToolsDeps) {
    this.deps = deps;
    this.historyPrefix = deps.historyPrefix ?? `AVG ${randomUUID().slice(0, 4)}`;
    if (!this.historyPrefix.startsWith("AVG ")) throw new Error(`history prefix must start with "AVG ": ${this.historyPrefix}`);
    this.now = deps.now ?? (() => new Date());
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
        session_active: false,
        ...(settingsError ? { settings_error: settingsError } : {}),
        ...(ctx.metadata_errors?.length ? { metadata_errors: ctx.metadata_errors } : {}),
      };
      return {
        json,
        log: { uuid: ctx.uuid, filename: json["filename"], process_version: json["process_version"], camera_profile: json["camera_profile"] },
      };
    });
  }

  async getPreview(args: { long_edge?: number | undefined } = {}): Promise<ToolOutput> {
    return this.run("lr_get_preview", args, async () => {
      await this.deps.ensureBridge();
      const preview = await this.render(args.long_edge ?? DEFAULT_LONG_EDGE);
      const json = { ok: true, ...this.describe(preview), metrics: summarize(preview.metrics), timings: preview.timings };
      return { json, image: preview.jpeg, log: { uuid: preview.uuid, preview_hash: preview.sha256, metrics: json.metrics, timings: preview.timings } };
    });
  }

  async getMetrics(): Promise<ToolOutput> {
    return this.run("lr_get_metrics", {}, async () => {
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

  /** Log a call refused before it reached a tool (unknown tool, invalid arguments; server.ts). */
  recordRejected(tool: string, args: unknown, error: ToolError): void {
    this.deps.log?.append({ ts: this.now().toISOString(), tool, ok: false, duration_ms: 0, args, error: error.body() });
  }

  private async render(longEdge: number, targetUuid?: string): Promise<RenderedPreview> {
    const preview = await this.deps.previews.render({
      longEdge,
      quality: PREVIEW_QUALITY,
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

  private async run(tool: string, args: unknown, fn: () => Promise<ToolOutput>): Promise<ToolOutput> {
    const ts = this.now().toISOString();
    const started = performance.now();
    try {
      const out = await fn();
      this.deps.log?.append({ ts, tool, ok: true, duration_ms: ms(started), args, ...out.log });
      return out;
    } catch (err) {
      const error = toToolError(err);
      this.deps.log?.append({ ts, tool, ok: false, duration_ms: ms(started), args, error: error.body() });
      throw error;
    }
  }
}
