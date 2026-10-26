// The Lightroom plugin version this engine's bridge protocol matches, a comparison for checks
// that also run on an older plugin, and the notice for a plugin that is not this engine's version.

/** plugin\LrC-AVG.lrplugin\Bridge.lua PLUGIN_VERSION (engine\tests\lua-plugin.test.ts keeps them equal). */
export const PLUGIN_VERSION = "1.3.0";

function parts(version: string): number[] | null {
  return /^\d+\.\d+\.\d+$/.test(version) ? version.split(".").map(Number) : null;
}

/** True when `version` is a "major.minor.patch" string at or above `minimum`. */
export function pluginVersionAtLeast(version: unknown, minimum: string): boolean {
  const have = typeof version === "string" ? parts(version) : null;
  const want = parts(minimum);
  if (!have || !want) return false;
  for (let i = 0; i < 3; i++) {
    const a = have[i] as number;
    const b = want[i] as number;
    if (a !== b) return a > b;
  }
  return true;
}

/**
 * The HUD's line for a plugin that differs from this engine: photographer's words, with no
 * "engine" (tests\helpers\hud-harness.ts hudWordProblems), so the versions stay in updateNotices.
 */
export const UPDATE_HUD_NOTE = "LrC-AVG was updated: restart Lightroom Classic to finish the update.";

/**
 * What to tell the user when the connected plugin's version is not the engine's: an advisory, never a
 * block (the minimum-version checks stay). Both ship at one version (Phase 9, D10), so a difference
 * means one half was updated while Lightroom still runs the other [inference: Lightroom loads a
 * plugin once, at start]. Empty when either version is not "major.minor.patch": a development or
 * test engine ("test", "unknown") has nothing to compare.
 */
export function updateNotices(pluginVersion: unknown, engineVersion: unknown): string[] {
  if (typeof pluginVersion !== "string" || typeof engineVersion !== "string") return [];
  if (!parts(pluginVersion) || !parts(engineVersion) || pluginVersion === engineVersion) return [];
  return [`LrC-AVG was updated: restart Lightroom Classic to finish the update (plugin ${pluginVersion}, engine ${engineVersion})`];
}
