// Preview pipeline (ARCHITECTURE section 6, PRD section 6.8).
//
// The plugin renders an LrExportSession JPEG of the target photo into its temp folder and returns
// the file's path; the preview never crosses the socket (Phase 0, P-01 and D-01). This side:
//   1. asks for the export (`export_preview`),
//   2. reads the file, then deletes it: only a file inside the previews folder is read or deleted,
//      so a bad path in a response cannot make the engine touch anything else,
//   3. keeps the JPEG as exported when it already fits the long edge and has no rotation tag, so it
//      is not compressed twice; otherwise shrinks and rotates it with sharp at the same quality,
//   4. hashes the JPEG that is sent on (SHA-256; the freshness record, ARCHITECTURE 6.3) and measures it.
// Leftover files are purged when the engine starts and when it exits (PRD NFR-6).
//
// The previews folder is %TEMP%\LrC-AVG\previews: Lightroom's temp folder is %TEMP%
// [handle: docs\reports\phase1\PHASE1.md "Consequences", plugin_log_copied in the three run files],
// and Node's os.tmpdir() is %TEMP% on Windows.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, rmdirSync, rmSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { BridgeClient } from "../bridge/index.js";
import { measureImage, type BasicMetrics } from "../metrics/index.js";

export const PREVIEW_SOURCE = "export";
/** An export took ~2.6 s at 1600 px in S1 [handle: docs\reports\phase0\S1.md]; allow for a slow first one. */
const EXPORT_TIMEOUT_MS = 60000;

export function defaultPreviewDir(): string {
  return path.join(os.tmpdir(), "LrC-AVG", "previews");
}

/** A structured preview failure ({code, message, recoverable}, PRD NFR-7). */
export class PreviewError extends Error {
  readonly code: string;
  readonly recoverable: boolean;

  constructor(code: string, message: string, recoverable: boolean) {
    super(message);
    this.name = "PreviewError";
    this.code = code;
    this.recoverable = recoverable;
  }
}

export type PreviewRequest = { longEdge: number; quality: number; targetUuid?: string };

export type RenderedPreview = {
  uuid: string;
  jpeg: Buffer;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  /** False when the export was passed on as Lightroom wrote it. */
  reencoded: boolean;
  source: typeof PREVIEW_SOURCE;
  metrics: BasicMetrics;
  rendered_at: string;
  timings: {
    /** The export inside the plugin (LrExportSession). */
    export_ms: number;
    /** The export_preview command, sent to answered, as the engine saw it. */
    command_ms: number;
    /** Reading, deleting and (if needed) re-encoding the file. */
    file_ms: number;
    metrics_ms: number;
    total_ms: number;
  };
};

function isInside(dir: string, file: string): boolean {
  const rel = path.relative(path.resolve(dir), path.resolve(file));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

const ms = (since: number): number => Math.round((performance.now() - since) * 10) / 10;

export class PreviewService {
  private readonly client: BridgeClient;
  private readonly previewDir: string;
  private readonly exportTimeoutMs: number;

  constructor(client: BridgeClient, options: { previewDir?: string; exportTimeoutMs?: number } = {}) {
    this.client = client;
    this.previewDir = options.previewDir ?? defaultPreviewDir();
    this.exportTimeoutMs = options.exportTimeoutMs ?? EXPORT_TIMEOUT_MS;
  }

  directory(): string {
    return this.previewDir;
  }

  /** Delete everything in the previews folder (engine start and exit, PRD NFR-6). Never throws. */
  purge(): void {
    let names: string[];
    try {
      names = readdirSync(this.previewDir);
    } catch {
      return; // no folder yet
    }
    for (const name of names) {
      try {
        rmSync(path.join(this.previewDir, name), { recursive: true, force: true });
      } catch {
        // A file Lightroom still holds open; the next purge takes it.
      }
    }
  }

  async render(request: PreviewRequest): Promise<RenderedPreview> {
    const started = performance.now();
    const payload = {
      long_edge: request.longEdge,
      quality: request.quality,
      ...(request.targetUuid !== undefined ? { target_uuid: request.targetUuid } : {}),
    };
    const res = await this.client.request("export_preview", payload, { timeoutMs: this.exportTimeoutMs });
    const commandMs = ms(started);

    const fileStarted = performance.now();
    const file = this.take(res.path);
    let jpeg = file;
    let reencoded = false;
    const meta = await sharp(file).metadata();
    if (meta.format !== "jpeg") {
      throw new PreviewError("PREVIEW_UNREADABLE", `the export is ${String(meta.format)}, not a JPEG`, false);
    }
    let width = meta.width;
    let height = meta.height;
    const rotated = meta.orientation !== undefined && meta.orientation !== 1;
    if (rotated || Math.max(width, height) > request.longEdge) {
      const out = await sharp(file)
        .rotate()
        .resize({ width: request.longEdge, height: request.longEdge, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: request.quality })
        .toBuffer({ resolveWithObject: true });
      jpeg = out.data;
      width = out.info.width;
      height = out.info.height;
      reencoded = true;
    }
    const fileMs = ms(fileStarted);

    const metricsStarted = performance.now();
    const metrics = await measureImage(jpeg);
    const metricsMs = ms(metricsStarted);

    return {
      uuid: res.uuid,
      jpeg,
      width,
      height,
      bytes: jpeg.length,
      sha256: createHash("sha256").update(jpeg).digest("hex"),
      reencoded,
      source: PREVIEW_SOURCE,
      metrics,
      rendered_at: new Date().toISOString(),
      timings: { export_ms: Math.round(res.export_ms * 10) / 10, command_ms: commandMs, file_ms: fileMs, metrics_ms: metricsMs, total_ms: ms(started) },
    };
  }

  /** Read the exported file and delete it (and its folder, when that is a now-empty subfolder). */
  private take(file: string): Buffer {
    if (!isInside(this.previewDir, file) || !/\.jpe?g$/i.test(file)) {
      throw new PreviewError("PREVIEW_PATH_REFUSED", `the plugin returned a preview path outside ${this.previewDir}: ${file}`, false);
    }
    let data: Buffer;
    try {
      data = readFileSync(file);
    } catch (err) {
      throw new PreviewError("PREVIEW_UNREADABLE", `cannot read the exported preview: ${(err as Error).message}`, true);
    }
    try {
      unlinkSync(file);
      const parent = path.dirname(path.resolve(file));
      if (isInside(this.previewDir, parent)) rmdirSync(parent); // fails, harmlessly, if not empty
    } catch {
      // Left for the next purge.
    }
    return data;
  }
}
