// The Phase 4 check's cleanup (phase4-check.ts), run whatever happened before it:
//   1. Jim removes the virtual copies the check and the chat made (PHASE4_PLAN decision 4: the SDK
//      has no call that removes a photo [handle: docs\reports\phase4\S7.md Verdict 2]); the check
//      then looks each one up by uuid (phase4-copies.ts copyStates) and asks again for any left.
//      Copies it knows no uuid for (Run.unconfirmedCopies) are named for Jim, not checked;
//   2. Jim deletes the check's preset and his two reference presets in Lightroom [stated: Jim,
//      2026-09-28, plan decision 4]; the check then looks for their files. A preset Lightroom did not
//      list cannot be deleted there, so the check deletes its own file itself. Whether Lightroom's
//      Delete removes the file is [unverified] until this check runs;
//   3. the photo is checked against its settings before the check (the chat's Variants session must
//      not have edited it).
// Without the bridge (Claude Desktop still holding it), steps 1 and 3 cannot be checked; step 2
// needs only the files. The cleanup's outcome has its own headline; it is not an acceptance line.

import { unlinkSync } from "node:fs";
import path from "node:path";
import { differingSettings } from "../params/index.js";
import { findPresetFiles } from "../presets/index.js";
import { describeError } from "./phase1-check.js";
import { copyStates, type CopyState } from "./phase4-copies.js";
import { PHOTO, REFERENCE_PRESETS, errorBody, settingsOf, type Json, type Phase4Deps, type Photo, type Run } from "./phase4-config.js";

/** Up to three rounds of removal for copies left over, and for presets. */
const ROUNDS = 3;

/**
 * `verified`: the copies and the photo were checked through the bridge. `unconfirmed`: names of
 * copies that may exist although the check knows no uuid for them (Run.unconfirmedCopies).
 */
export type CleanupOutcome = { copiesGone: number; copies: number; unconfirmed: string[]; verified: boolean; presetsGone: number; presets: number; masterAsBefore: boolean | null };

export async function cleanup(deps: Phase4Deps, run: Run, photo: Photo | null, bridgeReleased: boolean): Promise<CleanupOutcome> {
  const out: Json = {};
  run.results["cleanup"] = out;
  deps.say("");
  deps.say("Cleanup.");
  // The copies and the photo are checked through the bridge; the presets only through their files,
  // so they are cleaned up even when the bridge cannot be taken back (Greptile, PR #37).
  const bridge = !bridgeReleased || (await retakeBridge(deps));
  if (!bridge) {
    out["bridge"] = "the bridge could not be taken back from Claude Desktop";
    deps.say("  The check could not reach Lightroom again, so it cannot confirm that the copies are gone. Tell Claude Code.");
  }
  const outcome: CleanupOutcome = { copiesGone: 0, copies: run.copies.length, unconfirmed: [...run.unconfirmedCopies], verified: bridge, presetsGone: 0, presets: 0, masterAsBefore: null };
  await guarded(deps, out, "copies", async () => {
    const states = await removeCopies(deps, run, bridge);
    out["copies"] = states;
    outcome.copiesGone = states.filter((s) => s.state === "gone").length;
  });
  await guarded(deps, out, "presets", async () => {
    const presets = await removePresets(deps, run);
    out["presets"] = presets;
    Object.assign(outcome, { presets: presets.length, presetsGone: presets.filter((p) => p["files"] === 0).length });
  });
  if (bridge && photo) await guarded(deps, out, "photo", async () => void (outcome.masterAsBefore = await masterAsBefore(deps, photo, out)));
  return outcome;
}

/** One part of the cleanup; an error stops that part only, so the others still run. */
async function guarded(deps: Phase4Deps, out: Json, part: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    out[`${part}_error`] = errorBody(err);
    deps.say(`  The cleanup of the ${part} stopped: ${describeError(err)}. Tell Claude Code.`);
  }
}

/** After the chat: Jim quits Claude Desktop, so the check can take the bridge again; false when it cannot. */
async function retakeBridge(deps: Phase4Deps): Promise<boolean> {
  let text = "  First quit Claude Desktop: right-click the Claude icon in the Windows system tray > Quit. Then press Enter here.";
  for (let round = 1; round <= ROUNDS; round++) {
    if ((await deps.prompt(text)) === null) return false;
    if (await deps.gate.start()) {
      try {
        await deps.client.waitConnected(deps.connectTimeoutMs ?? 20000);
        return true;
      } catch {
        return false;
      }
    }
    text = "  Claude Desktop is still running (it holds the Lightroom bridge). Quit it from the system tray (right-click the Claude icon > Quit), then press Enter.";
  }
  return false;
}

/** Jim removes the copies; with the bridge, the check looks each up and asks again while some are left. */
async function removeCopies(deps: Phase4Deps, run: Run, verify: boolean): Promise<CopyState[]> {
  if (run.copies.length === 0 && run.unconfirmedCopies.length === 0) return [];
  const { say } = deps;
  say(`  Remove the virtual copies of ${PHOTO} that the check and the chat made (${run.copies.length} known; their copy names start with "AVG"):`);
  if (run.unconfirmedCopies.length > 0) {
    say(`  Also remove any copies named ${run.unconfirmedCopies.map((n) => `"${n}"`).join(", ")}: the check asked Lightroom for them but got no answer, so it cannot confirm them.`);
  }
  say("  1. Press G for the Library module's Grid.");
  say(`  2. The copies sit next to ${PHOTO}; each has a turned-page corner at the bottom left of its thumbnail.`);
  say("  3. Click the first copy, then Ctrl-click each of the others. Do not select the photo without the corner (the original).");
  say("  4. Press Delete. Lightroom asks whether to remove the virtual copies: click Remove.");
  say('     If the dialog offers "Delete from Disk", click Cancel: the original is selected too. Then start again at step 3.');
  if (!verify) {
    await deps.prompt("  5. Press Enter here.");
    return run.copies.map((c) => ({ ...c, state: "unknown", error: "not checked: the check could not reach Lightroom" }));
  }
  let states: CopyState[] = [];
  let text = "  5. Press Enter here.";
  for (let round = 1; round <= ROUNDS; round++) {
    if ((await deps.prompt(text)) === null) break;
    states = await copyStates(deps, run);
    const left = states.filter((s) => s.state !== "gone");
    say(`  Copies removed: ${states.length - left.length} of ${states.length}.`);
    if (left.length === 0) break;
    text = `  Still in the catalog: ${left.map((s) => `"${s.copy_name}"`).join(", ")}. Remove them as above, then press Enter.`;
  }
  return states;
}

/** The presets to remove, with the files that still hold each name. Jim deletes the listed ones; the check deletes its own when Lightroom did not list it. */
async function removePresets(deps: Phase4Deps, run: Run): Promise<Json[]> {
  const listed = (run.results["preset"] as Json | undefined)?.["listed_after_restart"] === "y";
  if (run.preset && !listed) deleteOwnPreset(deps, run.preset.path);
  const names = [...REFERENCE_PRESETS, ...(run.preset && listed ? [run.preset.name] : [])];
  const present = (): string[] => names.filter((n) => findPresetFiles(deps.presetDir, n).length > 0);
  let left = present();
  for (let round = 1; round <= ROUNDS && left.length > 0; round++) {
    deps.say(`  Delete ${left.length === 1 ? "this preset" : "these presets"} in the group "LrC-AVG": ${left.map((n) => `"${n}"`).join(", ")}.`);
    deps.say('  1. Press D for the Develop module. In the Presets panel (left side), open the group "LrC-AVG".');
    deps.say("  2. Right-click each of them > Delete. If Lightroom asks to confirm, click Delete.");
    if ((await deps.prompt("  3. Press Enter here.")) === null) break;
    left = present();
  }
  const all = run.preset ? [...names.filter((n) => n !== run.preset?.name), run.preset.name] : names;
  const result = all.map((name) => ({ name, files: findPresetFiles(deps.presetDir, name).length }));
  deps.say(`  Presets removed: ${result.filter((r) => r.files === 0).length} of ${result.length}.`);
  return result;
}

/** The check's own preset file, which Lightroom did not list (it was never shown, so Jim cannot delete it there). */
function deleteOwnPreset(deps: Phase4Deps, file: string): void {
  try {
    unlinkSync(file);
    deps.say(`  The check deleted its own preset file ${path.basename(file)} (Lightroom did not list it).`);
  } catch (err) {
    deps.say(`  The check could not delete its preset file ${path.basename(file)}: ${describeError(err)}.`);
  }
}

/** The photo against its settings before the check. */
async function masterAsBefore(deps: Phase4Deps, photo: Photo, out: Json): Promise<boolean> {
  const differing = differingSettings((await settingsOf(deps, photo.uuid)).settings, photo.start);
  out["master_differing"] = differing;
  deps.say(`  ${PHOTO} is as it was before the check: ${differing.length === 0 ? "YES" : `NO (${differing.join(", ")} differ)`}.`);
  return differing.length === 0;
}
