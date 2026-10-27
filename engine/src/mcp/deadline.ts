// The call deadline (GitHub issue #155, R3): every tool call answers within CALL_DEADLINE_MS. A run
// still busy then is detached: the call answers a `pending` result (pendingResult) and the run goes on
// in the engine. Calling the same tool again with the same arguments attaches to that run and gets its
// result once it is there; the result is delivered once, then the next identical call starts anew.
//
// The key is the tool name plus the zod-parsed arguments as JSON with the object keys sorted, and the
// entry is stored when the call starts, so two overlapping identical calls share one run.
//
// What this means for callers [inference: from the code below, ISSUE155_PLAN.md R3]:
// (a) a read-only tool's run (readOnlyHint) is kept only until a call with another key arrives: after an
//     lr_step, say, the next lr_get_preview starts a new render instead of receiving the one from
//     before the step. Its run is not cancelled, its result is dropped. A tool that changes something
//     keeps its result for the next identical call (until RESULT_TTL_MS), so a repeated call does not
//     apply or export twice;
// (b) a client that changes an optional argument on its retry does not attach: it starts a second run;
// (c) the work itself keeps running after a detach: the AI mask's 5 minutes and the 90 s write
//     timeouts are unchanged, and nothing is cancelled.
// (d) a call the client cancelled (notifications/cancelled) gets no response: the MCP SDK drops it
//     [handle: node_modules/@modelcontextprotocol/server/dist/src-DdvbAHrR.mjs:6348-6351, 6546, 6562,
//     `if (abortController.signal.aborted) return;`, SDK 2.4.0]. Its result is then kept as after a detach.
// No tool is exempt. respond() never rejects (a failure is an isError result), so a failed run is
// stored and delivered like any other.

import type { CallToolResult } from "@modelcontextprotocol/server";

/**
 * How long a call may run before it answers `pending` [inference: under the 60 s request timeouts of
 * the MCP TS SDK, OpenCode v1 and Codex, with margin; ISSUE155_PLAN.md R3 and its client table].
 */
export const CALL_DEADLINE_MS = 50_000;
/** How long a detached run's result waits for its call after the run finished [inference: the figure]. */
export const RESULT_TTL_MS = 600_000;

export type PendingEvent = "detached" | "attached" | "delivered" | "expired";
export type Deadline = (tool: string, parsedArgs: unknown, run: () => Promise<CallToolResult>, signal?: AbortSignal) => Promise<CallToolResult>;

type Entry = { result: Promise<CallToolResult>; readOnly: boolean; expiry?: NodeJS.Timeout };

/** The answer of a call whose run is still busy at the deadline. */
export function pendingResult(tool: string): CallToolResult {
  const next = `Lightroom is still working on this. Call ${tool} again with exactly the same arguments to get the result; tell the user what it is doing.`;
  return { content: [{ type: "text", text: JSON.stringify({ ok: true, pending: true, tool, next }) }] };
}

/** JSON with every object's keys in sorted order, so that key order does not change the key. */
function stableJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])]));
    return v;
  };
  return JSON.stringify(sort(value)) ?? "";
}

const TIMED_OUT = Symbol("timed out");

/** Resolves with `p`'s value, or TIMED_OUT after `ms`. */
async function within<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => (timer = setTimeout(() => resolve(TIMED_OUT), ms)));
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

type DeadlineOptions = { ms?: number; ttlMs?: number; readOnly?: (tool: string) => boolean; log: (tool: string, args: unknown, pending: PendingEvent) => void };

export function createDeadline(opts: DeadlineOptions): Deadline {
  const ms = opts.ms ?? CALL_DEADLINE_MS;
  const ttlMs = opts.ttlMs ?? RESULT_TTL_MS;
  const entries = new Map<string, Entry>();

  const start = (key: string, tool: string, args: unknown, run: () => Promise<CallToolResult>): Entry => {
    const entry: Entry = { result: run(), readOnly: opts.readOnly?.(tool) === true };
    entries.set(key, entry);
    void entry.result.then(() => {
      if (entries.get(key) !== entry) return;
      entry.expiry = setTimeout(() => {
        if (entries.get(key) !== entry) return;
        entries.delete(key);
        opts.log(tool, args, "expired");
      }, ttlMs).unref();
    });
    return entry;
  };

  /** Comment (a): any other call makes a kept read-only result stale. */
  const dropReadOnly = (key: string): void => {
    for (const [k, e] of entries) {
      if (k === key || !e.readOnly) continue;
      clearTimeout(e.expiry);
      entries.delete(k);
    }
  };

  return async (tool, parsedArgs, run, signal) => {
    const key = `${tool} ${stableJson(parsedArgs)}`;
    dropReadOnly(key);
    let entry = entries.get(key);
    const attached = entry !== undefined;
    if (entry) opts.log(tool, parsedArgs, "attached");
    else entry = start(key, tool, parsedArgs, run);
    const result = await within(entry.result, ms);
    if (result === TIMED_OUT) {
      opts.log(tool, parsedArgs, "detached");
      return pendingResult(tool);
    }
    if (signal?.aborted) {
      // Comment (d): this response is never sent, so the entry and its TTL stay for the next call.
      opts.log(tool, parsedArgs, "detached");
      return result;
    }
    if (entries.get(key) === entry) {
      clearTimeout(entry.expiry);
      entries.delete(key);
    }
    if (attached) opts.log(tool, parsedArgs, "delivered");
    return result;
  };
}
