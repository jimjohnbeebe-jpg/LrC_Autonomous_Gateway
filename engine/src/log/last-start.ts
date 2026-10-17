// The "last started" record (PHASE9_PLAN decision D4): at each MCP initialize the engine writes
// %LOCALAPPDATA%\LrC-AVG\last-start.json, so the plugin's Status dialog and the setup check can tell that
// a client really started this engine, and which one, instead of trusting a config file alone.
// It is written to the product's data folder, not to LRC_AVG_LOG_DIR: the record belongs to the install.

import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { ClientIdentity } from "./session-log.js";

export const LAST_START_FILE = "last-start.json";

export const lastStartSchema = z.strictObject({
  time: z.iso.datetime(),
  engine_version: z.string(),
  /** The client's cleaned clientInfo (mcp\client-info.ts); null when it sent none or no usable name. */
  client_name: z.string().nullable(),
  client_version: z.string().nullable(),
  /** The Node that runs this engine, and the engine entry it runs. */
  exec_path: z.string(),
  main_js: z.string(),
});
export type LastStart = z.infer<typeof lastStartSchema>;

/** %LOCALAPPDATA%\LrC-AVG (the folder of logs\ and intents\); ~\.lrc-avg without LOCALAPPDATA, as defaultLogDir has it. */
export function lastStartPath(env: NodeJS.ProcessEnv = process.env): string {
  const localAppData = env["LOCALAPPDATA"];
  return path.join(localAppData ? path.join(localAppData, "LrC-AVG") : path.join(os.homedir(), ".lrc-avg"), LAST_START_FILE);
}

export type LastStartOptions = {
  engineVersion: string;
  /** From mcp\client-info.ts clientIdentity(server.getClientVersion()). */
  client: ClientIdentity | null;
  env?: NodeJS.ProcessEnv;
  execPath?: string;
  mainJs?: string;
  now?: () => Date;
  /** Where a failed write is reported (one line); the default is stderr. */
  log?: (message: string) => void;
};

/** The record for this process. */
export function buildLastStart(o: LastStartOptions): LastStart {
  return {
    time: (o.now ?? (() => new Date()))().toISOString(),
    engine_version: o.engineVersion,
    client_name: o.client?.name ?? null,
    client_version: o.client?.version || null,
    exec_path: o.execPath ?? process.execPath,
    main_js: o.mainJs ?? process.argv[1] ?? "",
  };
}

/** Writes the record. Never throws: a failed write is reported once and ignored, the server goes on. */
export function writeLastStart(o: LastStartOptions): void {
  let file = LAST_START_FILE;
  try {
    file = lastStartPath(o.env);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(lastStartSchema.parse(buildLastStart(o)), null, 2) + "\n");
  } catch (err) {
    (o.log ?? ((m) => console.error(m)))(`could not write ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
