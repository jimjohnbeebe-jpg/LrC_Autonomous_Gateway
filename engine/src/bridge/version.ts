// The Lightroom plugin version this engine's bridge protocol matches, and a comparison for checks
// that also run on an older plugin.

/** plugin\LrC-AVG.lrplugin\Bridge.lua PLUGIN_VERSION (engine\tests\lua-plugin.test.ts keeps them equal). */
export const PLUGIN_VERSION = "0.16.0";

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
