// A stand-in for the Lightroom plugin's two listeners (plugin\LrC-AVG.lrplugin\Bridge.lua), for
// bridge contract tests: it reads command lines on one port and writes response/event lines on the
// other, like the real plugin. Ports are chosen by the OS (port 0).

import net from "node:net";

export type FakeReply =
  | { ok: true; payload: unknown }
  | { ok: false; error: { code: string; message: string; recoverable: boolean } }
  | "silent";
export type FakeHandler = (payload: Record<string, unknown>, id: string) => FakeReply | Promise<FakeReply>;

function listen(server: net.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port));
  });
}

export class FakePlugin {
  readonly received: Array<{ name: string; payload: Record<string, unknown> }> = [];
  readonly handlers = new Map<string, FakeHandler>();
  commandPort = 0;
  eventPort = 0;
  answerPings = true;
  helloProtocol = 1;
  /** The token commands must carry, as Bridge.lua checks it. */
  token = "fake-token";
  private readonly commandServer: net.Server;
  private readonly eventServer: net.Server;
  private readonly clients = new Set<net.Socket>();
  private eventClient: net.Socket | null = null;

  constructor() {
    this.handlers.set("hello", () => ({
      ok: true,
      payload: {
        protocol: this.helloProtocol,
        plugin_version: "fake",
        lrc_version: "15.5.1",
        sdk_declared: 13,
        ports: { receive: this.commandPort, send: this.eventPort },
      },
    }));
    this.handlers.set("ping", (payload) =>
      this.answerPings ? { ok: true, payload: { pong: true, ...(payload["nonce"] ? { nonce: payload["nonce"] } : {}) } } : "silent",
    );

    this.commandServer = net.createServer((socket) => {
      this.clients.add(socket);
      socket.on("close", () => this.clients.delete(socket));
      socket.setEncoding("utf8");
      let buffer = "";
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        let i: number;
        while ((i = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, i);
          buffer = buffer.slice(i + 1);
          void this.handle(line);
        }
      });
      socket.on("error", () => {});
    });
    this.eventServer = net.createServer((socket) => {
      this.clients.add(socket);
      socket.on("close", () => {
        this.clients.delete(socket);
        if (this.eventClient === socket) this.eventClient = null;
      });
      socket.on("error", () => {});
      this.eventClient = socket;
    });
  }

  static async start(): Promise<FakePlugin> {
    const plugin = new FakePlugin();
    plugin.commandPort = await listen(plugin.commandServer);
    plugin.eventPort = await listen(plugin.eventServer);
    return plugin;
  }

  private async handle(line: string): Promise<void> {
    const msg = JSON.parse(line) as { id: string; name: string; token?: string; payload?: Record<string, unknown> };
    const payload = msg.payload ?? {};
    this.received.push({ name: msg.name, payload });
    if (msg.token !== this.token) {
      const error = { code: "unauthorized", message: "missing or wrong bridge token", recoverable: true };
      this.send({ id: msg.id, type: "res", name: msg.name, ok: false, error });
      return;
    }
    const handler = this.handlers.get(msg.name);
    const reply: FakeReply = handler
      ? await handler(payload, msg.id)
      : { ok: false, error: { code: "unknown_command", message: `unknown command ${msg.name}`, recoverable: false } };
    if (reply === "silent") return;
    this.send(reply.ok
      ? { id: msg.id, type: "res", name: msg.name, ok: true, payload: reply.payload }
      : { id: msg.id, type: "res", name: msg.name, ok: false, error: reply.error });
  }

  /** Write one envelope as a JSON line on the event socket. */
  send(envelope: unknown): void {
    this.writeRaw(JSON.stringify(envelope) + "\n");
  }

  /** Write raw text or bytes on the event socket (for framing tests). */
  writeRaw(data: string | Buffer): void {
    this.eventClient?.write(data);
  }

  hasEventClient(): boolean {
    return this.eventClient !== null;
  }

  /** Close the engine's event connection, as a lost client would. */
  dropEventClient(): void {
    this.eventClient?.destroy();
  }

  async close(): Promise<void> {
    for (const socket of this.clients) socket.destroy();
    await Promise.all([
      new Promise<void>((resolve) => this.commandServer.close(() => resolve())),
      new Promise<void>((resolve) => this.eventServer.close(() => resolve())),
    ]);
  }
}

export async function waitUntil(predicate: () => boolean, timeoutMs = 2000, stepMs = 5): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
}
