// Pinned Lightroom SDK develop-setting keys.
//
// The only source of SDK key names is a live photo:getDevelopSettings() dump
// captured by spike AVG-S5 (plugin/spikes/S5.lrplugin) and pinned with
// spikes/S5/pin.ts into sdk-keys.lrc15.json. Key names are never copied from
// documentation or other projects (see .claude/rules/03-lightroom.md).
// Unknown keys are rejected, never guessed.

import { readFileSync } from "node:fs";
import { z } from "zod";

export const SDK_VALUE_TYPES = ["number", "string", "boolean", "array", "object", "null"] as const;
export type SdkValueType = (typeof SDK_VALUE_TYPES)[number];

/** Shape written by S5.lrplugin: `{ meta: {...}, settings: { <SdkKey>: <value> } }`. */
const s5DumpSchema = z.object({
  meta: z.looseObject({
    spike: z.literal("S5"),
    filename: z.string().min(1),
    lr_version: z.string().optional(),
    captured_at: z.string().optional(),
  }),
  settings: z.record(z.string().min(1), z.unknown()),
});
export type S5Dump = z.infer<typeof s5DumpSchema>;

const sdkKeyEntrySchema = z.object({
  key: z.string().min(1),
  type: z.enum(SDK_VALUE_TYPES),
  sample: z.unknown(),
  seen_in: z.array(z.string().min(1)).min(1),
});
export type SdkKeyEntry = z.infer<typeof sdkKeyEntrySchema>;

const pinnedSdkKeysSchema = z.object({
  schema_version: z.literal(1),
  generated_by: z.string().min(1),
  generated_at: z.string().min(1),
  sources: z.array(
    z.object({
      label: z.string().min(1),
      filename: z.string().min(1),
      lr_version: z.string().optional(),
      process_version: z.string().optional(),
      camera_profile: z.string().optional(),
    }),
  ),
  keys: z.array(sdkKeyEntrySchema),
});
export type PinnedSdkKeys = z.infer<typeof pinnedSdkKeysSchema>;

export class UnknownSdkKeyError extends Error {
  readonly key: string;

  constructor(key: string) {
    super(`Unknown Lightroom SDK develop key "${key}" (not in the pinned S5 dump)`);
    this.name = "UnknownSdkKeyError";
    this.key = key;
  }
}

export function jsonValueType(value: unknown): SdkValueType {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "number":
    case "string":
    case "boolean":
      return typeof value as "number" | "string" | "boolean";
    case "object":
      return "object";
    default:
      throw new TypeError(`Value of type ${typeof value} cannot come from a JSON dump`);
  }
}

export function parseS5Dump(raw: unknown): S5Dump {
  return s5DumpSchema.parse(raw);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Union the keys of one or more S5 dumps into a pinned key table, sorted by key.
 * A key whose non-null type differs between dumps is an error: that needs a human
 * look, not a silent pick. A null in one dump and a concrete type in another
 * resolves to the concrete type.
 */
export function pinFromDumps(
  dumps: ReadonlyArray<{ label: string; dump: unknown }>,
  meta: { generatedBy: string; generatedAt: string },
): PinnedSdkKeys {
  if (dumps.length === 0) throw new Error("pinFromDumps needs at least one dump");

  const byKey = new Map<string, SdkKeyEntry>();
  const sources: PinnedSdkKeys["sources"] = [];

  for (const { label, dump: raw } of dumps) {
    const dump = parseS5Dump(raw);
    const source: PinnedSdkKeys["sources"][number] = { label, filename: dump.meta.filename };
    const lrVersion = dump.meta.lr_version;
    const processVersion = optionalString(dump.settings["ProcessVersion"]);
    const cameraProfile = optionalString(dump.settings["CameraProfile"]);
    if (lrVersion !== undefined) source.lr_version = lrVersion;
    if (processVersion !== undefined) source.process_version = processVersion;
    if (cameraProfile !== undefined) source.camera_profile = cameraProfile;
    sources.push(source);

    for (const [key, value] of Object.entries(dump.settings)) {
      const type = jsonValueType(value);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { key, type, sample: value, seen_in: [label] });
        continue;
      }
      existing.seen_in.push(label);
      if (existing.type === "null" && type !== "null") {
        existing.type = type;
        existing.sample = value;
      } else if (type !== "null" && existing.type !== type) {
        throw new Error(
          `Key "${key}" has type ${existing.type} in [${existing.seen_in.slice(0, -1).join(", ")}] but ${type} in ${label}`,
        );
      }
    }
  }

  const keys = [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return {
    schema_version: 1,
    generated_by: meta.generatedBy,
    generated_at: meta.generatedAt,
    sources,
    keys,
  };
}

export class SdkKeyMap {
  private readonly entries: ReadonlyMap<string, SdkKeyEntry>;

  constructor(pinned: PinnedSdkKeys) {
    const entries = new Map<string, SdkKeyEntry>();
    for (const entry of pinned.keys) {
      if (entries.has(entry.key)) throw new Error(`Duplicate SDK key "${entry.key}" in pinned key file`);
      entries.set(entry.key, entry);
    }
    this.entries = entries;
  }

  get size(): number {
    return this.entries.size;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  /** Returns the pinned entry, or throws UnknownSdkKeyError. */
  get(key: string): SdkKeyEntry {
    const entry = this.entries.get(key);
    if (!entry) throw new UnknownSdkKeyError(key);
    return entry;
  }

  keys(): string[] {
    return [...this.entries.keys()];
  }
}

export function loadSdkKeys(raw: unknown): SdkKeyMap {
  return new SdkKeyMap(pinnedSdkKeysSchema.parse(raw));
}

export function readSdkKeysFile(path: string): SdkKeyMap {
  return loadSdkKeys(JSON.parse(readFileSync(path, "utf8")) as unknown);
}
