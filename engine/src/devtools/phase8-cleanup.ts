// The Phase 8 check's cleanup (phase8-check.ts), once every part is recorded (PHASE8_PLAN row 5 "For
// row 6"):
//   1. Jim deletes row 5's two reference presets and the check's own preset in Lightroom; the check
//      then looks for their files. A preset Lightroom did not list cannot be deleted there, so the
//      check deletes its own file itself (as phase4-cleanup.ts);
//   2. Jim deletes row 5's snapshot "before presets" on the JPEG; the plugin has no command that lists
//      or deletes snapshots [handle: engine\src\bridge\protocol.ts, its commands], so Jim answers y/n.
// The check's own snapshots ("AVG P8check before …") and the engine's ("AVG pre-session …", "AVG
// pre-sync …") stay, as after every session and sync.

import { unlinkSync } from "node:fs";
import path from "node:path";
import { findPresetFiles } from "../presets/index.js";
import { describeError } from "./phase1-check.js";
import { REFERENCE_PRESETS, REFERENCE_SNAPSHOT, selectSettled, type Fixture, type Json, type Phase8Deps, type Run } from "./phase8-config.js";

const ROUNDS = 3;

export type CleanupOutcome = { presetsGone: number; presets: number; snapshotGone: boolean | null };

export async function cleanup(deps: Phase8Deps, run: Run, jpeg: Fixture): Promise<CleanupOutcome> {
  const out: Json = {};
  run.results["cleanup"] = out;
  deps.say("");
  deps.say("Cleanup.");
  const presets = await removePresets(deps, run);
  out["presets"] = presets;
  let snapshotGone: boolean | null = null;
  try {
    await selectSettled(deps, jpeg.uuid);
    deps.say(`  Lightroom now shows ${jpeg.label}. In the Snapshots panel (Develop, left side), right-click "${REFERENCE_SNAPSHOT}" > Delete.`);
    snapshotGone = (await deps.ask(`  Is "${REFERENCE_SNAPSHOT}" gone from the Snapshots panel?`)) === "y";
  } catch (err) {
    out["snapshot_error"] = describeError(err);
  }
  out["snapshot_gone"] = snapshotGone;
  const outcome = { presetsGone: presets.filter((p) => p["files"] === 0).length, presets: presets.length, snapshotGone };
  deps.say(`Cleanup: presets removed ${outcome.presetsGone} of ${outcome.presets}; "${REFERENCE_SNAPSHOT}" deleted: ${snapshotGone === null ? "not asked" : snapshotGone ? "YES" : "NO"}.`);
  return outcome;
}

/** Jim deletes the listed presets; the check deletes its own when Lightroom did not list it. */
async function removePresets(deps: Phase8Deps, run: Run): Promise<Json[]> {
  const kept = run.state.kept_preset;
  const listed = run.state.preset?.summary["listed"] === "y";
  if (kept && !listed) {
    try {
      unlinkSync(kept.path);
      deps.say(`  The check deleted its own preset file ${path.basename(kept.path)} (Lightroom did not list it).`);
    } catch (err) {
      deps.say(`  The check could not delete its preset file ${path.basename(kept.path)}: ${describeError(err)}.`);
    }
  }
  const names = [...REFERENCE_PRESETS, ...(kept ? [kept.name] : [])];
  const present = (): string[] => names.filter((n) => findPresetFiles(deps.presetDir, n).length > 0);
  let left = present();
  for (let round = 1; round <= ROUNDS && left.length > 0; round++) {
    deps.say(`  Delete ${left.length === 1 ? "this preset" : "these presets"} in the group "LrC-AVG": ${left.map((n) => `"${n}"`).join(", ")}.`);
    deps.say('  1. In the Develop module\'s Presets panel (left side), open the group "LrC-AVG".');
    deps.say("  2. Right-click each of them > Delete. If Lightroom asks to confirm, click Delete.");
    if ((await deps.prompt("  3. Press Enter here.")) === null) break;
    left = present();
  }
  return names.map((name) => ({ name, files: findPresetFiles(deps.presetDir, name).length }));
}
