// The HUD channel's transport (Phase 7 row 3, E1; spec docs\hud\lrc-avg-hud-spec-v2.md 3.3, 3.7): a
// WebSocket server on 127.0.0.1 and an ephemeral port (PRD NFR-4), opened by the engine that holds the
// bridge lock (mcp\main.ts) and closed when it gives the lock back or exits. Messages are
// hud\channel-protocol.ts's, one JSON message per frame.
//   - Endpoint file: written when the listener opens (to a temporary name, then renamed, so the Deck
//     never reads half a file), deleted at close, but only while it still holds this listener's token.
//     The token is 32 random bytes, hex, new for each listener.
//   - Handshake: the first message must be `hello` with the token, compared in constant time, within
//     HELLO_MS; otherwise the socket is closed. A valid hello replaces the client before it (one client
//     at a time), and gets `welcome`.
//   - Heartbeat: `ping` every PING_MS; a client from which nothing came for MISSED_PINGS pings is
//     dropped (3.7, mirroring the bridge client's 2 s and 3 beats, bridge\client.ts header).
// What the messages mean is hud\deck.ts's.
// [handle: tests\hud-channel.test.ts]

import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { deckMessageSchema, hudEndpointSchema, type DeckMessage, type EngineMessage } from "./channel-protocol.js";

export const PING_MS = 2000;
export const MISSED_PINGS = 3;
/** How long a new socket has to send its hello [inference: a local hello takes milliseconds]. */
const HELLO_MS = 5000;
/** The largest frame a Deck may send [inference: its messages are a few hundred bytes]. */
const MAX_FRAME = 64 * 1024;

export function defaultHudEndpointPath(): string {
  return path.join(homedir(), ".lrc-avg", "hud_endpoint.json");
}

export type HudChannelOptions = {
  engineVersion: string;
  /** Where the endpoint file goes (defaultHudEndpointPath() when absent). */
  endpointPath?: string;
  /** The welcome's open edit and Lightroom state, read at each hello. */
  welcome: () => Pick<Extract<EngineMessage, { type: "welcome" }>, "session_id" | "lightroom">;
  /** A client was taken (true) or lost (false). */
  onClient?: (connected: boolean) => void;
  /** A message from the client after its hello (not pong). */
  onMessage?: (msg: Exclude<DeckMessage, { type: "hello" | "pong" }>) => void;
  /** Called at every ping, while the listener is open. */
  onTick?: () => void;
  log?: (message: string) => void;
  /** Tests shorten it. */
  pingMs?: number;
};

export class HudChannel {
  private readonly opts: HudChannelOptions;
  private readonly endpointPath: string;
  private readonly pingMs: number;
  private readonly log: (message: string) => void;
  private server: WebSocketServer | null = null;
  private opening: Promise<void> | null = null;
  private token = "";
  private client: WebSocket | null = null;
  private version: string | null = null;
  private lastInbound = 0;
  private timer: NodeJS.Timeout | null = null;
  /** Rises with each listen and close, so a listen that close() overtook does not open. */
  private generation = 0;

  constructor(options: HudChannelOptions) {
    this.opts = options;
    this.endpointPath = options.endpointPath ?? defaultHudEndpointPath();
    this.pingMs = options.pingMs ?? PING_MS;
    this.log = options.log ?? (() => {});
  }

  /** Open the listener and write the endpoint file; resolves once both are done (at once when open). */
  open(): Promise<void> {
    if (this.server) return Promise.resolve();
    this.opening ??= this.listen().finally(() => {
      this.opening = null;
    });
    return this.opening;
  }

  /** Close the client and the listener and delete the endpoint file; synchronous, so it runs at exit. */
  close(): void {
    this.generation++;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const server = this.server;
    this.server = null; // first, so the client's loss is reported with the listener already closed (sinks.ts starts no Deck then)
    this.dropClient("the listener closed");
    server?.close();
    this.deleteEndpoint();
  }

  listening(): boolean {
    return this.server !== null;
  }

  connected(): boolean {
    return this.client !== null;
  }

  /** The connected client's `hud_version` from its hello, else null. */
  clientVersion(): string | null {
    return this.client ? this.version : null;
  }

  /** Send to the client; false when there is none. */
  send(msg: EngineMessage): boolean {
    if (!this.client) return false;
    this.client.send(JSON.stringify(msg));
    return true;
  }

  private async listen(): Promise<void> {
    const generation = ++this.generation;
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0, maxPayload: MAX_FRAME });
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    // close() ran while the listener was opening: it stays closed.
    if (generation !== this.generation) return void server.close();
    server.on("error", (err) => this.log(`HUD channel: ${err.message}`));
    server.on("connection", (ws) => this.accept(ws));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    this.token = randomBytes(32).toString("hex");
    try {
      this.writeEndpoint(port);
    } catch (err) {
      server.close(); // no Deck could find it
      throw err;
    }
    this.server = server;
    this.timer = setInterval(() => this.tick(), this.pingMs);
    this.timer.unref();
    this.log(`HUD channel listening on 127.0.0.1:${port}`);
  }

  private writeEndpoint(port: number): void {
    const endpoint = hudEndpointSchema.parse({ port, token: this.token, pid: process.pid, engine_version: this.opts.engineVersion, written_at: new Date().toISOString() });
    mkdirSync(path.dirname(this.endpointPath), { recursive: true });
    const temp = `${this.endpointPath}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(endpoint));
    renameSync(temp, this.endpointPath);
  }

  /** Delete the endpoint file if it is still this listener's (another engine may have written its own since). */
  private deleteEndpoint(): void {
    try {
      const file = hudEndpointSchema.safeParse(JSON.parse(readFileSync(this.endpointPath, "utf8")));
      if (file.success && file.data.token === this.token) unlinkSync(this.endpointPath);
    } catch {
      // no file, or not ours to read: nothing to delete
    }
  }

  private accept(ws: WebSocket): void {
    let greeted = false;
    const helloTimer = setTimeout(() => ws.close(1008, "no hello"), HELLO_MS);
    helloTimer.unref();
    ws.on("error", (err) => this.log(`HUD channel client: ${err.message}`));
    ws.on("close", () => {
      clearTimeout(helloTimer);
      if (this.client !== ws) return;
      this.client = null;
      this.opts.onClient?.(false);
    });
    ws.on("message", (data, isBinary) => {
      const msg = isBinary ? null : parse(data.toString());
      if (!greeted) {
        if (msg?.type !== "hello" || !this.tokenMatches(msg.token)) return ws.close(1008, "hello refused");
        greeted = true;
        clearTimeout(helloTimer);
        return this.take(ws, msg.hud_version);
      }
      if (this.client !== ws) return;
      this.lastInbound = Date.now();
      if (!msg) return this.log("HUD channel: a message that is not the protocol's, ignored");
      if (msg.type === "hello" || msg.type === "pong") return;
      this.opts.onMessage?.(msg);
    });
  }

  private take(ws: WebSocket, version: string): void {
    const old = this.client;
    this.client = ws;
    this.version = version;
    this.lastInbound = Date.now();
    if (old) old.close(1000, "replaced by a newer client");
    this.send({ type: "welcome", engine_version: this.opts.engineVersion, ...this.opts.welcome() });
    // A replaced client's close event finds this.client changed and reports nothing, so this is the one report.
    this.opts.onClient?.(true);
  }

  private tokenMatches(given: string): boolean {
    const a = Buffer.from(given);
    const b = Buffer.from(this.token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private tick(): void {
    if (this.client && Date.now() - this.lastInbound > this.pingMs * MISSED_PINGS) this.dropClient(`no message for ${MISSED_PINGS} pings`);
    this.send({ type: "ping" });
    this.opts.onTick?.();
  }

  private dropClient(why: string): void {
    const ws = this.client;
    if (!ws) return;
    this.client = null;
    this.log(`HUD channel: client dropped, ${why}`);
    ws.terminate();
    this.opts.onClient?.(false);
  }
}

function parse(raw: string): DeckMessage | null {
  try {
    const parsed = deckMessageSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
