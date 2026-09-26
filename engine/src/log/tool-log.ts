// A JSON-lines record of every MCP tool call: arguments, outcome, timings, preview hash. It is the
// engine's evidence for the Phase 2 acceptance chat (PHASES.md Phase 2: "log path in the report").
// The Phase 3 provenance log (session JSON and recipe, ARCHITECTURE section 8) is separate.
//
// Folder: LRC_AVG_LOG_DIR when set (the Claude Desktop entry sets it to the repo's logs\ folder, the
// dev default of PRD section 6.2), else %LOCALAPPDATA%\LrC-AVG\logs (the product default).
// One file per local day: engine-<yyyymmdd>.jsonl. Image data is never written here.

import { appendFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function defaultLogDir(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env["LRC_AVG_LOG_DIR"];
  if (explicit) return explicit;
  const localAppData = env["LOCALAPPDATA"];
  return localAppData ? path.join(localAppData, "LrC-AVG", "logs") : path.join(os.homedir(), ".lrc-avg", "logs");
}

export type ToolLogRecord = {
  ts: string;
  tool: string;
  ok: boolean;
  duration_ms: number;
  [field: string]: unknown;
};

export class ToolLog {
  private readonly dir: string;
  private readonly now: () => Date;
  private readonly warn: (message: string) => void;
  private warned = false;

  constructor(dir: string, options: { now?: () => Date; warn?: (message: string) => void } = {}) {
    this.dir = dir;
    this.now = options.now ?? (() => new Date());
    this.warn = options.warn ?? ((m) => console.error(m));
  }

  /** The file today's records go to. */
  file(): string {
    const d = this.now();
    const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    return path.join(this.dir, `engine-${day}.jsonl`);
  }

  /** Append one record. A failed write is reported once on stderr and never fails the tool call. */
  append(record: ToolLogRecord): void {
    try {
      mkdirSync(this.dir, { recursive: true });
      appendFileSync(this.file(), JSON.stringify(record) + "\n");
    } catch (err) {
      if (!this.warned) this.warn(`[lrc-avg] cannot write the tool log in ${this.dir}: ${(err as Error).message}`);
      this.warned = true;
    }
  }
}
