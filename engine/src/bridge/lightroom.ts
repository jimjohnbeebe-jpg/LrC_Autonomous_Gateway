// The Lightroom Classic versions LrC-AVG supports, and the notices for one outside them. A version
// outside [MIN_SUPPORTED_LRC, TESTED_LRC] gets a notice, never a refusal [stated: Jim, 2026-10-03,
// "Set version 15.0 as the baseline, but note that it might work on earlier versions (untested.)"].
// `lrc_version` is LrApplication.versionString() as the plugin sends it in hello and get_context
// [handle: plugin\LrC-AVG.lrplugin\Bridge.lua:75, :151; Develop.lua:107]: "15.6" [handle: docs\reports\phase6\lrc-version-check\check.txt
// section 1] and "15.5.1" [handle: docs\reports\phase5\PHASE5.md "Numbers", "Plugin, engine, connect time"] were observed.

/** The supported baseline: earlier versions may work but are untested. */
export const MIN_SUPPORTED_LRC = "15.0";
/** The newest version tested [handle: docs\reports\phase6\lrc-version-check\check.txt section 1, "Lightroom 15.6"]. */
export const TESTED_LRC = "15.6";

/**
 * Major and minor of a version string ("15.5.1" -> [15, 5]), or null. A patch release counts as its
 * minor version, so 15.6.1 is not "newer than tested" [inference: a patch release fixes bugs]. Text
 * after the number, such as a build tag, is ignored [inference: no such tag was observed].
 */
function majorMinor(version: string): [number, number] | null {
  const m = /^\s*(\d+)\.(\d+)(?:\.\d+)?(?![\w.])/.exec(version);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function compare(a: [number, number], b: [number, number]): number {
  return a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1];
}

/**
 * What to tell the user about this Lightroom version: nothing within the supported and tested range,
 * else one short sentence, short enough for one HUD note (bridge\hud-protocol.ts HUD_LIMITS.text).
 */
export function lightroomNotices(lrcVersion: unknown): string[] {
  const v = typeof lrcVersion === "string" ? majorMinor(lrcVersion) : null;
  if (!v) return [`Could not read the Lightroom Classic version. LrC-AVG supports ${MIN_SUPPORTED_LRC} and later.`];
  const shown = v.join(".");
  if (compare(v, majorMinor(MIN_SUPPORTED_LRC) as [number, number]) < 0) {
    return [`Lightroom Classic ${shown} is older than ${MIN_SUPPORTED_LRC}, the supported version. LrC-AVG may work but is untested.`];
  }
  if (compare(v, majorMinor(TESTED_LRC) as [number, number]) > 0) {
    return [`Lightroom Classic ${shown} is newer than ${TESTED_LRC}, the newest tested. A feature that is unavailable will say so.`];
  }
  return [];
}
