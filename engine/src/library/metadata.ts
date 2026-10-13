// The catalog metadata tools (GitHub issues #111, #112, #139 gaps 2 and 4; plugin 0.22.0,
// plugin\LrC-AVG.lrplugin\Metadata.lua; the MCP side is mcp\tools-metadata.ts): lr_set_flag,
// lr_set_iptc and lr_get_metadata, and lr_search_photos' folder. What Lightroom took in spike S11 is
// in docs\reports\phase8.5\S11.md "Consequences".

/** The plugin with set_flag, set_iptc, get_metadata and search_photos' folder. */
export const METADATA_PLUGIN = "0.22.0";

/**
 * Characters per title, caption or headline [inference: the figure, decision D4 of the plan,
 * Jim 2026-10-13 "Go with recommendations" [stated]]. What Lightroom keeps of a longer text is
 * [unverified]; the read-back catches a text it changed.
 */
export const MAX_TEXT = 2000;

/** The pick flag by name, as getRawMetadata("pickStatus") holds it [handle: S11.md "Pre-run findings"]. */
export const FLAGS = { pick: 1, none: 0, reject: -1 } as const;
export type FlagName = keyof typeof FLAGS;

/** A pickStatus value by name; a value outside 1, 0, -1 as it came. */
export function flagName(value: number): FlagName | number {
  const found = (Object.keys(FLAGS) as FlagName[]).find((name) => FLAGS[name] === value);
  return found ?? value;
}

export const TEXT_FIELDS = ["title", "caption", "headline"] as const;
export type TextField = (typeof TEXT_FIELDS)[number];
export type IptcText = Record<TextField, string>;

/** What a title/caption/headline read-back shows Lightroom did not take, or null. */
export function textNotTaken(after: IptcText, want: Partial<IptcText>): string | null {
  const off = TEXT_FIELDS.filter((f) => want[f] !== undefined && after[f] !== want[f]);
  return off.length === 0 ? null : `Lightroom read back ${off.map((f) => `${f} ${JSON.stringify(after[f])}`).join(", ")}, not what was written.`;
}

/**
 * Why there is no stack tool (issue #139 "Cross-cutting": say so, do not fail silently): the SDK
 * stacks a photo only as it is imported [handle: S11.md "Consequences"]. The menu path is
 * [inference: S11.md "Pre-run findings" names "Photo > Stacking"].
 */
export const NO_STACK_WRITE =
  "Lightroom's plugin SDK cannot stack photos that are already in the catalog, so no tool makes or breaks a stack: use Photo > Stacking in Lightroom.";

/** A folder path without trailing separators, a drive root ("D:\") kept as it is. */
export function folderPath(path: string): string {
  const trimmed = path.trim();
  return /^[A-Za-z]:[\\/]$/.test(trimmed) ? trimmed : trimmed.replace(/[\\/]+$/, "");
}
