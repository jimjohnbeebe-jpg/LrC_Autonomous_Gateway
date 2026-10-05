// The Deck's side of the HUD tests (hud-channel*.test.ts, hud-fallback, hud-thumbs, hud-selection-poll,
// hud-launch; Phase 7 row 3): SimHudClient, a stand-in for the Deck (Phase 7 row 4) that reads the
// endpoint file, says hello and collects what the engine sends; and deckRig, the session harness's
// manager reporting to the classic HUD and the Deck through HudFanOut, as mcp\tools-shared.ts wires
// them, with the channel open and its endpoint file in the test's temporary folder. Call deckRig after
// useSessionHarness(), inside a test.

import { readFileSync } from "node:fs";
import path from "node:path";
import { onTestFinished } from "vitest";
import WebSocket from "ws";
import {
  Deck,
  HudEvents,
  HudFanOut,
  HudLauncher,
  HudPublisher,
  engineMessageSchema,
  hudEndpointSchema,
  type DeckRecord,
  type EngineMessage,
  type HudChannelState,
  type HudEventRecord,
} from "../../src/hud/index.js";
import type { SessionManager } from "../../src/session/index.js";
import { waitUntil } from "./fake-plugin.js";
import { client, newManager, tmp } from "./session-harness.js";

type StateMessage = Extract<EngineMessage, { type: "state" }>;

export class SimHudClient {
  readonly received: EngineMessage[] = [];
  /** Messages that failed engineMessageSchema (none expected). */
  readonly invalid: unknown[] = [];
  closed = false;
  /** Answer each ping with a pong (false: go silent, to be dropped). */
  pong = true;
  private readonly ws: WebSocket;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on("message", (data) => {
      const raw: unknown = JSON.parse(data.toString());
      const parsed = engineMessageSchema.safeParse(raw);
      if (!parsed.success) return void this.invalid.push(raw);
      this.received.push(parsed.data);
      if (parsed.data.type === "ping" && this.pong) this.send({ type: "pong" });
    });
    ws.on("close", () => {
      this.closed = true;
    });
  }

  /** Connect to the endpoint file's port and say hello (with `token`, the file's when absent). */
  static async connect(endpointPath: string, options: { token?: string; hello?: boolean } = {}): Promise<SimHudClient> {
    const endpoint = hudEndpointSchema.parse(JSON.parse(readFileSync(endpointPath, "utf8")));
    const ws = new WebSocket(`ws://127.0.0.1:${endpoint.port}`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    const sim = new SimHudClient(ws);
    onTestFinished(() => sim.close());
    if (options.hello !== false) sim.send({ type: "hello", token: options.token ?? endpoint.token, hud_version: "test", pid: process.pid });
    return sim;
  }

  send(msg: Record<string, unknown>): void {
    this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.ws.close();
  }

  states(): StateMessage[] {
    return this.received.filter((m): m is StateMessage => m.type === "state");
  }

  last(): HudChannelState | undefined {
    return this.states().at(-1)?.state;
  }

  async welcomed(timeoutMs = 2000): Promise<Extract<EngineMessage, { type: "welcome" }>> {
    await waitUntil(() => this.received.some((m) => m.type === "welcome"), timeoutMs);
    return this.received.find((m) => m.type === "welcome") as Extract<EngineMessage, { type: "welcome" }>;
  }

  /** Wait until the Deck's state is at `stage` (and `pred` holds); returns that state. */
  async at(stage: string, pred: (s: HudChannelState) => boolean = () => true, timeoutMs = 3000): Promise<HudChannelState> {
    await waitUntil(() => this.last()?.stage === stage && pred(this.last() as HudChannelState), timeoutMs);
    return this.last() as HudChannelState;
  }

  /** Send a click as the Deck would; returns its click_id. */
  click(name: string, payload: Record<string, unknown>, clickId = `deck-${Math.random().toString(16).slice(2)}`): string {
    this.send({ type: "event", name, payload: { seq_seen: 1, source: "hud", ...payload, click_id: clickId } });
    return clickId;
  }
}

export type DeckRig = {
  deck: Deck;
  hud: HudPublisher;
  manager: SessionManager;
  launcher: HudLauncher;
  endpoint: string;
  /** Each time the launcher started the "Deck". */
  started: string[];
  records: DeckRecord[];
  events: HudEventRecord[];
};

/**
 * The rig. `exe`: what the launcher finds (null: no Deck installed); `onStart`: what a start does
 * (default: nothing connects). Times are shortened: ping `pingMs` (default 100 ms), wait `waitMs` (300 ms).
 * `newId`: the edits' ids (the harness's ID for every edit when absent).
 */
export async function deckRig(options: { exe?: string | null; onStart?: () => void; pingMs?: number; waitMs?: number; newId?: () => string } = {}): Promise<DeckRig> {
  const endpoint = path.join(tmp, "lrc-avg", "hud_endpoint.json");
  const started: string[] = [];
  const records: DeckRecord[] = [];
  const events: HudEventRecord[] = [];
  let manager: SessionManager | null = null;
  const hud = new HudPublisher(client);
  const deck = new Deck({
    client,
    engineVersion: "test",
    openSession: () => manager?.current()?.id ?? null,
    busy: () => manager?.busy() ?? false,
    endpointPath: endpoint,
    pingMs: options.pingMs ?? 100,
    record: (r) => records.push(r),
  });
  const exe = options.exe === undefined ? "C:\\sim\\LrC-AVG HUD.exe" : options.exe;
  const launcher = new HudLauncher({
    exe: () => exe,
    start: (e) => {
      started.push(e);
      options.onStart?.();
    },
  });
  manager = newManager({ hud: new HudFanOut(hud, deck, launcher, { waitMs: options.waitMs ?? 300 }), ...(options.newId ? { newId: options.newId } : {}) });
  const hudEvents = new HudEvents(client, manager, hud, { record: (r) => events.push(r), deck });
  deck.onEvent((e) => hudEvents.handle(e, "channel"));
  await deck.open();
  onTestFinished(() => deck.close());
  return { deck, hud, manager, launcher, endpoint, started, records, events };
}
