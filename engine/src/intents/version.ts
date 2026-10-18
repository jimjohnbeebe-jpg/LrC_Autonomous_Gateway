// The schema version check of an intent, before the schema runs (loader.ts check).

import { INTENT_SCHEMA_VERSION } from "./schema.js";

/**
 * Null for a schema v2 intent; else how to rewrite it (schema v1 is not read: decision I1 A [stated: Jim, 2026-10-09, "Go"]).
 * The user reads this as a warning in lr_list_intents, Claude as the error of lr_save_intent, so it says what to ask and what to change.
 * lr_save_intent with replace: true overwrites the skipped file [handle: loader.ts save, tests\intents.test.ts "keeps a user file the loader skipped"].
 */
export function versionProblem(candidate: unknown): string | null {
  const version = typeof candidate === "object" && candidate !== null ? (candidate as Record<string, unknown>)["schema_version"] : undefined;
  if (version === INTENT_SCHEMA_VERSION) return null;
  const which = version === undefined ? "missing, so this is a schema v1 intent" : `${JSON.stringify(version)} is not supported`;
  return (
    `schema_version: ${which}, and the engine skips it. To convert it, ask Claude: "Rewrite this intent as schema v2 and save it over the old file." ` +
    `Claude needs the old file's text (it is in the intents folder; paste it into the chat if Claude cannot open it), makes the changes below and saves it with lr_save_intent and replace: true after you approve. ` +
    `The changes: "schema_version": 2, "default_camera_profile" becomes "profile": {"raw": …, "rendered": "Color" or "Monochrome"}, and temperature and tint priors move to "priors_by_pipeline": {"raw": {…}}`
  );
}
