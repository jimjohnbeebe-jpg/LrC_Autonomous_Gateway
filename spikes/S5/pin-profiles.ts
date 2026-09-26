// AVG-S5 -> Phase 1: pin the camera profiles as (CameraProfile, Look) pairs into
// engine/src/params/camera-profiles.lrc15.json (Phase 0, P-07 and P-17).
//
// Inputs are the committed S5 evidence; no Lightroom run is needed:
// - Adobe Raw profiles: the Look tables in the part-2 recorder files
//   (docs/reports/phase0/S5/run2/s5_profiles_recorded_*.json). Every capture of one Look name must
//   hold the same table, as summarize-run2.ts reported ("Look table identical in all: true").
// - Nikon Camera Matching profiles: the CameraProfile strings in the part-1 log
//   (docs/reports/phase0/S5/part1/s5_profiles.log). A string counts only if it was logged for both
//   the NEF and the DNG (S5.md "Part 1 analysis": "identical for the NEF and the DNG").
//
// Run (PowerShell, from the repo root):
//   node spikes/S5/pin-profiles.ts            # writes the file
//   node spikes/S5/pin-profiles.ts --dry-run  # prints the summary only

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  loadCameraProfiles,
  type CameraProfileEntry,
  type LookTable,
  type PinnedCameraProfiles,
} from "../../engine/src/params/camera-profiles.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const rel = (p: string): string => path.relative(repoRoot, p).split(path.sep).join("/");
const dryRun = process.argv.includes("--dry-run");

const run2Dir = path.join(repoRoot, "docs", "reports", "phase0", "S5", "run2");
const part1Log = path.join(repoRoot, "docs", "reports", "phase0", "S5", "part1", "s5_profiles.log");
const outPath = path.join(repoRoot, "engine", "src", "params", "camera-profiles.lrc15.json");

// Pairs that a write test wrote and read back identical (S5.md "Part 2 analysis", Numbers table).
const WRITE_TESTS = "docs/reports/phase0/S5/run2/s5_writetests_20260907-_OZ80093.NEF_2026-09-24T21_00_31.json";
const WRITE_VERIFIED: Record<string, string> = {
  "Adobe Landscape": `${WRITE_TESTS} test adobe_look`,
  "Camera Landscape": `${WRITE_TESTS} test nikon_camera_profile (second attempt, with Look = {})`,
};

// "Camera Standard" without the "Group: " prefix is the base of Nikon's creative Looks such as
// "Camera Toy", not a profile of its own (S5.md "Part 1 analysis"), so it is not pinned.
const NIKON_EXCLUDED = new Set(["Camera Standard", "Adobe Standard"]);

const captureSchema = z.object({
  camera_profile: z.string(),
  filename: z.string(),
  look: z.unknown().optional(),
  look_name: z.string().nullable().optional(),
});
const recorderSchema = z.object({ captures: z.array(captureSchema) });

// --- Adobe Raw profiles -------------------------------------------------------------------
const recorderFiles = readdirSync(run2Dir)
  .filter((f) => /^s5_profiles_recorded_.*\.json$/.test(f))
  .sort()
  .map((f) => path.join(run2Dir, f));
if (recorderFiles.length === 0) throw new Error(`no recorder files in ${run2Dir}`);

type AdobeSeen = { look: LookTable | null; files: Set<string>; photos: Set<string>; count: number };
const adobe = new Map<string, AdobeSeen>();
let cameraRawVersion: string | undefined;

for (const file of recorderFiles) {
  const { captures } = recorderSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  for (const c of captures) {
    if (c.camera_profile !== "Adobe Standard") continue;
    const hasLook = c.look_name !== undefined && c.look_name !== null;
    // The capture without a Look, clicked between Adobe Portrait and Adobe Vivid, is Adobe
    // Standard itself [inference; S5.md "Part 2 analysis"].
    const name = hasLook ? (c.look_name as string) : "Adobe Standard";
    const look = hasLook ? (c.look as LookTable) : null;
    const seen = adobe.get(name);
    if (!seen) {
      adobe.set(name, { look, files: new Set([rel(file)]), photos: new Set([c.filename]), count: 1 });
    } else {
      if (!isDeepStrictEqual(seen.look, look)) throw new Error(`"${name}": the Look table differs between captures`);
      seen.files.add(rel(file));
      seen.photos.add(c.filename);
      seen.count += 1;
    }
    const version = (look?.Parameters as Record<string, unknown> | undefined)?.["Version"];
    if (typeof version === "string") cameraRawVersion ??= version;
  }
}

// --- Nikon Camera Matching profiles -------------------------------------------------------
const nikonPhotos = new Map<string, Set<string>>();
for (const line of readFileSync(part1Log, "utf8").split(/\r?\n/)) {
  if (!line.trim()) continue;
  const fields = line.split("\t");
  const filename = fields[1];
  const profile = fields.find((f) => f.startsWith("CameraProfile="))?.slice("CameraProfile=".length);
  if (!filename || !profile || NIKON_EXCLUDED.has(profile)) continue;
  const photos = nikonPhotos.get(profile) ?? new Set<string>();
  photos.add(filename);
  nikonPhotos.set(profile, photos);
}

// --- Assemble -----------------------------------------------------------------------------
const profiles: CameraProfileEntry[] = [];

for (const [name, seen] of [...adobe].sort(([a], [b]) => a.localeCompare(b))) {
  profiles.push({
    name,
    family: "adobe",
    camera_profile: "Adobe Standard",
    look: seen.look,
    evidence:
      `${[...seen.files].join(", ")}: ${seen.count} captures on ${[...seen.photos].sort().join(" and ")}, identical` +
      (seen.look === null ? "; the capture without a Look is Adobe Standard [inference; S5.md Part 2 analysis]" : ""),
    write_verified: WRITE_VERIFIED[name] ?? null,
  });
}

const nikonSkipped: string[] = [];
for (const [profile, photos] of [...nikonPhotos].sort(([a], [b]) => a.localeCompare(b))) {
  if (photos.size < 2) {
    nikonSkipped.push(`${profile} (only ${[...photos].join(", ")})`);
    continue;
  }
  // Jim clicked the Nikon group in order and the log has the stored strings, some with a literal
  // "Group: " prefix; the name without the prefix is the one the Profile browser shows [inference].
  const name = profile.startsWith("Group: ") ? profile.slice("Group: ".length) : profile;
  profiles.push({
    name,
    family: "nikon",
    camera_profile: profile,
    look: null,
    evidence: `${rel(part1Log)}: logged for ${[...photos].sort().join(" and ")}; paired with Look = {} per S5.md Part 2 analysis`,
    write_verified: WRITE_VERIFIED[name] ?? null,
  });
}

const pinned: PinnedCameraProfiles = {
  schema_version: 1,
  generated_by: "spikes/S5/pin-profiles.ts",
  generated_at: new Date().toISOString(),
  ...(cameraRawVersion !== undefined ? { camera_raw_version: cameraRawVersion } : {}),
  sources: [...recorderFiles.map(rel), rel(part1Log)],
  profiles,
};
loadCameraProfiles(pinned); // same validation the engine applies at load time

for (const p of profiles) {
  console.log(`${p.family.padEnd(5)} ${p.name.padEnd(34)} CameraProfile=${JSON.stringify(p.camera_profile)} Look=${p.look ? p.look.UUID : "{}"}${p.write_verified ? "  (write verified)" : ""}`);
}
console.log(`profiles: ${profiles.length} (adobe ${profiles.filter((p) => p.family === "adobe").length}, nikon ${profiles.filter((p) => p.family === "nikon").length}); Camera Raw ${cameraRawVersion ?? "?"}`);
if (nikonSkipped.length) console.log(`not pinned (seen on one photo only): ${nikonSkipped.join("; ")}`);

if (dryRun) {
  console.log("--dry-run: nothing written");
} else {
  writeFileSync(outPath, JSON.stringify(pinned, null, 2) + "\n");
  console.log(`wrote ${rel(outPath)}`);
}
