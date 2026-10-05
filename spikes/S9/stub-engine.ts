// Spike S9: a stand-in for the engine's HUD channel (spec 3.3; D3). It listens on 127.0.0.1 only,
// writes %USERPROFILE%\.lrc-avg\hud_endpoint.json (port, token, pid, engine_version, written_at),
// checks the HUD's token in constant time, and sends the scripted states W, V and C. No Claude, no
// Lightroom: it never opens the bridge ports.
//
// Run by measure.ts as `node spikes\S9\stub-engine.ts <hud exe>`. Control on stdin, one JSON line each:
//   {"cmd":"spawn"}  start the HUD detached (spec 3.2, E8), so it outlives this process (S9-9)
//   {"cmd":"state","name":"W"|"V"|"C"}  send a full state with seq + 1
//   {"cmd":"spike","action":"show"|"hide"}  ask the HUD to show or hide itself (S9 only)
//   {"cmd":"quit"}  delete the endpoint file and exit
// Events on stdout, one JSON line each, with `t` in epoch ms (performance.timeOrigin + now()).
import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { z } from "zod";
import { WebSocketServer, type WebSocket } from "ws";
import { clientMessageSchema, type HudState, type ServerMessage } from "./channel.ts";

const now = (): number => performance.timeOrigin + performance.now();
const emit = (ev: string, body: Record<string, unknown> = {}): void => {
  process.stdout.write(JSON.stringify({ ev, t: now(), ...body }) + "\n");
};

const hudExe = process.argv[2];
if (!hudExe) throw new Error("usage: node stub-engine.ts <hud exe>");

const SESSION = "s9-" + randomBytes(3).toString("hex");
const TARGET = { uuid: "S9-STUB-PHOTO", filename: "_DSC0412.NEF" };
const SNAPSHOT = "AVG pre-session 2026-10-04T12-00-00Z";
/** The scripted states (spec D2 S9 harness: "scripted states"; option-c/NOTES.md section 2 rows W, V, C). */
const STATES: Record<"W" | "V" | "C", HudState> = {
  W: { session_id: SESSION, stage: "awaiting_claude", mode: "converge", pass: 2, max_passes: 6, target: TARGET, snapshot: SNAPSHOT },
  V: { session_id: SESSION, stage: "awaiting_pick", mode: "variants", pass: 0, max_passes: 6, target: TARGET, variants: ["A", "B", "C"], snapshot: SNAPSHOT },
  C: { session_id: SESSION, stage: "converged", mode: "converge", pass: 3, max_passes: 6, target: TARGET, snapshot: SNAPSHOT },
};

const controlSchema = z.discriminatedUnion("cmd", [
  z.strictObject({ cmd: z.literal("spawn") }),
  z.strictObject({ cmd: z.literal("state"), name: z.enum(["W", "V", "C"]) }),
  z.strictObject({ cmd: z.literal("spike"), action: z.enum(["show", "hide"]) }),
  z.strictObject({ cmd: z.literal("quit") }),
]);

const token = randomBytes(32).toString("hex");
const endpointPath = join(homedir(), ".lrc-avg", "hud_endpoint.json");
let client: WebSocket | null = null;
let seq = 0;
let current: "W" | "V" | "C" = "W";

function send(ws: WebSocket, msg: ServerMessage): void {
  ws.send(JSON.stringify(msg));
}

function sendState(name: "W" | "V" | "C"): void {
  current = name;
  if (!client) return emit("not_sent", { name, reason: "no client" });
  seq += 1;
  send(client, { type: "state", seq, state: STATES[name] });
  emit("sent", { seq, name });
}

function tokenMatches(given: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });

wss.on("listening", () => {
  const address = wss.address();
  const port = typeof address === "object" && address ? address.port : 0;
  mkdirSync(join(homedir(), ".lrc-avg"), { recursive: true });
  const endpoint = { port, token, pid: process.pid, engine_version: "s9-stub", written_at: new Date().toISOString() };
  writeFileSync(endpointPath, JSON.stringify(endpoint));
  emit("listening", { port, session_id: SESSION });
});

wss.on("connection", (ws, req) => {
  let greeted = false;
  const helloTimer = setTimeout(() => greeted || ws.close(), 5000); // no hello, no socket
  ws.on("message", (data) => {
    let parsed;
    try {
      parsed = clientMessageSchema.safeParse(JSON.parse(String(data)));
    } catch {
      parsed = null;
    }
    if (!parsed?.success) return emit("bad_message", { text: String(data).slice(0, 200) });
    const msg = parsed.data;
    if (!greeted) {
      if (msg.type !== "hello" || !tokenMatches(msg.token)) {
        emit("rejected", { type: msg.type });
        return ws.close();
      }
      greeted = true;
      clearTimeout(helloTimer);
      client?.close();
      client = ws;
      emit("hello", { pid: msg.pid, hud_version: msg.hud_version, reduced_motion: msg.reduced_motion, origin: req.headers.origin ?? null });
      send(ws, { type: "welcome", engine_version: "s9-stub", session_id: SESSION, lightroom: "connected" });
      return sendState(current);
    }
    if (msg.type === "paint") emit("paint", { seq: msg.seq, t_paint: msg.t });
  });
  ws.on("close", () => {
    if (client === ws) {
      client = null;
      emit("closed");
    }
  });
});

setInterval(() => {
  if (client) send(client, { type: "ping" });
}, 2000);

function removeEndpoint(): void {
  try {
    const text = readFileSync(endpointPath, "utf8");
    if ((JSON.parse(text) as { pid?: number }).pid === process.pid) unlinkSync(endpointPath);
  } catch {
    // already gone
  }
}
process.on("exit", removeEndpoint);

createInterface({ input: process.stdin }).on("line", (line) => {
  let parsed;
  try {
    parsed = controlSchema.safeParse(JSON.parse(line));
  } catch {
    parsed = null;
  }
  if (!parsed?.success) return emit("bad_control", { line: line.slice(0, 200) });
  const c = parsed.data;
  if (c.cmd === "spawn") {
    // detached: libuv otherwise ties the child to this process's job [inference]; windowsHide is
    // left off, so STARTUPINFO's show flag cannot affect the HUD's first ShowWindow [inference].
    const child = spawn(hudExe, [], { detached: true, stdio: "ignore" });
    child.unref();
    emit("spawned", { pid: child.pid ?? null });
  } else if (c.cmd === "state") {
    sendState(c.name);
  } else if (c.cmd === "spike") {
    if (client) send(client, { type: "spike", action: c.action });
    emit("sent_spike", { action: c.action, sent: client !== null });
  } else {
    process.exit(0);
  }
});
