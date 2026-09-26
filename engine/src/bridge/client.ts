// Bridge client: the engine side of the dual-socket bridge (ARCHITECTURE sections 1-3, AVG-004).
//
// Lightroom listens and the engine connects, on 127.0.0.1 only (PRD NFR-4):
//   command socket -> plugin receive port (8765): the engine writes commands
//   event socket   <- plugin send port (8766): the engine reads responses and events
// Lifecycle (PRD FR-1.3): try both ports every 2 s until the plugin is there; send `hello`; ping
// every 2 s; after 3 heartbeats without any inbound line, drop both sockets and reconnect.
// Pending requests are rejected when the bridge drops, never left hanging.
//
// Derived from Automaat's server/src/plugin-socket.ts and server/src/dispatcher.ts (MIT, see
// engine/THIRD_PARTY_NOTICES.md): the connect-then-reconnect TCP client and the id-correlated
// request table with timeouts. Automaat connects the request side first [upstream claim:
// vendor/automaat/server/src/index.ts:143-157]; we also wait `connectGapMs` before the event socket,
// so the plugin can rebind its send socket for the new client first (Phase 0, P-13).

import { randomUUID } from "node:crypto";
import net from "node:net";
import { LineSplitter, LineTooLongError } from "./lines.js";
import {
  COMMANDS,
  inboundSchema,
  PROTOCOL_VERSION,
  type CommandName,
  type CommandPayloads,
  type CommandResult,
  type EventEnvelope,
  type HelloResult,
} from "./protocol.js";

export type BridgeState = "stopped" | "connecting" | "handshaking" | "connected";

/** A structured bridge failure ({code, message, recoverable}, PRD NFR-7). */
export class BridgeError extends Error {
  readonly code: string;
  readonly recoverable: boolean;
  readonly command: string | null;

  constructor(code: string, message: string, recoverable: boolean, command: string | null = null) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
    this.recoverable = recoverable;
    this.command = command;
  }
}

export type BridgeClientOptions = {
  host?: string;
  /** The plugin's receive socket: the engine writes commands here. */
  commandPort?: number;
  /** The plugin's send socket: the engine reads responses and events here. */
  eventPort?: number;
  reconnectMs?: number;
  heartbeatMs?: number;
  missedBeats?: number;
  requestTimeoutMs?: number;
  handshakeTimeoutMs?: number;
  connectTimeoutMs?: number;
  /** Pause between connecting the command socket and the event socket. */
  connectGapMs?: number;
  engineVersion?: string;
  log?: (message: string) => void;
};

export type BridgeStats = {
  connects: number;
  /** Connection attempts that failed before the handshake started (e.g. Lightroom not running). */
  connect_failures: number;
  last_connect_error: string | null;
  /** Established or handshaking connections that were lost. */
  drops: number;
  last_drop_reason: string | null;
  malformed_lines: number;
  unknown_response_ids: number;
};

type Pending = {
  name: string;
  resolve: (payload: unknown) => void;
  reject: (error: BridgeError) => void;
  timer: NodeJS.Timeout;
};

const DEFAULTS = {
  host: "127.0.0.1",
  commandPort: 8765,
  eventPort: 8766,
  reconnectMs: 2000,
  heartbeatMs: 2000,
  missedBeats: 3,
  requestTimeoutMs: 15000,
  handshakeTimeoutMs: 5000,
  connectTimeoutMs: 2000,
  connectGapMs: 500,
  engineVersion: "0.0.0",
};

function openSocket(host: string, port: number, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    socket.setNoDelay(true);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`connect to ${host}:${port} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.removeAllListeners("error");
      resolve(socket);
    });
    socket.once("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      socket.destroy();
      reject(new Error(`${host}:${port}: ${err.code ?? err.message}`));
    });
  });
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class BridgeClient {
  private readonly opts: Required<Omit<BridgeClientOptions, "log">>;
  private readonly log: (message: string) => void;
  private state: BridgeState = "stopped";
  private attempt = 0;
  private commandSocket: net.Socket | null = null;
  private eventSocket: net.Socket | null = null;
  private splitter = new LineSplitter();
  private readonly pending = new Map<string, Pending>();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private lastInbound = 0;
  private helloResult: HelloResult | null = null;
  private readonly stateListeners = new Set<(state: BridgeState) => void>();
  private readonly eventListeners = new Set<(event: EventEnvelope) => void>();
  readonly stats: BridgeStats = {
    connects: 0,
    connect_failures: 0,
    last_connect_error: null,
    drops: 0,
    last_drop_reason: null,
    malformed_lines: 0,
    unknown_response_ids: 0,
  };

  constructor(options: BridgeClientOptions = {}) {
    const { log, ...rest } = options;
    this.opts = { ...DEFAULTS, ...rest };
    this.log = log ?? (() => {});
  }

  getState(): BridgeState {
    return this.state;
  }

  /** The plugin's hello payload from the current connection, or null. */
  hello(): HelloResult | null {
    return this.helloResult;
  }

  onStateChange(listener: (state: BridgeState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onEvent(listener: (event: EventEnvelope) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  start(): void {
    if (this.state !== "stopped") return;
    this.setState("connecting");
    void this.connect();
  }

  stop(): void {
    this.attempt++;
    this.clearTimers();
    this.closeSockets();
    this.rejectAll(new BridgeError("stopped", "bridge client stopped", false));
    this.helloResult = null;
    this.setState("stopped");
  }

  /** Resolves with the plugin's hello once connected; rejects after timeoutMs. */
  waitConnected(timeoutMs: number): Promise<HelloResult> {
    if (this.state === "connected" && this.helloResult) return Promise.resolve(this.helloResult);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new BridgeError("not_connected", `Lightroom plugin not connected within ${timeoutMs} ms`, true));
      }, timeoutMs);
      const off = this.onStateChange((state) => {
        if (state === "connected" && this.helloResult) {
          clearTimeout(timer);
          off();
          resolve(this.helloResult);
        }
      });
    });
  }

  /** Send a command and wait for its validated result. Rejects with BridgeError. */
  request<N extends CommandName>(
    name: N,
    payload: CommandPayloads[N],
    options: { timeoutMs?: number } = {},
  ): Promise<CommandResult<N>> {
    if (this.state !== "connected") {
      return Promise.reject(new BridgeError("not_connected", `bridge is ${this.state}`, true, name));
    }
    return this.send(name, payload, options.timeoutMs ?? this.opts.requestTimeoutMs);
  }

  private async send<N extends CommandName>(name: N, payload: CommandPayloads[N], timeoutMs: number): Promise<CommandResult<N>> {
    const socket = this.commandSocket;
    if (!socket) throw new BridgeError("not_connected", "no command socket", true, name);
    const id = randomUUID();
    const line = JSON.stringify({ id, type: "cmd", name, ts: new Date().toISOString(), payload }) + "\n";
    const raw = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BridgeError("timeout", `${name}: no response within ${timeoutMs} ms`, true, name));
      }, timeoutMs);
      this.pending.set(id, { name, resolve, reject, timer });
      socket.write(line, (err) => {
        if (!err) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new BridgeError("disconnected", `${name}: write failed: ${err.message}`, true, name));
      });
    });
    const parsed = COMMANDS[name].safeParse(raw);
    if (!parsed.success) {
      throw new BridgeError("bad_response", `${name}: unexpected result: ${parsed.error.message}`, false, name);
    }
    return parsed.data as CommandResult<N>;
  }

  private setState(state: BridgeState): void {
    if (this.state === state) return;
    this.state = state;
    this.log(`bridge: ${state}`);
    for (const listener of this.stateListeners) listener(state);
  }

  private async connect(): Promise<void> {
    const attempt = ++this.attempt;
    const current = (): boolean => attempt === this.attempt;
    this.setState("connecting");
    try {
      const commandSocket = await openSocket(this.opts.host, this.opts.commandPort, this.opts.connectTimeoutMs);
      if (!current()) return void commandSocket.destroy();
      this.commandSocket = commandSocket;
      commandSocket.on("error", (err) => current() && this.drop(`command socket error: ${err.message}`));
      commandSocket.on("close", () => current() && this.drop("command socket closed"));

      await delay(this.opts.connectGapMs);
      if (!current()) return;
      const eventSocket = await openSocket(this.opts.host, this.opts.eventPort, this.opts.connectTimeoutMs);
      if (!current()) return void eventSocket.destroy();
      this.eventSocket = eventSocket;
      this.splitter = new LineSplitter();
      eventSocket.setEncoding("utf8");
      eventSocket.on("data", (chunk: string) => current() && this.onData(chunk));
      eventSocket.on("error", (err) => current() && this.drop(`event socket error: ${err.message}`));
      eventSocket.on("close", () => current() && this.drop("event socket closed"));

      this.setState("handshaking");
      this.lastInbound = Date.now();
      const hello = await this.send("hello", { protocol: PROTOCOL_VERSION, engine_version: this.opts.engineVersion }, this.opts.handshakeTimeoutMs);
      if (!current()) return;
      if (hello.protocol !== PROTOCOL_VERSION) {
        this.drop(`plugin speaks protocol ${hello.protocol}, engine speaks ${PROTOCOL_VERSION}`);
        return;
      }
      this.helloResult = hello;
      this.stats.connects++;
      this.startHeartbeat(attempt);
      this.setState("connected");
    } catch (err) {
      if (current()) this.drop(err instanceof Error ? err.message : String(err));
    }
  }

  private startHeartbeat(attempt: number): void {
    const { heartbeatMs, missedBeats } = this.opts;
    this.heartbeatTimer = setInterval(() => {
      if (attempt !== this.attempt) return;
      const silentMs = Date.now() - this.lastInbound;
      if (silentMs > heartbeatMs * missedBeats) {
        this.drop(`heartbeat: no message from the plugin for ${silentMs} ms`);
        return;
      }
      this.send("ping", {}, heartbeatMs * missedBeats).catch(() => {
        // A lost ping shows up as silence; the check above handles it.
      });
    }, heartbeatMs);
  }

  private onData(chunk: string): void {
    let lines: string[];
    try {
      lines = this.splitter.push(chunk);
    } catch (err) {
      if (err instanceof LineTooLongError) return this.drop(err.message);
      throw err;
    }
    for (const line of lines) {
      this.lastInbound = Date.now();
      let json: unknown;
      try {
        json = JSON.parse(line);
      } catch {
        this.stats.malformed_lines++;
        this.log(`bridge: ignored a line that is not JSON (${line.length} chars)`);
        continue;
      }
      const parsed = inboundSchema.safeParse(json);
      if (!parsed.success) {
        this.stats.malformed_lines++;
        this.log(`bridge: ignored a line that is not a response or event: ${parsed.error.message}`);
        continue;
      }
      const message = parsed.data;
      if (message.type === "evt") {
        for (const listener of this.eventListeners) listener(message);
        continue;
      }
      const waiter = this.pending.get(message.id);
      if (!waiter) {
        this.stats.unknown_response_ids++;
        this.log(`bridge: response ${message.name} ${message.id} has no waiting request (timed out?)`);
        continue;
      }
      this.pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.ok) {
        waiter.resolve(message.payload);
      } else {
        const e = message.error;
        waiter.reject(
          new BridgeError(e?.code ?? "plugin_error", e?.message ?? "the plugin reported a failure", e?.recoverable ?? false, waiter.name),
        );
      }
    }
  }

  private drop(reason: string): void {
    if (this.state === "stopped") return;
    this.attempt++;
    if (this.state === "connecting") {
      // Lightroom not running or the plugin not listening yet: retry quietly.
      this.stats.connect_failures++;
      this.stats.last_connect_error = reason;
    } else {
      this.stats.drops++;
      this.stats.last_drop_reason = reason;
      this.log(`bridge: dropped (${reason})`);
    }
    this.clearTimers();
    this.closeSockets();
    this.rejectAll(new BridgeError("disconnected", `bridge dropped: ${reason}`, true));
    this.helloResult = null;
    this.setState("connecting");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, this.opts.reconnectMs);
  }

  private closeSockets(): void {
    this.commandSocket?.destroy();
    this.eventSocket?.destroy();
    this.commandSocket = null;
    this.eventSocket = null;
    this.splitter.reset();
  }

  private clearTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
  }

  private rejectAll(error: BridgeError): void {
    for (const [id, waiter] of this.pending) {
      clearTimeout(waiter.timer);
      waiter.reject(new BridgeError(error.code, error.message, error.recoverable, waiter.name));
      this.pending.delete(id);
    }
  }
}
