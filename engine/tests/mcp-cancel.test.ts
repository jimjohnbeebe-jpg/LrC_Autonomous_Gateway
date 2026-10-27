// Issue #208: a client cancelling a tool call, end to end through MCP SDK v2 (src/mcp/server.ts: the
// handler's ctx.mcpReq.signal goes into deadline(), ctx.mcpReq.notify carries notifications/progress;
// deadline.ts comment (d)). A v2 Client calls a tool whose run is held open, takes one progress
// notification, aborts its AbortSignal; this shows (a) the signal deadline() got aborted, (b) the server
// sent no response for the call and the client's promise rejected, (c) the next calls are served, the
// identical one with the kept result of the cancelled run. No Lightroom: a stub Tools, in memory.

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it, vi } from "vitest";
import { createServer, type Tools } from "../src/mcp/index.js";

// Spy on what server.ts passes to deadline(): the real deadline runs.
const spy = vi.hoisted(() => ({ signals: [] as Array<AbortSignal | undefined> }));
vi.mock("../src/mcp/deadline.js", async (importActual) => {
  const actual = await importActual<typeof import("../src/mcp/deadline.js")>();
  return {
    ...actual,
    createDeadline: (opts: Parameters<typeof actual.createDeadline>[0]) => {
      const deadline = actual.createDeadline(opts);
      return (tool: string, args: unknown, run: () => Promise<never>, signal?: AbortSignal) => (spy.signals.push(signal), deadline(tool, args, run, signal));
    },
  };
});

type Content = Array<{ type: string; text?: string }>;
const text = (res: { content: unknown }): string => String((res.content as Content).find((c) => c.type === "text")?.text);

it("cancels a held tool call: its signal aborts, no response is sent, the server serves on", async () => {
  let release = (): void => undefined;
  const held = new Promise<{ json: Record<string, unknown> }>((resolve) => (release = () => resolve({ json: { ok: true, held: "result" } })));
  let runs = 0;
  const pending: string[] = [];
  const tools = {
    getActivePhotoContext: () => (runs++, held),
    progressNote: () => "holding",
    recordPending: (_tool: string, _args: unknown, event: string) => pending.push(event),
  } as unknown as Tools;

  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer(tools, { progressMs: 20, deadlineMs: 60_000 }).connect(serverSide);
  const mcp = new Client({ name: "cancel", version: "0" });
  await mcp.connect(clientSide);
  // Tap what the server sends to the client from here on: responses are the messages with a result or an error.
  const responses: unknown[] = [];
  const deliver = clientSide.onmessage;
  clientSide.onmessage = (message, extra) => {
    if ("result" in message || "error" in message) responses.push(message);
    deliver?.(message, extra);
  };

  const abort = new AbortController();
  const progress: Array<{ progress: number; total?: number | undefined; message?: string | undefined }> = [];
  const call = mcp.callTool({ name: "lr_get_active_photo_context", arguments: {} }, { signal: abort.signal, onprogress: (p) => progress.push(p) });
  const settled = vi.fn();
  call.then(settled, settled);

  await vi.waitFor(() => expect(progress.length).toBeGreaterThanOrEqual(1), { timeout: 2000 });
  expect(progress[0]).toMatchObject({ progress: 1, message: "holding" });
  expect(spy.signals).toHaveLength(1);
  expect(spy.signals[0]?.aborted).toBe(false);

  abort.abort();
  await expect(call).rejects.toThrow(); // (b) the client has no result
  await vi.waitFor(() => expect(spy.signals[0]?.aborted).toBe(true), { timeout: 2000 }); // (a) notifications/cancelled reached the handler
  expect(runs).toBe(1);

  // The run ends after the cancel: deadline() sees the aborted signal ("detached") and the SDK drops the response.
  release();
  await vi.waitFor(() => expect(pending).toEqual(["detached"]), { timeout: 2000 });

  // (c) the server serves on. The identical call gets the kept result of the cancelled run, not a second run (deadline.ts (d))...
  const again = await mcp.callTool({ name: "lr_get_active_photo_context", arguments: {} });
  expect(JSON.parse(text(again))).toEqual({ ok: true, held: "result" });
  expect(runs).toBe(1);
  // ...and another tool answers too.
  const help = await mcp.callTool({ name: "lr_help", arguments: {} });
  expect(JSON.parse(text(help))).toMatchObject({ help: expect.any(String) });

  // (b) the server sent exactly two responses since connecting: those two, none for the cancelled call.
  expect(responses).toHaveLength(2);
  expect(settled).toHaveBeenCalledTimes(1);
  await mcp.close();
});
