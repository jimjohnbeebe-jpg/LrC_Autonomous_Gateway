// Issue #155 R3: every tool call answers within the call deadline (src/mcp/deadline.ts). A run still
// busy then answers `pending`; an identical call attaches to it and gets its result once; the work
// keeps its session order. Real timers only: the fake plugin's heartbeat runs on timers.

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BridgeClient } from "../src/bridge/index.js";
import { IntentLibrary } from "../src/intents/index.js";
import { ToolLog } from "../src/log/index.js";
import { CALL_DEADLINE_MS, createDeadline } from "../src/mcp/deadline.js";
import { createServer, ENGINE_VERSION, Tools } from "../src/mcp/index.js";
import { loadDefaultParamMap } from "../src/params/index.js";
import { PreviewService } from "../src/preview/index.js";
import { FakePlugin, type FakeHandler } from "./helpers/fake-plugin.js";
import { LightroomSim } from "./helpers/lightroom-sim.js";

type Content = Array<{ type: string; text?: string }>;
type Answer = { content: unknown; isError?: unknown };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const body = (res: Answer): Record<string, unknown> => JSON.parse(String((res.content as Content).find((c) => c.type === "text")?.text)) as Record<string, unknown>;
const isPending = (res: Answer): boolean => body(res)["pending"] === true;

async function connect(tools: Tools, deadlineMs: number): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer(tools, { deadlineMs }).connect(serverSide);
  const mcp = new Client({ name: "test", version: "0" });
  await mcp.connect(clientSide);
  return mcp;
}

it("keeps the call deadline and its answer under the 55 s of R3", () => {
  expect(CALL_DEADLINE_MS + 3_000).toBeLessThanOrEqual(55_000);
});

it("answers every tool within the deadline when its work never ends", async () => {
  const never = new Proxy({} as Record<string | symbol, unknown>, {
    get: (_t, prop) => {
      if (typeof prop !== "string" || prop === "then") return undefined;
      if (prop === "progressNote") return () => null;
      if (prop.startsWith("record")) return () => undefined;
      return () => new Promise(() => undefined);
    },
  }) as unknown as Tools;
  const mcp = await connect(never, 100);
  const { tools } = await mcp.listTools();
  const answers = await Promise.all(
    tools.map(async (t) => {
      const started = performance.now();
      const res = (await mcp.callTool({ name: t.name, arguments: {} })) as Answer;
      return { name: t.name, ms: performance.now() - started, pending: isPending(res), body: body(res), code: (body(res)["error"] as { code?: string } | undefined)?.code };
    }),
  );
  await mcp.close();
  // lr_help (engine 0.35.0) returns static text without Tools, so it answers at once, not pending.
  const help = answers.find((a) => a.name === "lr_help");
  expect(help?.body["help"]).toEqual(expect.any(String));
  for (const a of answers.filter((x) => x !== help)) {
    expect(a.pending || a.code === "INVALID_ARGUMENTS", `${a.name}: ${JSON.stringify(a)}`).toBe(true);
    expect(a.ms, a.name).toBeLessThan(1000);
  }
  // Every tool that takes {} answers pending (9 of the 35 on 2026-10-15); the others refuse {}.
  const takesNoArgs = tools.filter((t) => t.name !== "lr_help" && (t.inputSchema.required ?? []).length === 0).map((t) => t.name);
  expect(answers.filter((a) => a.pending).map((a) => a.name)).toEqual(takesNoArgs);
  expect(takesNoArgs.length).toBeGreaterThanOrEqual(9);
  expect(answers.find((a) => a.name === "lr_get_preview")?.body).toMatchObject({ ok: true, pending: true, tool: "lr_get_preview", next: expect.stringMatching(/Call lr_get_preview again with exactly the same arguments/) });
});


describe("against the simulated Lightroom", () => {
  let plugin: FakePlugin;
  let bridge: BridgeClient;
  let lr: LightroomSim;
  let tmp: string;
  let logDir: string;
  let tools: Tools;
  let mcp: Client | null = null;

  beforeEach(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-deadline-"));
    logDir = path.join(tmp, "logs");
    const previewDir = path.join(tmp, "previews");
    mkdirSync(previewDir);
    plugin = await FakePlugin.start();
    lr = new LightroomSim(previewDir);
    lr.install(plugin);
    lr.files.exportDir = path.join(tmp, "exports");
    bridge = new BridgeClient({ commandPort: plugin.commandPort, eventPort: plugin.eventPort, connectGapMs: 5, reconnectMs: 30, readToken: () => plugin.token });
    bridge.start();
    tools = new Tools({
      client: bridge,
      map: loadDefaultParamMap(),
      previews: new PreviewService(bridge, { previewDir }),
      intents: new IntentLibrary({ map: loadDefaultParamMap(), userDir: path.join(tmp, "intents") }),
      sessionLogDir: path.join(tmp, "sessions"),
      exportDir: lr.files.exportDir,
      engineVersion: ENGINE_VERSION,
      ensureBridge: () => bridge.waitConnected(2000).then(() => undefined),
      historyPrefix: "AVG test",
      log: new ToolLog(logDir),
    });
  });

  afterEach(async () => {
    await mcp?.close();
    mcp = null;
    bridge.stop();
    await plugin.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  /** Delay a plugin command by `ms` (`once`: its first call only); `runs` counts its calls, `idle()` waits until none is in flight. */
  const delay = (command: string, ms: number, once = false) => {
    const real = plugin.handlers.get(command) as FakeHandler;
    const state = { runs: 0, busy: 0, doneAt: 0, on: true };
    plugin.handlers.set(command, async (p, id) => {
      if (!state.on) return real(p, id);
      state.runs++;
      if (once) state.on = false;
      state.busy++;
      await sleep(ms);
      const reply = await real(p, id);
      state.busy--;
      state.doneAt = performance.now();
      return reply;
    });
    const idle = async () => {
      while (state.busy > 0) await sleep(20);
    };
    return { state, idle };
  };
  const toolLog = () => readdirSync(logDir).flatMap((f) => readFileSync(path.join(logDir, f), "utf8").trim().split("\n")).map((l) => JSON.parse(l) as Record<string, unknown>);
  /** Call until the answer is not `pending`, as a client following `next` does. */
  const settle = async (name: string, args: Record<string, unknown>): Promise<Answer> => {
    for (;;) {
      const res = (await mcp?.callTool({ name, arguments: args })) as Answer;
      if (!isPending(res)) return res;
    }
  };

  it("detaches a slow export, delivers it once to the identical call, and never attaches other arguments", async () => {
    mcp = await connect(tools, 200);
    const exp = delay("export_photo", 600);
    const args = { uuids: ["SIM-UUID"], folder: path.join(tmp, "out"), format: "jpeg" };
    expect(isPending((await mcp.callTool({ name: "lr_export_photos", arguments: args })) as Answer)).toBe(true);
    await exp.idle();
    const second = (await mcp.callTool({ name: "lr_export_photos", arguments: args })) as Answer;
    expect(second.isError).toBeFalsy();
    expect(body(second)).toMatchObject({ exported: [expect.objectContaining({ uuid: "SIM-UUID" })], failed: [] });
    expect(exp.state.runs).toBe(1);
    // Delivered once: the next identical call is a new run.
    expect(isPending((await mcp.callTool({ name: "lr_export_photos", arguments: args })) as Answer)).toBe(true);
    expect(exp.state.runs).toBe(2);
    // Other arguments start their own run.
    expect(isPending((await mcp.callTool({ name: "lr_export_photos", arguments: { ...args, quality: 80 } })) as Answer)).toBe(true);
    await vi.waitFor(() => expect(exp.state.runs).toBe(3), { timeout: 3000 });
    // Two overlapping identical calls (keys in another order) share one run.
    const other = { format: "jpeg", folder: path.join(tmp, "out"), uuids: ["SIM-UUID"], quality: 70 };
    await Promise.all([mcp.callTool({ name: "lr_export_photos", arguments: other }), mcp.callTool({ name: "lr_export_photos", arguments: { ...other } })]);
    // Runs reach the plugin one after another: wait for the fourth, then check no fifth follows.
    await vi.waitFor(() => expect(exp.state.runs).toBe(4), { timeout: 3000 });
    await exp.idle();
    await sleep(300);
    expect(exp.state.runs).toBe(4);
    const pending = toolLog().filter((r) => r["pending"] !== undefined);
    expect(pending.map((r) => r["pending"])).toEqual(expect.arrayContaining(["detached", "attached", "delivered"]));
    for (const r of pending) {
      expect(r).not.toHaveProperty("ok");
      expect(r).not.toHaveProperty("duration_ms");
    }
  });

  it("keeps a detached lr_step ahead of lr_end_session on the same session", async () => {
    mcp = await connect(tools, 300);
    const begun = body(await settle("lr_begin_session", { intent_id: "neutral_technical_correction", max_passes: 2 }));
    const sessionId = String(begun["session_id"]);
    const apply = delay("apply_settings", 800, true);
    const step = (await mcp.callTool({ name: "lr_step", arguments: { session_id: sessionId, settings: { exposure: 0.3 }, rationale: "brighter" } })) as Answer;
    expect(isPending(step)).toBe(true);
    const end = await settle("lr_end_session", { session_id: sessionId, outcome: "revert" });
    const endAt = performance.now();
    expect(body(end)).toMatchObject({ ok: true, outcome: "revert" });
    expect(apply.state.doneAt).toBeGreaterThan(0);
    expect(apply.state.doneAt).toBeLessThan(endAt);
    const dir = path.join(tmp, "sessions");
    const log = readdirSync(dir).filter((f) => f.endsWith(".json") && !f.endsWith(".recipe.json")).map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as { passes: Array<{ kind: string; rationale: string }>; outcome: string });
    expect(log.map((l) => ({ outcome: l.outcome, passes: l.passes.map((p) => `${p.kind}:${p.rationale}`) }))).toEqual([{ outcome: "revert", passes: [expect.stringMatching(/^pass0:/), "step:brighter"] }]);
  });

  it("issue #181: an AI mask's call detached (pending), the Deck's Abort, then the identical call gets SESSION_ENDED, not LIGHTROOM_STUCK", async () => {
    mcp = await connect(tools, 300);
    const sessionId = String(body(await settle("lr_begin_session", { intent_id: "neutral_technical_correction", max_passes: 3 }))["session_id"]);
    [lr.masks.gate, lr.masks.heldProbes] = ["slow", 1_000_000]; // Lightroom computes on and on
    const args = { session_id: sessionId, kind: "landscape_water", rationale: "water", return_image: "none" };
    expect(isPending((await mcp.callTool({ name: "lr_create_mask", arguments: args })) as Answer)).toBe(true);
    const note = tools.sessionManager()?.userAction({ name: "hud_abort", payload: { session_id: sessionId, seq_seen: 1, click_id: "deadline-181", source: "hud" }, received: new Date(), t0: performance.now() });
    expect(note).toMatch(/^Abort: ending the wait for the AI mask/);
    const again = await settle("lr_create_mask", args); // the client follows `next`: the same call again
    expect(again.isError).toBe(true);
    expect(body(again)["error"]).toMatchObject({ code: "SESSION_ENDED", details: { state: "ending" } });
    expect(String((body(again)["error"] as { message: string }).message)).toContain("so the wait for it ended. The session ends now");
    await vi.waitFor(() => expect(tools.sessionManager()?.current()).toBeNull(), { timeout: 3000 });
    const after = (await mcp.callTool({ name: "lr_create_mask", arguments: args })) as Answer; // delivered once: a new run
    expect(body(after)["error"]).toMatchObject({ code: "SESSION_ENDED", details: { outcome: "abandoned" } });
  });
});

describe("createDeadline alone", () => {
  const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
  /** A run that resolves when `finish` is called; `runs` counts starts. */
  const gate = () => {
    const g = { runs: 0, finish: () => undefined as void };
    const run = () => {
      g.runs++;
      return new Promise<ReturnType<typeof ok>>((resolve) => (g.finish = () => resolve(ok(`run ${g.runs}`))));
    };
    return { g, run };
  };

  it("drops a kept read-only result when another call arrives, and keeps a writing tool's", async () => {
    const deadline = createDeadline({ ms: 20, readOnly: (t) => t === "read", log: () => undefined });
    const read = gate();
    const write = gate();
    expect(isPending(await deadline("read", {}, read.run))).toBe(true);
    expect(isPending(await deadline("write", {}, write.run))).toBe(true);
    read.g.finish();
    write.g.finish();
    await deadline("other", {}, async () => ok("other"));
    expect(isPending(await deadline("read", {}, read.run))).toBe(true);
    expect(read.g.runs).toBe(2);
    expect((await deadline("write", {}, write.run)).content).toEqual([{ type: "text", text: "run 1" }]);
    expect(write.g.runs).toBe(1);
  });

  it("keeps the result of a cancelled call for the next identical call", async () => {
    const deadline = createDeadline({ ms: 1000, log: () => undefined });
    const w = gate();
    const abort = new AbortController();
    const first = deadline("write", {}, w.run, abort.signal);
    abort.abort();
    w.g.finish();
    await first;
    const second = await deadline("write", {}, w.run);
    expect((second.content as Content)[0]?.text).toBe("run 1");
    expect(w.g.runs).toBe(1);
  });
});
