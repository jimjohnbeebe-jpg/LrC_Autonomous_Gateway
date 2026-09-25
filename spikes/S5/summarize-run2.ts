// AVG-S5 part 2: summarise the recorder and write-test files that S5.lrplugin saved, so every
// number in docs/reports/phase0/S5.md "Part 2" comes from one command.
//
// Run (PowerShell, from the repo root):
//   node spikes/S5/summarize-run2.ts [dir]     (default dir: docs\reports\phase0\S5\run2)
//
// Reads s5_profiles_recorded_*.json and s5_writetests_*.json (formats written by
// plugin/spikes/S5.lrplugin/S5Recorder.lua and S5WriteTests.lua), plus the part-1 DNG dump
// for the Adobe Color comparison. Prints only; writes nothing.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dir = path.resolve(process.argv[2] ?? path.join(repoRoot, "docs", "reports", "phase0", "S5", "run2"));
const part1Dng = path.join(repoRoot, "docs", "reports", "phase0", "S5", "s5_20260110-_Z8A0138-DxO_DeepPRIME XD3.dng.json");

const Look = z.looseObject({ Name: z.string(), UUID: z.string(), Parameters: z.record(z.string(), z.unknown()) });
const Capture = z.looseObject({
  captured_at: z.string(),
  filename: z.string(),
  camera_profile: z.string(),
  look_name: z.string().optional(),
  look_uuid: z.string().optional(),
  look: z.unknown().optional(),
  key_count: z.number(),
});
const Recording = z.looseObject({ started_at: z.string(), captures: z.array(Capture) });
const Test = z.looseObject({ test: z.string(), outcome: z.string(), changed_keys: z.record(z.string(), z.unknown()).optional() });
const WriteTests = z.looseObject({
  meta: z.looseObject({ filename: z.string(), captured_at: z.string(), key_count: z.number() }),
  snapshot: z.looseObject({
    create_ok: z.boolean().optional(),
    create_returned: z.unknown().optional(),
    found: z.boolean(),
    snapshotID: z.string().optional(),
    id_global: z.string().optional(),
    deleted: z.boolean().optional(),
    deleted_with: z.string().optional(),
  }),
  tests: z.array(Test),
  restore: z.looseObject({
    attempts: z.array(z.looseObject({ id_field: z.string(), ok: z.boolean(), remaining_differences: z.number() })),
    restored: z.boolean(),
    worked_with: z.string().optional(),
  }).optional(),
});

// Key-order-independent JSON, so two tables compare equal whatever order Lua wrote them in.
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v !== null && typeof v === "object") {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]));
  }
  return v;
}
const same = (a: unknown, b: unknown): boolean => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const read = (file: string): unknown => JSON.parse(readFileSync(path.join(dir, file), "utf8"));
const label = (c: z.infer<typeof Capture>): string => c.look_name ?? "(no Look)";

const files = readdirSync(dir).sort();
const recordings = files.filter((f) => f.startsWith("s5_profiles_recorded_")).map((f) => ({ f, r: Recording.parse(read(f)) }));
const writeRuns = files.filter((f) => f.startsWith("s5_writetests_")).map((f) => ({ f, w: WriteTests.parse(read(f)) }));

console.log(`dir: ${dir}`);
console.log("\n== Profile recorder ==");
for (const { f, r } of recordings) {
  console.log(`${f}: ${r.captures.length} captures`);
  r.captures.forEach((c, i) => {
    console.log(`  ${i + 1}. ${c.captured_at.slice(11, 19)} ${c.filename} | CameraProfile ${c.camera_profile} | Look ${label(c)} ${c.look_uuid ?? ""} | keys ${c.key_count}`);
  });
}

// One entry per Look name: its UUID(s) and whether the full Look table is identical everywhere it was recorded.
console.log("\n== Look tables by name (all recordings, both photos) ==");
const byName = new Map<string, z.infer<typeof Capture>[]>();
for (const { r } of recordings) for (const c of r.captures) byName.set(label(c), [...(byName.get(label(c)) ?? []), c]);
for (const [name, cs] of byName) {
  const uuids = [...new Set(cs.map((c) => c.look_uuid ?? "-"))];
  const photos = [...new Set(cs.map((c) => path.extname(c.filename).toUpperCase()))];
  const identical = cs.every((c) => same(c.look, cs[0]?.look));
  const keys = [...new Set(cs.map((c) => `${path.extname(c.filename).toUpperCase()} ${c.key_count}`))];
  console.log(`  ${name}: UUID ${uuids.join(", ")} | recorded ${cs.length}x on ${photos.join("+")} | Look table identical in all: ${identical} | key counts ${keys.join(", ")}`);
}

console.log("\n== Adobe Color: part 1 DNG dump vs part 2 recorder ==");
const p1 = z.looseObject({ settings: z.looseObject({ CameraProfile: z.string(), Look: Look }) }).parse(JSON.parse(readFileSync(part1Dng, "utf8")));
const p2 = byName.get("Adobe Color")?.[0];
const p2Look = p2 ? Look.parse(p2.look) : undefined;
console.log(`  part 1: CameraProfile ${p1.settings.CameraProfile} | Look ${p1.settings.Look.Name} UUID ${p1.settings.Look.UUID} LookTable ${String(p1.settings.Look.Parameters["LookTable"])}`);
if (p2 && p2Look) {
  console.log(`  part 2: CameraProfile ${p2.camera_profile} | Look ${p2Look.Name} UUID ${p2Look.UUID} LookTable ${String(p2Look.Parameters["LookTable"])}`);
  const topDiff = [...new Set([...Object.keys(p1.settings.Look), ...Object.keys(p2Look)])]
    .filter((k) => k !== "Parameters" && !same((p1.settings.Look as Record<string, unknown>)[k], (p2Look as Record<string, unknown>)[k]));
  const paramDiff = [...new Set([...Object.keys(p1.settings.Look.Parameters), ...Object.keys(p2Look.Parameters)])]
    .filter((k) => !same(p1.settings.Look.Parameters[k], p2Look.Parameters[k]));
  console.log(`  fields that differ: ${topDiff.join(", ")}; Parameters that differ: ${paramDiff.join(", ")}`);
}

console.log("\n== Write tests ==");
for (const { f, w } of writeRuns) {
  const s = w.snapshot;
  console.log(`${f} (${w.meta.filename}, ${w.meta.key_count} keys)`);
  console.log(`  snapshot: create_ok ${String(s.create_ok)}, returned ${String(s.create_returned)}, found ${s.found}, snapshotID ${s.snapshotID ?? "-"}, id_global ${s.id_global ?? "-"}`);
  for (const t of w.tests) {
    const keys = t.changed_keys ? Object.keys(t.changed_keys).join(", ") : "";
    console.log(`  ${t.test}: ${t.outcome}${keys ? ` | changed keys: ${keys}` : ""}${"reason" in t ? ` | ${String(t["reason"])}` : ""}`);
    if ("attempts" in t && Array.isArray(t["attempts"])) {
      for (const a of t["attempts"] as { requested?: unknown; after?: unknown; changed_keys?: Record<string, unknown> }[]) {
        console.log(`    attempt: requested ${JSON.stringify(a.requested)} -> after ${JSON.stringify(a.after)} | changed keys: ${Object.keys(a.changed_keys ?? {}).join(", ")}`);
      }
    }
    // The Adobe Look written back: is it exactly the table the recorder captured?
    if (t.test === "adobe_look" && t.outcome !== "skipped") {
      const name = String(t["requested_look_name"]);
      const recorded = byName.get(name)?.[0]?.look;
      const after = (t.changed_keys?.["Look"] as { after?: unknown } | undefined)?.after;
      // Two missing tables would compare equal; report which one is missing instead.
      const verdict = after === undefined || after === "<absent>" ? "no Look in the read-back"
        : recorded === undefined ? `no recorded '${name}' table to compare with`
        : String(same(after, recorded));
      console.log(`    before ${JSON.stringify(t["before"])} -> after ${JSON.stringify(t["after"])} | Look after the write == recorded '${name}' table: ${verdict}`);
    }
    if (t.test.startsWith("lens_")) console.log(`    ${String(t["key"])}: ${String(t["before"])} -> ${String(t["after"])}`);
  }
  const r = w.restore;
  if (r) {
    console.log(`  restore: ${r.attempts.map((a) => `${a.id_field} ok ${a.ok}, ${a.remaining_differences} settings differ from the start`).join("; ")} | restored ${r.restored} with ${r.worked_with ?? "-"}`);
  }
  console.log(`  snapshot deleted: ${String(s.deleted)} with ${s.deleted_with ?? "-"}`);
}
