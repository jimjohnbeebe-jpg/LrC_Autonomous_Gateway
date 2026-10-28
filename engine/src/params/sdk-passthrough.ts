// Decision D1 of epic #207 (issue #214), option (b) [stated: Jim, 2026-10-28, "Go with recommendations"]: Develop
// settings written by Lightroom's own SDK key, for lr_set_develop_settings (upstream's set_develop_settings
// [upstream claim: Automaat/lightroom-mcp 1040453, server\src\tool-contracts.ts]). The keys are limited to the
// photo's pipeline's pinned dump (sdk-keys.lrc15.json, sdk-keys.lrc15.rendered.json), never free text, and the
// params module stays the only path to an SDK key string (.claude\rules\03-lightroom.md):
//   * a key the canonical map holds goes through the map itself (map.ts toSdk): its type and range, WhiteBalance
//     "Custom" with Temperature/Tint, a point curve on a photo in HDR edit mode written to its extended key;
//   * another pinned key takes only a finite number or a boolean of the pinned type. Its range is not pinned, so it
//     is listed in `unranged` and the read-back decides: the tool writes on the photo active in Develop, where
//     Lightroom checks a write [handle: LR_SDK_NOTES "Recorded in Phase 8 — 2026-10-09", docs\reports\phase8\S10.md
//     run 1 vs run 2];
//   * text and table keys (the profile pair, ProcessVersion, the mask table, FilterList, ...) are refused: each has
//     its canonical name or its own tool, and a string is free text.
// Unknown keys and the legacy process versions are refused, never guessed (PRD FR-4.2, ARCHITECTURE section 5).

import { CAMERA_PROFILE_PARAM } from "./canonical.js";
import type { ParamMap, SdkSettings, WriteContext } from "./map.js";
import { MASK_TABLE_KEY } from "./mask-table.js";
import { ParamError } from "./param-error.js";
import { checkProcessVersion } from "./pipeline.js";
import { CAMERA_PROFILE_KEY, LOOK_KEY, PROCESS_VERSION_KEY } from "./preset-keys.js";
import { UnknownSdkKeyError } from "./sdk-keys.js";
import { describe } from "./validate.js";

/** Where a refused text or table key is set instead. */
const ELSEWHERE: Readonly<Record<string, string>> = {
  [PROCESS_VERSION_KEY]: "lr_set_process_version",
  [CAMERA_PROFILE_KEY]: `the canonical ${CAMERA_PROFILE_PARAM} (lr_step, lr_begin_session profile)`,
  [LOOK_KEY]: `the canonical ${CAMERA_PROFILE_PARAM} (lr_step, lr_begin_session profile)`,
  [MASK_TABLE_KEY]: "the mask tools (lr_create_mask, lr_edit_mask)",
};

/** `raw`: the keys written as given, not through a canonical name (the map does not read them back: settingChanges). */
export type Passthrough = { sdk: SdkSettings; unranged: string[]; raw: string[] };

/** The canonical name whose SDK key `key` is on this photo's pipeline (either curve key), or undefined. */
function canonicalOf(map: ParamMap, key: string, context: WriteContext): string | undefined {
  return map.names().find((n) => n !== CAMERA_PROFILE_PARAM && [false, true].some((hdr) => map.sdkKey(n, context.pipeline, hdr) === key));
}

/** Validate SDK key -> value for a photo (`context` from its fromSdk read) and return the table to write. Throws ParamError. */
export function sdkPassthrough(map: ParamMap, settings: Readonly<Record<string, unknown>>, context: WriteContext): Passthrough {
  checkProcessVersion(context.processVersion);
  const out: SdkSettings = {};
  const unranged: string[] = [];
  const raw: string[] = [];
  const named = new Map<string, string>();
  for (const [key, value] of Object.entries(settings)) {
    let type;
    try {
      type = map.pinnedKey(key, context.pipeline).type;
    } catch (err) {
      if (!(err instanceof UnknownSdkKeyError)) throw err;
      throw new ParamError("unknown_parameter", `"${key}" is not a Lightroom key of ${context.pipeline} photos (the pinned getDevelopSettings() dump); key names are case-sensitive`, key);
    }
    const name = canonicalOf(map, key, context);
    if (name !== undefined) {
      const other = named.get(name);
      if (other !== undefined) throw new ParamError("wrong_type", `${other} and ${key} both set ${name}: give one of them`, key);
      named.set(name, key);
      Object.assign(out, map.toSdk({ [name]: value }, context)); // its type and range, as lr_step checks them
      continue;
    }
    if (type !== "number" && type !== "boolean") {
      const instead = ELSEWHERE[key];
      throw new ParamError("wrong_type", `${key} holds ${type === "string" ? "text" : "a table"}, which this tool does not write${instead ? `: use ${instead}` : ""}`, key);
    }
    if (describe(value) !== type || (typeof value === "number" && !Number.isFinite(value))) {
      throw new ParamError("wrong_type", `${key} takes a ${type === "number" ? "finite number" : "true or false"}, got ${JSON.stringify(value)}`, key);
    }
    out[key] = value;
    raw.push(key);
    if (type === "number") unranged.push(key);
  }
  return { sdk: out, unranged, raw };
}
