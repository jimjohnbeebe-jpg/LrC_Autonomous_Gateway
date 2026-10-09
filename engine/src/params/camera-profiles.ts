// Camera profiles as (CameraProfile, Look) pairs (Phase 0, P-07 and P-17, accepted by Jim 2026-09-26).
//
// A profile is not one string [handle: docs/reports/phase0/S5.md "Part 2 analysis"]:
// - an Adobe Raw profile is CameraProfile = "Adobe Standard" plus its full Look table;
// - a Nikon Camera Matching profile is its CameraProfile string plus an empty Look, which clears
//   any Look left applied.
// - a rendered-pipeline profile (JPEG, TIFF, PNG, PSD, PSB, HEIC, AVIF, JXL, rendered DNG) is
//   CameraProfile = "Embedded" with no Look; Lightroom's "Monochrome" is that plus
//   ConvertToGrayscale = true [handle: docs/reports/phase8/S10/run1/s10_profiles_recorded_2026-10-09T05_22_07.json;
//   docs/reports/phase8/S10.md "Observed"]. The Profile row shows "Color" / "Monochrome" for them
//   [stated: Jim, 2026-10-09, the check's y/n answers], so those are the pinned names.
// spikes/S5/pin-profiles.ts pins the pairs from the S5 and S10 recordings into camera-profiles.lrc15.json.
// Look tables are kept whole (Name, UUID, LookTable and the rest) until Look identity is settled:
// the Adobe Color name was seen with two UUIDs (same report).
//
// This file has no relative imports, so spikes/S5/pin-profiles.ts can load it with Node's type
// stripping.

import { readFileSync } from "node:fs";
import { z } from "zod";

const lookSchema = z.looseObject({
  Name: z.string().min(1),
  UUID: z.string().min(1),
  Parameters: z.record(z.string(), z.unknown()),
});
export type LookTable = z.infer<typeof lookSchema>;

const profileSchema = z.object({
  /** The name Claude and the intents use, e.g. "Adobe Landscape" or "Camera Standard". */
  name: z.string().min(1),
  family: z.enum(["adobe", "nikon", "rendered"]),
  /** The exact CameraProfile string Lightroom stores, e.g. "Group: Camera Standard". */
  camera_profile: z.string().min(1),
  /** The full Look table, or null for a profile that has no Look. */
  look: lookSchema.nullable(),
  /** Rendered pipeline only: the ConvertToGrayscale value that, with the pair, makes the profile (S10). Absent on raw profiles. */
  convert_to_grayscale: z.boolean().optional(),
  /** Where the pair was observed (path under the repo, plus a tag where it is inferred). */
  evidence: z.string().min(1),
  /** Handle of a run that wrote this exact pair and read it back, or null if none has. */
  write_verified: z.string().min(1).nullable(),
});
export type CameraProfileEntry = z.infer<typeof profileSchema>;

const pinnedProfilesSchema = z.object({
  schema_version: z.literal(1),
  generated_by: z.string().min(1),
  generated_at: z.string().min(1),
  camera_raw_version: z.string().optional(),
  sources: z.array(z.string().min(1)).min(1),
  profiles: z.array(profileSchema).min(1),
});
export type PinnedCameraProfiles = z.infer<typeof pinnedProfilesSchema>;

export class UnknownCameraProfileError extends Error {
  readonly code = "unknown_camera_profile";
  readonly recoverable = false;
  readonly profile: string;

  constructor(profile: string) {
    super(`Unknown camera profile "${profile}" (not in the pinned S5 profile list)`);
    this.name = "UnknownCameraProfileError";
    this.profile = profile;
  }
}

/** What a (CameraProfile, Look) pair read from Lightroom is. `name` is null when no pinned profile matches. */
export type ProfileIdentity = {
  name: string | null;
  camera_profile: string | null;
  look_name: string | null;
  look_uuid: string | null;
};

/**
 * True for "no Look": absent, null, or an empty table. A Lua empty table reaches JSON as either
 * [] or {}, and Look = {} reads back as absent [handle: docs/reports/phase0/S5.md "Part 2 analysis"].
 */
export function isEmptyLook(look: unknown): boolean {
  if (look === undefined || look === null) return true;
  if (Array.isArray(look)) return look.length === 0;
  return typeof look === "object" && Object.keys(look).length === 0;
}

function lookField(look: unknown, field: "Name" | "UUID"): string | null {
  if (typeof look !== "object" || look === null || Array.isArray(look)) return null;
  const value = (look as Record<string, unknown>)[field];
  return typeof value === "string" ? value : null;
}

function pairKey(cameraProfile: string, lookUuid: string | null, grayscale: boolean): string {
  return `${cameraProfile}\u0000${lookUuid ?? ""}\u0000${grayscale ? "bw" : ""}`;
}

/** Freeze an entry and everything inside it, so the pinned pairs cannot be changed through get(). */
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

export class CameraProfiles {
  private readonly byName: ReadonlyMap<string, CameraProfileEntry>;
  private readonly byPair: ReadonlyMap<string, CameraProfileEntry>;

  constructor(pinned: PinnedCameraProfiles) {
    const byName = new Map<string, CameraProfileEntry>();
    const byPair = new Map<string, CameraProfileEntry>();
    for (const entry of pinned.profiles.map((p) => deepFreeze(structuredClone(p)))) {
      if (byName.has(entry.name)) throw new Error(`Duplicate camera profile name "${entry.name}"`);
      const key = pairKey(entry.camera_profile, entry.look?.UUID ?? null, entry.convert_to_grayscale === true);
      const other = byPair.get(key);
      if (other) throw new Error(`Camera profiles "${other.name}" and "${entry.name}" are the same pair`);
      byName.set(entry.name, entry);
      byPair.set(key, entry);
    }
    this.byName = byName;
    this.byPair = byPair;
  }

  names(): string[] {
    return [...this.byName.keys()];
  }

  /** Returns the pinned entry (deeply frozen), or throws UnknownCameraProfileError. */
  get(name: string): Readonly<CameraProfileEntry> {
    const entry = this.byName.get(name);
    if (!entry) throw new UnknownCameraProfileError(name);
    return entry;
  }

  /**
   * The pipeline a profile belongs to: the rendered family on rendered photos, every other on raw. The
   * rendered photos refused the raw Adobe Color pair, and the NEFs refused Color and Monochrome [handle:
   * docs/reports/phase8/S10.md "Observed", "Run 2", "Profiles"].
   */
  pipeline(name: string): "raw" | "rendered" {
    return this.get(name).family === "rendered" ? "rendered" : "raw";
  }

  /**
   * True for a monochrome profile: an Adobe one's Look sets ConvertToGrayscale, the rendered Monochrome
   * carries convert_to_grayscale, and the seven Nikon "… Monochrome …" ones have no Look but each dropped
   * the colour keys on the NEF, 159 keys against 177 for the colour profiles [handle:
   * docs\reports\phase0\S5\part1\s5_profiles.log, keys= per CameraProfile] (Greptile, PR #99).
   */
  monochrome(name: string): boolean {
    const entry = this.get(name);
    return entry.look?.Parameters["ConvertToGrayscale"] === true || entry.convert_to_grayscale === true || /Monochrome/.test(entry.name);
  }

  /**
   * The two SDK settings that select this profile. A profile without a Look writes Look = {}. The
   * Look goes without its Parameters.Version, the version it was recorded under: Lightroom stamps its
   * own on a write (issue #67) [handle: docs\reports\phase6\lrc-version-check\check.txt section 2
   * "2_look", LrC 15.6 read back "18.7"].
   */
  toSdk(name: string): { CameraProfile: string; Look: Record<string, unknown>; ConvertToGrayscale?: boolean } {
    const entry = this.get(name);
    const grayscale = entry.convert_to_grayscale === undefined ? {} : { ConvertToGrayscale: entry.convert_to_grayscale };
    if (!entry.look) return { CameraProfile: entry.camera_profile, Look: {}, ...grayscale };
    const look = structuredClone(entry.look);
    delete look.Parameters["Version"];
    return { CameraProfile: entry.camera_profile, Look: look, ...grayscale };
  }

  /**
   * Name the profile Lightroom reports. A pair matches only on the exact CameraProfile string and
   * Look UUID; a Look name with an unpinned UUID, or a Nikon profile with a Look still attached,
   * gives name = null with the raw fields filled in. `convertToGrayscale` is the photo's
   * ConvertToGrayscale value; it tells the rendered pipeline's Monochrome from Color (S10), and a
   * pair that does not key on it (every raw profile) matches whatever it says. Callers that leave it
   * out read a rendered photo as Color.
   */
  identify(cameraProfile: unknown, look: unknown, convertToGrayscale: unknown = false): ProfileIdentity {
    const profile = typeof cameraProfile === "string" ? cameraProfile : null;
    const emptyLook = isEmptyLook(look);
    const lookName = emptyLook ? null : lookField(look, "Name");
    const lookUuid = emptyLook ? null : lookField(look, "UUID");
    let name: string | null = null;
    if (profile !== null && (emptyLook || lookUuid !== null)) {
      name = (this.byPair.get(pairKey(profile, lookUuid, convertToGrayscale === true)) ?? this.byPair.get(pairKey(profile, lookUuid, false)))?.name ?? null;
    }
    return { name, camera_profile: profile, look_name: lookName, look_uuid: lookUuid };
  }
}

export function loadCameraProfiles(raw: unknown): CameraProfiles {
  return new CameraProfiles(pinnedProfilesSchema.parse(raw));
}

export function parsePinnedCameraProfiles(raw: unknown): PinnedCameraProfiles {
  return pinnedProfilesSchema.parse(raw);
}

export function readCameraProfilesFile(path: string): CameraProfiles {
  return loadCameraProfiles(JSON.parse(readFileSync(path, "utf8")) as unknown);
}
