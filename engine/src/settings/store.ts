// One engine run's view of the settings page: the last successful read, and the folders chosen from
// it (folders.ts). mcp\main.ts makes one; lr_begin_session, the intent tools, lr_get_session_log and
// lr_sync_series read the page through it.

import type { BridgeClient } from "../bridge/index.js";
import { EngineFolders } from "./folders.js";
import { readPage, type PageRead } from "./read.js";

export class PageSettings {
  readonly folders: EngineFolders;
  private readonly client: BridgeClient;
  private lastRead: PageRead | null = null;

  constructor(client: BridgeClient, env: NodeJS.ProcessEnv = process.env) {
    this.client = client;
    this.folders = new EngineFolders(env);
  }

  /**
   * Read the page now; the folders follow a successful read, and a failed one keeps the last.
   * `timeoutMs` bounds get_prefs (read.ts readPage).
   */
  async read(timeoutMs?: number): Promise<PageRead> {
    const r = await readPage(this.client, timeoutMs);
    if (r.read) this.lastRead = r;
    this.folders.update(r);
    return r;
  }

  /** The last successful read, if any. */
  last(): PageRead | null {
    return this.lastRead;
  }
}
