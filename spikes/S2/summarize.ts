// AVG-S2: summarise the files the S2 client and plugin saved, so every number in
// docs/reports/phase0/S2.md comes from one command.
//
// Run (PowerShell, from the repo root):
//   node spikes/S2/summarize.ts [dir]     (default dir: docs\reports\phase0\S2)
//
// Reads s2_client_*.json (written by spikes/S2/client.ts), s2_stop_*.json (written by
// plugin/spikes/S2.lrplugin/S2Stop.lua) and s2_log.txt (S2Server.lua M.log). Prints only;
// writes nothing.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dir = path.resolve(process.argv[2] ?? path.join(repoRoot, "docs", "reports", "phase0", "S2"));

const Trial = z.looseObject({
  label: z.string(),
  sent_chars: z.number(),
  ok: z.boolean(),
  rtt_ms: z.number().nullable(),
  echoed_length_field: z.number().nullable(),
  payload_match: z.boolean().nullable(),
  note: z.string(),
});
const Client = z.looseObject({
  started: z.string(),
  node: z.string(),
  write_port: z.number(),
  read_port: z.number(),
  trials: z.array(Trial),
  connect: z.record(z.string(), z.string()),
  max_ok_chars: z.number().optional(),
  error: z.string().optional(),
});
const Stop = z.looseObject({
  answered: z.boolean(),
  lightroom_froze: z.boolean().optional(),
  stopped_at: z.string(),
  server: z.looseObject({
    messages_received: z.number(),
    messages_echoed: z.number(),
    receive_connected: z.boolean(),
    send_connected: z.boolean(),
    running: z.boolean(),
  }),
});

const files = readdirSync(dir).sort();
const one = (prefix: string): string => {
  const hits = files.filter((f) => f.startsWith(prefix));
  if (hits.length !== 1) throw new Error(`expected exactly one ${prefix}* file in ${dir}, found ${hits.length}`);
  return hits[0] as string;
};
const clientFile = one("s2_client_");
const stopFile = one("s2_stop_");
const client = Client.parse(JSON.parse(readFileSync(path.join(dir, clientFile), "utf8")));
const stop = Stop.parse(JSON.parse(readFileSync(path.join(dir, stopFile), "utf8")));

// s2_log.txt lines: "HH:MM:SS.mmm <message>" (S2Server.lua M.log), local time.
interface LogLine {
  ms: number;
  time: string;
  text: string;
}
const log: LogLine[] = readFileSync(path.join(dir, "s2_log.txt"), "utf8")
  .split(/\r?\n/)
  .flatMap((line) => {
    const m = /^(\d\d):(\d\d):(\d\d)\.(\d{3}) (.*)$/.exec(line);
    if (!m) return [];
    const [, h, mi, s, ms, text] = m;
    return [{ ms: ((Number(h) * 60 + Number(mi)) * 60 + Number(s)) * 1000 + Number(ms), time: line.slice(0, 12), text: text ?? "" }];
  });

const fmt = (n: number | null | undefined, digits = 1): string => (n === null || n === undefined ? "-" : n.toFixed(digits));
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
};
const MiB = 1024 * 1024;

console.log(`dir: ${dir}`);
console.log(`files: ${clientFile}, ${stopFile}, s2_log.txt`);

console.log("\n== Client (spikes/S2/client.ts) ==");
console.log(`started ${client.started} (UTC), node ${client.node}`);
console.log(`connect write->${client.write_port} (plugin receive): ${client.connect["write"] ?? "fail"}; read<-${client.read_port} (plugin send): ${client.connect["read"] ?? "fail"}${client.error ? `; error: ${client.error}` : ""}`);
console.log("trials:");
for (const t of client.trials) {
  console.log(`  ${t.ok ? "OK  " : "FAIL"} ${t.label.padEnd(8)} sent ${String(t.sent_chars).padStart(8)} chars | rtt ${fmt(t.rtt_ms, 2).padStart(7)} ms | Lua length ${t.echoed_length_field ?? "-"} | payload identical ${String(t.payload_match)}${t.note ? ` | ${t.note}` : ""}`);
}
const failed = client.trials.filter((t) => !t.ok);
const lenMismatch = client.trials.filter((t) => t.echoed_length_field !== t.sent_chars);
console.log(`trials: ${client.trials.length}, failed: ${failed.length}, Lua length != sent length: ${lenMismatch.length}`);

const hello = client.trials.find((t) => t.label.startsWith("hello") && t.ok);
console.log(`hello echoed: ${hello !== undefined}${hello ? ` (${hello.label}, rtt ${fmt(hello.rtt_ms, 2)} ms)` : ""}`);

const pings = client.trials.filter((t) => t.label.startsWith("ping#") && t.ok && t.rtt_ms !== null).map((t) => t.rtt_ms as number);
if (pings.length) {
  const slowest = client.trials.filter((t) => t.label.startsWith("ping#")).reduce((a, b) => ((b.rtt_ms ?? 0) > (a.rtt_ms ?? 0) ? b : a));
  const others = pings.filter((x) => x !== slowest.rtt_ms);
  console.log(`small-message RTT over ${pings.length} pings: median ${fmt(median(pings), 2)} ms, min ${fmt(Math.min(...pings), 2)} ms, max ${fmt(Math.max(...pings), 2)} ms (${slowest.label}); max without ${slowest.label}: ${fmt(Math.max(...others), 2)} ms`);
}

const big = client.trials.filter((t) => t.sent_chars >= MiB);
console.log("large messages (throughput = chars sent + chars echoed, over the round trip):");
for (const t of big) {
  const mbps = t.rtt_ms ? (2 * t.sent_chars) / MiB / (t.rtt_ms / 1000) : null;
  console.log(`  ${t.label.padEnd(5)} ${(t.sent_chars / MiB).toString().padStart(2)} MiB | ok ${t.ok} | rtt ${fmt(t.rtt_ms, 1)} ms | ${fmt(mbps, 0)} MiB/s`);
}
const largestSent = Math.max(...client.trials.map((t) => t.sent_chars));
console.log(`largest message that survived: ${client.max_ok_chars ?? "-"} chars (${fmt((client.max_ok_chars ?? 0) / MiB, 0)} MiB); largest message sent: ${largestSent} chars; any large message failed: ${big.some((t) => !t.ok)}`);

console.log("\n== Plugin (s2_stop JSON, S2Stop.lua) ==");
console.log(`stopped_at ${stop.stopped_at}; question answered: ${stop.answered}; lightroom_froze: ${String(stop.lightroom_froze)}`);
console.log(`messages received ${stop.server.messages_received}, echoed ${stop.server.messages_echoed}; at stop: running ${stop.server.running}, receive_connected ${stop.server.receive_connected}, send_connected ${stop.server.send_connected}`);

console.log("\n== Plugin log (s2_log.txt, local time) ==");
const first = log[0];
const connected = log.filter((l) => l.text.endsWith("client connected"));
if (first && connected.length) {
  console.log(`start -> first client connected: ${((connected[0] as LogLine).ms - first.ms) / 1000} s (${first.time} -> ${(connected[0] as LogLine).time}); connected events: ${connected.map((l) => `${l.time} ${l.text}`).join("; ")}`);
}
for (const port of ["receive", "send"]) {
  const listening = log.filter((l) => l.text.startsWith(`${port}: listening`));
  const gaps = listening.slice(1).map((l, i) => l.ms - (listening[i] as LogLine).ms);
  const closed = log.filter((l) => l.text === `${port}: closed`);
  const errors = log.filter((l) => l.text.startsWith(`${port}: error`));
  console.log(`${port}: 'listening' (onConnecting) ${listening.length}x at ${listening.map((l) => l.time.slice(3)).join(", ")}`);
  console.log(`  intervals between successive 'listening' lines (ms): ${gaps.join(", ") || "-"}`);
  console.log(`  'closed' (onClosed) at: ${closed.map((l) => l.time).join(", ") || "never"}; logged errors: ${errors.length}`);
}
const loopExit = log.find((l) => l.text.startsWith("server loop exiting"));
const cleanup = log.find((l) => l.text.startsWith("sockets closed"));
const stopReq = log.find((l) => l.text === "stop requested");
console.log(`stop requested ${stopReq?.time ?? "-"}; ${loopExit ? `${loopExit.time} ${loopExit.text}` : "no loop-exit line"}; ${cleanup ? `${cleanup.time} ${cleanup.text}` : "no cleanup line"}`);

// "echo <n> bytes (send() returned after <x> ms)", one per message, in order.
const echoes = log.flatMap((l) => {
  const m = /^echo (\d+) bytes \(send\(\) returned after ([\d.]+) ms\)$/.exec(l.text);
  return m ? [{ ms: l.ms, time: l.time, bytes: Number(m[1]), sendMs: Number(m[2]) }] : [];
});
console.log(`echo lines: ${echoes.length}; bytes match the client's trials in order: ${echoes.length === client.trials.length && echoes.every((e, i) => e.bytes === client.trials[i]?.sent_chars)}`);
console.log(`plugin send() duration: max ${fmt(Math.max(...echoes.map((e) => e.sendMs)), 1)} ms; for the largest message ${fmt(echoes.find((e) => e.bytes === largestSent)?.sendMs, 1)} ms`);
const smallGaps = echoes.slice(1).map((e, i) => ({ gap: e.ms - (echoes[i] as { ms: number }).ms, e })).filter((g) => g.e.bytes < 100);
const widest = smallGaps.reduce((a, b) => (b.gap > a.gap ? b : a), { gap: -1, e: echoes[0] as (typeof echoes)[number] });
console.log(`widest gap between successive small-message echo lines: ${widest.gap} ms (before the echo at ${widest.e.time})`);

// Time from the plugin's send() returning to the client holding the whole echo. With E_k the
// time of echo line k (logged right after send() returns) and RTT_k the client's round trip:
//   E_k - E_(k-1) = down_(k-1) + gen_k + up_k + lua_k + send_k,  RTT_k = up_k + lua_k + send_k + down_k
// so down_k = RTT_k - (E_k - E_(k-1)) + down_(k-1) + gen_k >= RTT_k - (E_k - E_(k-1)).
// Log times have 1 ms resolution, so the bound is good to about +-1 ms.
console.log("lower bound on time after send() returned (echo delivery to Node + Node's line parsing), large messages:");
for (let i = 1; i < echoes.length; i++) {
  const e = echoes[i] as (typeof echoes)[number];
  const t = client.trials[i];
  if (!t || e.bytes < MiB || t.rtt_ms === null) continue;
  const spacing = e.ms - (echoes[i - 1] as { ms: number }).ms;
  const bound = t.rtt_ms - spacing;
  console.log(`  ${t.label.padEnd(5)} rtt ${fmt(t.rtt_ms, 1)} ms, echo-line spacing ${spacing} ms -> ${bound > 0 ? `>= ${fmt(bound, 0)} ms (${fmt((100 * bound) / t.rtt_ms, 0)}% of the round trip)` : "no bound (spacing >= rtt)"}`);
}
