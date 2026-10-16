// What the tool log records about the MCP request behind a call (GitHub issue #136): whether the
// client sent a progressToken, and (issue #155 R1) which client sent it. The server enters the context
// where the request is visible (server.ts) and the tool log reads it (tools-shared.ts run). It is per
// call, not a shared field, because calls overlap: Claude Desktop sent request id 14 while id 13 was
// still pending [handle: docs\reports\phase8.5\desktop-call-limit.md]. AsyncLocalStorage carries the
// value across the call's awaits [handle: https://nodejs.org/api/async_context.html#class-asynclocalstorage].

import { AsyncLocalStorage } from "node:async_hooks";
import type { ClientIdentity } from "../log/index.js";

export type CallContext = { progressToken: boolean; client?: ClientIdentity | null };

const store = new AsyncLocalStorage<CallContext>();

/** Run one tool call inside its context. */
export function withCallContext<T>(context: CallContext, fn: () => T): T {
  return store.run(context, fn);
}

/** The tool-log fields of the current call; none outside a call (tests that call Tools directly). */
export function callLogFields(): { progress_token?: boolean; client?: { name: string; version: string } } {
  const context = store.getStore();
  if (!context) return {};
  const client = context.client;
  return { progress_token: context.progressToken, ...(client ? { client: { name: client.name, version: client.version } } : {}) };
}

/** The client of the current call; null outside a call or when it sent no usable clientInfo. */
export function callClient(): ClientIdentity | null {
  return store.getStore()?.client ?? null;
}
