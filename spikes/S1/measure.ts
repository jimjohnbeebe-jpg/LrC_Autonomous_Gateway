// AVG-S1 analysis: mean luma + hash of every JPEG the S1 plugin wrote, latency
// stats from s1_results.csv, and the PHASES.md go/conditional/no-go rule applied
// to those numbers. The printed verdict is a suggestion; Jim records the verdict.
//
// Run: node spikes/S1/measure.ts [dir]      (default dir: %TEMP%\LrC-AVG)
//
// Mean luma = mean over pixels of 0.2126 R' + 0.7152 G' + 0.0722 B' on the 8-bit
// sRGB-encoded values sharp decodes (Rec.709 luma weights, gamma-encoded, not
// linear luminance). It is only used relatively: did the picture get brighter or
// darker after a +/-1 EV step?

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const GO_MAX_MS = 1500; // PHASES.md AVG-S1: "Go: fresh preview <= 1.5 s"
const MOVED_LEVELS = 2; // a 1 EV step must move mean luma by at least this many 8-bit levels

interface Row {
  n: number;
  kind: string;
  delta: number;
  callbackIndex: number;
  callbackCount: number;
  ms: number | undefined;
  file: string;
  error: string;
  sizeArgs: string;
  applyMs: number | undefined;
}

interface ImageFacts {
  width: number;
  height: number;
  bytes: number;
  sha: string;
  luma: number;
  icc: string;
}

const dir = process.argv[2] ?? path.join(os.tmpdir(), "LrC-AVG");
const csvPath = path.join(dir, "s1_results.csv");

function num(s: string | undefined): number | undefined {
  if (s === undefined || s.trim() === "") return undefined;
  const v = Number(s);
  return Number.isFinite(v) ? v : undefined;
}

function readRows(): Row[] {
  if (!existsSync(csvPath)) return [];
  const [header, ...lines] = readFileSync(csvPath, "utf8").trim().split(/\r?\n/);
  const cols = (header ?? "").split(",");
  const at = (cells: string[], name: string): string => cells[cols.indexOf(name)] ?? "";
  return lines.map((line) => {
    const c = line.split(",");
    return {
      n: num(at(c, "n")) ?? -1,
      kind: at(c, "kind"),
      delta: num(at(c, "delta_ev")) ?? 0,
      callbackIndex: num(at(c, "callback_index")) ?? 0,
      callbackCount: num(at(c, "callback_count")) ?? 0,
      ms: num(at(c, "ms")),
      file: at(c, "file"),
      error: at(c, "error"),
      sizeArgs: at(c, "size_args"),
      applyMs: num(at(c, "apply_ms")),
    };
  });
}

async function facts(file: string): Promise<ImageFacts> {
  const buf = readFileSync(file);
  const meta = await sharp(buf).metadata();
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let sum = 0;
  const px = info.width * info.height;
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i] ?? 0;
    const g = info.channels >= 3 ? (data[i + 1] ?? 0) : r;
    const b = info.channels >= 3 ? (data[i + 2] ?? 0) : r;
    sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  return {
    width: info.width,
    height: info.height,
    bytes: buf.length,
    sha: createHash("sha256").update(buf).digest("hex").slice(0, 12),
    luma: sum / px,
    icc: meta.icc ? `icc(${meta.icc.length} B)` : "no-icc",
  };
}

function stats(values: number[]): string {
  if (values.length === 0) return "n/a";
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const median = sorted[Math.floor(sorted.length / 2)] ?? NaN;
  return `mean ${mean.toFixed(0)} ms, median ${median.toFixed(0)} ms, min ${sorted[0]?.toFixed(0)} ms, max ${sorted.at(-1)?.toFixed(0)} ms (n=${values.length})`;
}

const rows = readRows();
const jpegs = rows.length > 0
  ? rows.filter((r) => r.file !== "").map((r) => r.file)
  : readdirSync(dir).filter((f) => /^s1_.*\.jpg$/.test(f)).sort();
if (jpegs.length === 0) {
  console.error(`No S1 output in ${dir}. Run "AVG S1" in Lightroom first.`);
  process.exit(1);
}

const info = new Map<string, ImageFacts>();
for (const f of jpegs) info.set(f, await facts(path.join(dir, f)));

console.log(`AVG-S1 measure — dir ${dir}`);
console.log(`sharp ${sharp.versions.sharp} / libvips ${sharp.versions.vips} / node ${process.version}\n`);
console.log("n  kind      delta  cb   ms        bytes     size        sha256[0:12]  mean_luma  icc");
for (const r of rows.length > 0 ? rows : jpegs.map((f): Row => ({ n: -1, kind: "?", delta: 0, callbackIndex: 1, callbackCount: 1, ms: undefined, file: f, error: "", sizeArgs: "", applyMs: undefined }))) {
  const f = info.get(r.file);
  console.log(
    [
      String(r.n).padEnd(2),
      r.kind.padEnd(9),
      (r.delta >= 0 ? "+" : "") + r.delta.toFixed(1).padEnd(5),
      `${r.callbackIndex}/${r.callbackCount}`.padEnd(4),
      (r.ms === undefined ? "-" : r.ms.toFixed(0)).padEnd(9),
      String(f?.bytes ?? "-").padEnd(9),
      (f ? `${f.width}x${f.height}` : "-").padEnd(11),
      (f?.sha ?? "-").padEnd(13),
      (f ? f.luma.toFixed(2) : "-").padEnd(10),
      f?.icc ?? "",
      r.error ? ` ERROR: ${r.error}` : "",
    ].join(" "),
  );
}

if (rows.length === 0) {
  console.log("\n(no s1_results.csv — printed image facts only)");
  process.exit(0);
}

// Freshness, judged per frame against the BASELINE (n=0) so one stale frame cannot taint
// the next: the steps alternate between baseline exposure (offset 0) and baseline +/-1 EV.
//   offset +/-1 EV -> fresh if luma moved from baseline by >= MOVED_LEVELS in that direction
//   offset 0       -> fresh if luma is back within MOVED_LEVELS of baseline
// The frame-to-previous-frame direction is printed as secondary information.
const first = (n: number) => rows.find((r) => r.n === n && r.callbackIndex === 1);
const lumaSequence: string[] = [];
let fresh = 0;
let steps = 0;
const base = first(0);
const baseFacts = base ? info.get(base.file) : undefined;
if (base) lumaSequence.push(`0:${baseFacts?.luma.toFixed(2) ?? "?"}`);
let offset = 0;
for (let n = 1; ; n++) {
  const cur = first(n);
  if (!cur || cur.kind !== "step") break;
  steps++;
  offset += cur.delta;
  const prev = first(n - 1);
  const a = prev ? info.get(prev.file) : undefined;
  const b = info.get(cur.file);
  lumaSequence.push(`${n}:${b?.luma.toFixed(2) ?? "?"}`);
  if (!b || !baseFacts) continue;
  const fromBase = b.luma - baseFacts.luma;
  const ok = Math.abs(offset) < 1e-9
    ? Math.abs(fromBase) < MOVED_LEVELS
    : Math.sign(fromBase) === Math.sign(offset) && Math.abs(fromBase) >= MOVED_LEVELS;
  if (ok) fresh++;
  const vsPrev = a ? `${b.luma - a.luma >= 0 ? "+" : ""}${(b.luma - a.luma).toFixed(2)} vs previous frame${a.sha === b.sha ? " (identical bytes)" : ""}` : "";
  console.log(
    `step ${n} (${cur.delta > 0 ? "+" : ""}${cur.delta} EV, offset ${offset >= 0 ? "+" : ""}${offset} EV): luma ${b.luma.toFixed(2)}, ${fromBase >= 0 ? "+" : ""}${fromBase.toFixed(2)} vs baseline, ${vsPrev} -> ${ok ? "FRESH" : "STALE?"}`,
  );
}

const extra = rows.filter((r) => r.callbackIndex > 1);
const stepMs = rows.filter((r) => r.kind === "step" && r.callbackIndex === 1 && r.ms !== undefined).map((r) => r.ms as number);
const applyMs = rows.filter((r) => r.kind === "step" && r.callbackIndex === 1 && r.applyMs !== undefined).map((r) => r.applyMs as number);
const exportRow = rows.find((r) => r.kind === "export");
const exportFacts = exportRow ? info.get(exportRow.file) : undefined;

console.log("\n--- report fields ---");
console.log(`thumbnail ms (first callback, steps 1-${steps}): ${stats(stepMs)}`);
console.log(`thumbnail ms per step: ${stepMs.map((m) => m.toFixed(0)).join(", ")}`);
console.log(`baseline thumbnail ms (no develop change): ${base?.ms?.toFixed(0) ?? "n/a"}`);
console.log(`applyDevelopSettings ms per step: ${applyMs.map((m) => m.toFixed(0)).join(", ")}`);
console.log(`export ms: ${exportRow?.ms?.toFixed(0) ?? "n/a"}  (${exportFacts ? `${exportFacts.width}x${exportFacts.height}, ${exportFacts.bytes} B` : exportRow?.error || "no file"})`);
console.log(`luma sequence: ${lumaSequence.join("  ")}`);
console.log(`fresh steps: ${fresh}/${steps}`);
console.log(`extra callbacks: ${extra.length === 0 ? "none" : extra.map((r) => `n=${r.n} cb${r.callbackIndex} at ${r.ms?.toFixed(0)} ms (${info.get(r.file)?.sha ?? "?"})`).join("; ")}`);
console.log(`size args used: ${[...new Set(rows.filter((r) => r.kind !== "export").map((r) => r.sizeArgs))].join(" | ")}`);

const maxMs = stepMs.length ? Math.max(...stepMs) : Infinity;
let verdict: string;
if (steps === 0) verdict = "incomplete (no step rows)";
else if (fresh < steps) verdict = "no-go per PHASES.md rule (stale preview seen) — export path only; re-baseline the pass budget";
else if (maxMs <= GO_MAX_MS) verdict = `go per PHASES.md rule (all fresh, max ${maxMs.toFixed(0)} ms <= ${GO_MAX_MS} ms)`;
else verdict = `conditional per PHASES.md rule (all fresh, max ${maxMs.toFixed(0)} ms > ${GO_MAX_MS} ms) — export fallback becomes primary`;
console.log(`suggested verdict: ${verdict}`);
console.log("(Jim confirms the verdict in docs/reports/phase0/S1.md)");
