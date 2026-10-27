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

/**
 * The text fields by tool name, each with the SDK metadata key the plugin reads and writes (Metadata.lua
 * TEXT_FIELDS and ACCESSIBILITY). Plugin 1.5.0 (issue #218 rows 3-4) added creator to alt_text, upstream's
 * set_metadata and set_location fields [upstream claim: Automaat/lightroom-mcp@1040453
 * plugin/LightroomMCP.lrplugin/HandlerMetadata.lua:359-365, 427-438]; the keys are on the SDK's LrPhoto page
 * [handle: D:\Developer\LightRoom Classic Dev Kit\API Reference\modules\LrPhoto.html, setRawMetadata]. These
 * are metadata keys, not Develop keys, so rule 03's params map does not hold them.
 */
export const TEXT_KEYS = {
  title: "title",
  caption: "caption",
  headline: "headline",
  creator: "creator",
  copyright: "copyright",
  sublocation: "location",
  city: "city",
  state: "stateProvince",
  country: "country",
  iso_country_code: "isoCountryCode",
  alt_text: "altTextAccessibility",
  extended_description: "extDescrAccessibility",
} as const;
export type TextField = keyof typeof TEXT_KEYS;
export const TEXT_FIELDS = Object.keys(TEXT_KEYS) as TextField[];
export type IptcText = Record<TextField, string>;
/** Written only from Lightroom Classic 13.2 (Needs.release in Metadata.lua). */
export const ACCESSIBILITY_FIELDS: readonly TextField[] = ["alt_text", "extended_description"];

/** The plugin's fields (by SDK key) by tool name; a key the plugin did not send is left out. */
export function textFromWire(wire: Record<string, unknown>): Partial<IptcText> {
  const out: Partial<IptcText> = {};
  for (const f of TEXT_FIELDS) {
    const v = wire[TEXT_KEYS[f]];
    if (typeof v === "string") out[f] = v;
  }
  return out;
}

/** The fields to write, by SDK key. */
export function textToWire(want: Partial<IptcText>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of TEXT_FIELDS) if (want[f] !== undefined) out[TEXT_KEYS[f]] = want[f];
  return out;
}

/** What a text read-back shows Lightroom did not take, or null; a field not read back at all counts as not taken. */
export function textNotTaken(after: Partial<IptcText>, want: Partial<IptcText>): string | null {
  const off = TEXT_FIELDS.filter((f) => want[f] !== undefined && after[f] !== want[f]);
  return off.length === 0 ? null : `Lightroom read back ${off.map((f) => `${f} ${after[f] === undefined ? "(not read)" : JSON.stringify(after[f])}`).join(", ")}, not what was written.`;
}

/** The colour labels lr_set_color_label writes, as colorNameForLabel names them [handle: LrPhoto.html above, setRawMetadata colorNameForLabel]. */
export const COLOR_LABELS = ["red", "yellow", "green", "blue", "purple", "none"] as const;
export type ColorLabel = (typeof COLOR_LABELS)[number];

/**
 * Why there is no stack tool (issue #139 "Cross-cutting": say so, do not fail silently): the SDK
 * stacks a photo only as it is imported [handle: S11.md "Consequences"]. The menu path is
 * [inference: S11.md "Pre-run findings" names "Photo > Stacking"].
 */
export const NO_STACK_WRITE =
  "Lightroom's plugin SDK cannot stack photos that are already in the catalog, so no tool makes or breaks a stack: use Photo > Stacking in Lightroom.";

/**
 * A folder path with Windows separators and none trailing, a drive root kept as "D:\". Whether
 * getFolderByPath takes "/" or a path in other case is [unverified]: S11 passed it a path from
 * LrPathUtils.parent [handle: plugin\spikes\S11.lrplugin\S11Stack.lua:59-60].
 */
export function folderPath(path: string): string {
  const p = path.trim().replace(/\//g, "\\").replace(/\\+$/, "");
  return /^[A-Za-z]:$/.test(p) ? `${p}\\` : p;
}
