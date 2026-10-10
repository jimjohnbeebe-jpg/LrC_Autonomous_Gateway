// What of a sync's copied settings can go onto one target (Phase 8 row 5, PHASE8_PLAN "Propagation"):
// the shared groups transfer; white balance and the camera profile do not cross pipelines, and are
// reported as `not_transferable` with the reason instead of failing the target. Lightroom's own Sync
// gets this silently wrong: a photo not loaded in Develop stores the other pipeline's profile pair and
// out-of-range values as written [handle: docs\reports\phase8\S10.md "Observed", "Run 1"].
//   - camera_profile: a profile belongs to one pipeline (camera-profiles.ts pipeline()).
//   - temperature, tint: Kelvin on raw, relative -100..100 on rendered (pipeline.ts WHITE_BALANCE_UNITS).
//     With the source's pipeline known (a recipe from engine 0.21.0 on) and different from the target's,
//     the numbers mean something else and are not written. With it unknown (bare {settings}, an older
//     recipe) each target checks the value against its own range, and a refused value is reported
//     [stated: Jim, 2026-10-09, "Go" to the row 5 plan, decision P2 A].

import { CAMERA_PROFILE_PARAM, ParamError, WHITE_BALANCE_UNITS, type CanonicalSettings, type ParamMap, type Pipeline } from "../params/index.js";
import { groupOf, type MaskGroup } from "./mask.js";

export type NotTransferable = { group: MaskGroup; names: string[]; reason: string };
export type Transferable = { writable: CanonicalSettings; not_transferable: NotTransferable[] };

const WHITE_BALANCE_NAMES = new Set(["temperature", "tint"]);

/** Why a white balance value does not go onto the target, or null when it does. */
function whiteBalanceReason(map: ParamMap, name: string, value: unknown, source: Pipeline | null, target: { pipeline: Pipeline; process_version: string }): string | null {
  if (source !== null) {
    if (source === target.pipeline) return null;
    return `the source photo is on the ${source} pipeline (${WHITE_BALANCE_UNITS[source]} units) and this photo on the ${target.pipeline} pipeline (${WHITE_BALANCE_UNITS[target.pipeline]} units): the numbers mean different things, so the white balance is not synced`;
  }
  try {
    map.toSdk({ [name]: value }, { processVersion: target.process_version, pipeline: target.pipeline });
    return null;
  } catch (err) {
    if (!(err instanceof ParamError)) throw err;
    return `${err.message}: this photo is on the ${target.pipeline} pipeline (${WHITE_BALANCE_UNITS[target.pipeline]} units), and the source's pipeline is not known`;
  }
}

/**
 * Split the copied settings for one target: `writable` is checked against the target's pipeline by the
 * caller (map.toSdk); `not_transferable` lists the white balance and camera profile left out, by group.
 */
export function splitTransferable(map: ParamMap, copied: Readonly<CanonicalSettings>, source: Pipeline | null, target: { pipeline: Pipeline; process_version: string }): Transferable {
  const writable: CanonicalSettings = {};
  const reasons = new Map<MaskGroup, { names: string[]; reason: string }>();
  const leaveOut = (name: string, reason: string): void => {
    const group = groupOf(name) as MaskGroup;
    const entry = reasons.get(group) ?? { names: [], reason };
    entry.names.push(name);
    reasons.set(group, entry);
  };
  for (const [name, value] of Object.entries(copied)) {
    if (name === CAMERA_PROFILE_PARAM && typeof value === "string") {
      const its = map.cameraProfiles().pipeline(value);
      if (its !== target.pipeline) {
        leaveOut(name, `"${value}" is a ${its}-pipeline profile and this photo is on the ${target.pipeline} pipeline: it keeps its own profile`);
        continue;
      }
    } else if (WHITE_BALANCE_NAMES.has(name)) {
      const reason = whiteBalanceReason(map, name, value, source, target);
      if (reason !== null) {
        leaveOut(name, reason);
        continue;
      }
    }
    writable[name] = value;
  }
  return { writable, not_transferable: [...reasons].map(([group, { names, reason }]) => ({ group, names: names.sort(), reason })) };
}
