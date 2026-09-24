// AVG-S2 client: connect to the S2 plugin's two LrSocket listeners, send hello,
// then a 1 MB base64 string, verify the length-prefixed echo, measure round trips,
// then probe larger messages to find the largest that survives.
//
// Run (Lightroom open, "AVG S2 - Start echo server" clicked first):
//   node spikes/S2/client.ts [--max-mb 16] [--timeout-s 30]
//
// Ports: 8765 = plugin "receive" socket (we write), 8766 = plugin "send" socket (we read).
// Framing: newline-terminated lines (Automaat's framing, server/src/plugin-socket.ts:53-62, :93).
// Echo format from the plugin: "<length as Lua saw it>:<payload>\n".

import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const HOST = "127.0.0.1";
const WRITE_PORT = 8765;
const READ_PORT = 8766;

const args = process.argv.slice(2);
const argValue = (flag: string, fallback: number): number => {
  const i = args.indexOf(flag);
  const v = i >= 0 ? Number(args[i + 1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : fallback;
};
const MAX_MB = argValue("--max-mb", 16);
const TIMEOUT_MS = argValue("--timeout-s", 30) * 1000;

interface Echo {
  line: string;
  at: number;
}

class EchoReader {
  private buffer = "";
  private queue: Echo[] = [];
  private waiters: Array<(e: Echo) => void> = [];

  feed(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      const echo = { line, at: performance.now() };
      const waiter = this.waiters.shift();
      if (waiter) waiter(echo);
      else this.queue.push(echo);
    }
  }

  next(timeoutMs: number): Promise<Echo | null> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve) => {
      const waiter = (e: Echo) => {
        clearTimeout(timer);
        resolve(e);
      };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        resolve(null);
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  pendingBytes(): number {
    return this.buffer.length;
  }
}

function connect(port: number, label: string, deadlineMs: number): Promise<net.Socket> {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const sock = net.connect({ host: HOST, port });
      sock.setNoDelay(true);
      sock.once("connect", () => {
        console.log(`[${label}] connected to ${HOST}:${port} after ${(performance.now() - started).toFixed(0)} ms`);
        resolve(sock);
      });
      sock.once("error", (err: NodeJS.ErrnoException) => {
        sock.destroy();
        if (performance.now() - started > deadlineMs) reject(new Error(`[${label}] ${port}: ${err.code ?? err.message}`));
        else setTimeout(attempt, 500);
      });
    };
    attempt();
  });
}

function payloadOfChars(chars: number): string {
  // base64 of n bytes has 4*ceil(n/3) chars; pick n so the length is exactly `chars` (a multiple of 4).
  return randomBytes((chars / 4) * 3).toString("base64");
}

interface Trial {
  label: string;
  sent_chars: number;
  ok: boolean;
  rtt_ms: number | null;
  echoed_length_field: number | null;
  payload_match: boolean | null;
  note: string;
}

async function roundTrip(writer: net.Socket, reader: EchoReader, label: string, message: string): Promise<Trial> {
  const t0 = performance.now();
  writer.write(message + "\n");
  const echo = await reader.next(TIMEOUT_MS);
  if (!echo) {
    return { label, sent_chars: message.length, ok: false, rtt_ms: null, echoed_length_field: null, payload_match: null, note: `no echo within ${TIMEOUT_MS} ms (reader holds ${reader.pendingBytes()} unterminated chars)` };
  }
  const rtt = echo.at - t0;
  const m = /^(\d+):([\s\S]*)$/.exec(echo.line);
  if (!m) {
    return { label, sent_chars: message.length, ok: false, rtt_ms: rtt, echoed_length_field: null, payload_match: false, note: `unparseable echo line (${echo.line.length} chars): ${echo.line.slice(0, 60)}` };
  }
  const lengthField = Number(m[1]);
  const payload = m[2] ?? "";
  const match = payload === message;
  let note = "";
  if (!match) {
    let i = 0;
    while (i < Math.min(payload.length, message.length) && payload[i] === message[i]) i++;
    note = `payload differs at index ${i}; echoed ${payload.length} chars vs sent ${message.length}`;
  } else if (lengthField !== message.length) {
    note = `payload identical but Lua reported length ${lengthField} (sent ${message.length})`;
  }
  return { label, sent_chars: message.length, ok: match, rtt_ms: rtt, echoed_length_field: lengthField, payload_match: match, note };
}

function show(t: Trial): void {
  console.log(
    `${t.ok ? "OK  " : "FAIL"} ${t.label.padEnd(14)} sent ${String(t.sent_chars).padStart(9)} chars  rtt ${t.rtt_ms === null ? "-" : t.rtt_ms.toFixed(1).padStart(8) + " ms"}  lua_len ${t.echoed_length_field ?? "-"}${t.note ? "  " + t.note : ""}`,
  );
}

const reader = new EchoReader();
const results: { started: string; node: string; write_port: number; read_port: number; trials: Trial[]; connect: Record<string, string> } = {
  started: new Date().toISOString(),
  node: process.version,
  write_port: WRITE_PORT,
  read_port: READ_PORT,
  trials: [],
  connect: {},
};

let writer: net.Socket;
let readSock: net.Socket;
try {
  // Same order as Automaat (server/src/index.ts:143-157): request side first, response side after.
  writer = await connect(WRITE_PORT, "write->8765 (plugin receive)", 15000);
  results.connect["write"] = "ok";
  readSock = await connect(READ_PORT, "read<-8766 (plugin send)", 15000);
  results.connect["read"] = "ok";
} catch (err) {
  console.error(String((err as Error).message));
  console.error('Is Lightroom running with "AVG S2 - Start echo server" clicked?');
  process.exit(1);
}
readSock.setEncoding("utf8");
readSock.on("data", (chunk: string) => reader.feed(chunk));
readSock.on("close", () => console.log("[read] socket closed by peer"));
writer.on("close", () => console.log("[write] socket closed by peer"));

// Give the plugin a moment to see onConnected on both listeners.
await new Promise((r) => setTimeout(r, 500));

// 1. hello (retried: the send listener may still be settling).
let hello: Trial | undefined;
for (let attempt = 1; attempt <= 3; attempt++) {
  hello = await roundTrip(writer, reader, `hello#${attempt}`, "hello");
  show(hello);
  results.trials.push(hello);
  if (hello.ok) break;
}
if (!hello?.ok) {
  console.error("hello never echoed; see the plugin's status dialog / %TEMP%\\LrC-AVG\\s2_log.txt");
}

// 2. small-message RTT distribution.
const small: number[] = [];
for (let i = 0; i < 20 && hello?.ok; i++) {
  const t = await roundTrip(writer, reader, `ping#${i}`, `ping-${i}`);
  results.trials.push(t);
  if (t.ok && t.rtt_ms !== null) small.push(t.rtt_ms);
}
if (small.length) {
  const s = [...small].sort((a, b) => a - b);
  console.log(`small-message RTT over ${s.length}: median ${s[Math.floor(s.length / 2)]?.toFixed(1)} ms, min ${s[0]?.toFixed(1)} ms, max ${s.at(-1)?.toFixed(1)} ms`);
}

// 3. the 1 MB base64 string (1,048,576 chars).
const oneMb = await roundTrip(writer, reader, "1MB", payloadOfChars(1024 * 1024));
show(oneMb);
results.trials.push(oneMb);

// 4. size ladder to find the largest message that survives.
const ladder = oneMb.ok
  ? [2, 4, 8, 16, 32, 64].filter((mb) => mb <= MAX_MB).map((mb) => mb * 1024 * 1024)
  : [512, 256, 64, 16, 1].map((kb) => kb * 1024);
let maxOk = oneMb.ok ? 1024 * 1024 : 0;
for (const chars of ladder) {
  if (writer.destroyed || readSock.destroyed) {
    console.log("socket closed; stopping ladder");
    break;
  }
  const t = await roundTrip(writer, reader, `${chars >= 1048576 ? chars / 1048576 + "MB" : chars / 1024 + "KB"}`, payloadOfChars(chars));
  show(t);
  results.trials.push(t);
  if (t.ok) maxOk = Math.max(maxOk, chars);
  if (oneMb.ok && !t.ok) break; // ascending: stop at the first failure
  if (!oneMb.ok && t.ok) break; // descending: stop at the first success
}

console.log("\n--- report fields ---");
console.log(`connect write->8765: ${results.connect["write"] ?? "fail"}; connect read<-8766: ${results.connect["read"] ?? "fail"}`);
console.log(`hello echoed: ${hello?.ok === true}`);
console.log(`1 MB (1048576 chars) echoed intact: ${oneMb.ok}; rtt ${oneMb.rtt_ms?.toFixed(1) ?? "-"} ms; Lua length field ${oneMb.echoed_length_field ?? "-"}`);
console.log(`largest message that survived: ${maxOk} chars${maxOk >= MAX_MB * 1048576 ? " (ladder cap reached; raise --max-mb to probe further)" : ""}`);

const outDir = path.join(os.tmpdir(), "LrC-AVG");
mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `s2_client_${results.started.replace(/[:.]/g, "-")}.json`);
writeFileSync(outFile, JSON.stringify({ ...results, max_ok_chars: maxOk }, null, 2));
console.log(`results written to ${outFile}`);

writer.end();
readSock.end();
setTimeout(() => process.exit(0), 200);
