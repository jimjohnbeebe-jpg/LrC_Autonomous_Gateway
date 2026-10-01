// The read-back after each of Jim's clicks (PHASES.md Phase 5, "Inputs from Phase 4": "A check that
// asks Jim to click in Lightroom reads back, right after the click, the original and every photo it
// knows, and names any that changed"; in Phase 4 one preset click also reached the original, found
// only at the cleanup [handle: docs\reports\phase4\PHASE4.md "Cleanup"]).
// The check keeps what it last saw of every photo it knows (Known). Before a click it reads them all
// again (sync), so its own writes count as seen; right after the click it reads them again (readBack):
// a photo the click may change is taken as it now is, a photo given an expected state must match it,
// and any other photo that changed is named in the window and fails the check.

import { BridgeError } from "../bridge/index.js";
import { differingSettings, type CanonicalSettings } from "../params/index.js";
import { describeError } from "./phase1-check.js";
import { settingsOf } from "./phase4-config.js";
import type { Json, Phase5Deps, Run } from "./phase5-config.js";

type Entry = { label: string; seen: CanonicalSettings };

/** The photos the check knows, by uuid, with what it last saw of each. */
export class Known {
  private readonly photos = new Map<string, Entry>();

  set(uuid: string, label: string, seen: CanonicalSettings): void {
    this.photos.set(uuid, { label, seen });
  }

  remove(uuid: string): void {
    this.photos.delete(uuid);
  }

  entries(): Array<[string, Entry]> {
    return [...this.photos.entries()];
  }

  labelOf(uuid: string): string {
    return this.photos.get(uuid)?.label ?? uuid;
  }
}

const readbacksOf = (run: Run): Json[] => (run.results["readbacks"] as Json[] | undefined) ?? [];

/** Where the read-backs stand now, to collect a part's later (unexpectedSince). */
export const readbackMark = (run: Run): number => readbacksOf(run).length;

/** The unexpected changes the read-backs found since `mark`. */
export const unexpectedSince = (run: Run, mark: number): string[] => readbacksOf(run).slice(mark).flatMap((r) => (r["unexpected"] as string[] | undefined) ?? []);

/** Read every known photo again, so the check's own writes are not taken for a click's. */
export async function sync(deps: Pick<Phase5Deps, "client" | "map">, run: Run): Promise<void> {
  for (const [uuid, e] of run.known.entries()) {
    try {
      run.known.set(uuid, e.label, (await settingsOf(deps, uuid)).settings);
    } catch (err) {
      if (err instanceof BridgeError && err.code === "unknown_photo") run.known.remove(uuid); // a copy Jim removed
      else throw err;
    }
  }
}

export type ReadBackOptions = {
  /** Photos the click may change (e.g. the step an Approve released wrote one). */
  changes?: readonly string[];
  /** Photos that must now hold these settings (e.g. the session's photo after an Abort: its start). */
  expect?: ReadonlyArray<{ uuid: string; settings: CanonicalSettings }>;
};

/**
 * Right after Jim's click `after`: every known photo read back. Returns whether nothing changed that
 * should not have; what changed is in `results.readbacks` and, when unexpected, said and failed.
 */
export async function readBack(deps: Pick<Phase5Deps, "client" | "map" | "say">, run: Run, after: string, options: ReadBackOptions = {}): Promise<boolean> {
  const photos: Json[] = [];
  const unexpected: string[] = [];
  for (const [uuid, e] of run.known.entries()) {
    let now: CanonicalSettings;
    try {
      now = (await settingsOf(deps, uuid)).settings;
    } catch (err) {
      photos.push({ photo: e.label, uuid, error: describeError(err) });
      if (!(err instanceof BridgeError && err.code === "unknown_photo")) unexpected.push(`${e.label} (could not be read: ${describeError(err)})`);
      continue;
    }
    const expected = options.expect?.find((x) => x.uuid === uuid);
    const against = expected ? expected.settings : e.seen;
    const differing = differingSettings(now, against);
    const allowed = options.changes?.includes(uuid) === true;
    photos.push({ photo: e.label, uuid, differing, ...(expected ? { against: "expected" } : allowed ? { may_change: true } : {}) });
    if (differing.length > 0 && !allowed) unexpected.push(`${e.label}: ${differing.join(", ")} ${expected ? "differ from what it should hold" : "changed"}`);
    run.known.set(uuid, e.label, now);
  }
  ((run.results["readbacks"] ??= []) as Json[]).push({ after, at: new Date().toISOString(), photos, unexpected });
  if (unexpected.length > 0) run.fail(`read back after ${after}: ${unexpected.join("; ")}`);
  else if (photos.length > 0) deps.say(`  Read back after ${after}: ${photos.length} photo(s), nothing changed that should not have.`);
  return unexpected.length === 0;
}
