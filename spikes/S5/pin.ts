// AVG-S5: pin one or more S5 dumps into engine/src/params/sdk-keys.lrc15.json
// (key, type, sample value, which dumps it was seen in). The conversion itself lives in
// engine/src/params/sdk-keys.ts so the engine's loader and this script agree, and is
// covered by engine/tests/params-sdk-keys.test.ts.
//
// Run (PowerShell, from the repo root):
//   node spikes/S5/pin.ts "$env:TEMP\LrC-AVG\s5_20260907-_OZ80093.NEF.json" `
//                         "$env:TEMP\LrC-AVG\s5_20260110-_Z8A0138-DxO_DeepPRIME XD3.dng.json"
// Options: --out <path> (default engine/src/params/sdk-keys.lrc15.json), --dry-run

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSdkKeys, pinFromDumps } from "../../engine/src/params/sdk-keys.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const outIdx = argv.indexOf("--out");
const outPath = outIdx >= 0 && argv[outIdx + 1]
  ? path.resolve(argv[outIdx + 1] as string)
  : path.join(repoRoot, "engine", "src", "params", "sdk-keys.lrc15.json");
const inputs = argv.filter((a, i) => a !== "--dry-run" && a !== "--out" && argv[i - 1] !== "--out");

if (inputs.length === 0) {
  console.error("usage: node spikes/S5/pin.ts <s5_dump.json> [more dumps...] [--out path] [--dry-run]");
  process.exit(2);
}

const dumps = inputs.map((file) => ({
  label: path.basename(file),
  dump: JSON.parse(readFileSync(file, "utf8")) as unknown,
}));
const pinned = pinFromDumps(dumps, { generatedBy: "spikes/S5/pin.ts", generatedAt: new Date().toISOString() });
loadSdkKeys(pinned); // same validation the engine applies at load time

const byType = new Map<string, number>();
for (const k of pinned.keys) byType.set(k.type, (byType.get(k.type) ?? 0) + 1);
console.log(`sources: ${pinned.sources.map((s) => `${s.label} (PV ${s.process_version ?? "?"}, profile ${s.camera_profile ?? "?"}, LR ${s.lr_version ?? "?"})`).join("; ")}`);
console.log(`keys: ${pinned.keys.length} (${[...byType].map(([t, n]) => `${t} ${n}`).join(", ")})`);
if (dumps.length > 1) {
  const partial = pinned.keys.filter((k) => k.seen_in.length < dumps.length);
  console.log(`keys not present in every dump: ${partial.length ? partial.map((k) => `${k.key} [${k.seen_in.join(", ")}]`).join("; ") : "none"}`);
}

if (dryRun) {
  console.log("--dry-run: nothing written");
} else {
  writeFileSync(outPath, JSON.stringify(pinned, null, 2) + "\n");
  console.log(`wrote ${outPath}`);
}
