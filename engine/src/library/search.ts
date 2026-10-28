// The catalog reads kept from Automaat (PHASE6_PROTOTYPE_PLAN row 2): the findPhotos search
// descriptor for lr_search_photos, the photo listing every read tool returns, and the limits.
//
// The descriptor's entries are Automaat's [upstream claim: vendor\automaat\plugin\LightroomMCP.lrplugin\HandlerSearch.lua:38-76]:
// filename "any" (contains), rating "==", one keywords "all" entry per keyword, and captureTime "in"
// from a start to an end day, or ">" the day before a start, or "<" the day after an end. The
// criteria names filename, rating, keywords and captureTime, and the operations "==", "any", "all",
// "in", ">" and "<", are on the SDK's page [handle: https://lrc.mcor.dev/modules/LrCatalog.html
// findPhotos]. Lightroom 15.5.1 matched all six as Automaat expects in the row 2 check, `rating == 0`
// finding an unrated photo too [handle: docs\reports\phase6\catalog-tools-check\check.txt section 1].

import type { CommandResult, SearchCriterion } from "../bridge/index.js";

/** Largest page a read tool returns (Catalog.lua MAX_DESCRIBED, Library.lua MAX_PAGE). */
export const MAX_PAGE = 500;
/** Automaat's default page [upstream claim: vendor\automaat\server\src\tool-contracts.ts:210]. */
export const DEFAULT_PAGE = 100;
/**
 * A search or a collection listing reads the whole catalog or every collection; Automaat warns that
 * an unfiltered search scans the full catalog [upstream claim: HandlerSearch.lua:136]. 60 s, against
 * the client's default 15 s [inference: the figure].
 */
export const CATALOG_READ_TIMEOUT_MS = 60000;

// Issue #218 row 1 (below) adds camera, lens, ISO, focal length, flag, colour label, edited status and file type.

/** The colour labels by name, as findPhotos' "labelColor" takes them [handle: D:\Developer\LightRoom Classic Dev Kit\API Reference\modules\LrCatalog.html, findPhotos "labelColor"]. */
export const LABEL_VALUES = { red: 1, yellow: 2, green: 3, blue: 4, purple: 5, none: "none" } as const;
export type LabelName = keyof typeof LABEL_VALUES;
/** findPhotos' "fileFormat" values [handle: LrCatalog.html above, findPhotos "fileFormat"]. */
export const FILE_TYPES = ["DNG", "RAW", "JPG", "TIFF", "PNG", "PSD", "VIDEO", "PSB", "AVIF", "JXL"] as const;
export type FileType = (typeof FILE_TYPES)[number];

export type SearchFilters = {
  filename?: string | undefined;
  keywords?: string[] | undefined;
  rating?: number | undefined;
  start_date?: string | undefined;
  end_date?: string | undefined;
  camera?: string | undefined;
  lens?: string | undefined;
  iso?: number | undefined;
  focal_length?: number | undefined;
  flag?: "pick" | "reject" | "none" | undefined;
  color_label?: LabelName | undefined;
  edited?: boolean | undefined;
  file_type?: FileType | undefined;
};

const PICK = { pick: 1, none: 0, reject: -1 } as const;

/**
 * Issue #218 row 1: the Library filters upstream added (Automaat PR #408), as its buildSearchDesc writes them
 * [upstream claim: Automaat/lightroom-mcp@1040453 plugin/LightroomMCP.lrplugin/HandlerSearch.lua:87-121].
 * "camera" and "lens" are "(string, with exact match)", "isoSpeedRating" a number, "pick" 1/0/-1,
 * "hasAdjustments" a Boolean and "fileFormat" an enum on the SDK's page [handle: LrCatalog.html above, findPhotos];
 * the operations "isTrue"/"isFalse" for a Boolean are on the same page. "focalLength" is not on it: it is
 * [upstream claim] only, and what Lightroom matches for it is [unverified] until Jim's catalog:check.
 */
function libraryCriteria(f: SearchFilters): SearchCriterion[] {
  const out: SearchCriterion[] = [];
  if (f.camera !== undefined) out.push({ criteria: "camera", operation: "==", value: f.camera });
  if (f.lens !== undefined) out.push({ criteria: "lens", operation: "==", value: f.lens });
  if (f.iso !== undefined) out.push({ criteria: "isoSpeedRating", operation: "==", value: f.iso });
  if (f.focal_length !== undefined) out.push({ criteria: "focalLength", operation: "==", value: f.focal_length });
  if (f.flag !== undefined) out.push({ criteria: "pick", operation: "==", value: PICK[f.flag] });
  if (f.color_label !== undefined) out.push({ criteria: "labelColor", operation: "==", value: LABEL_VALUES[f.color_label] });
  if (f.edited !== undefined) out.push({ criteria: "hasAdjustments", operation: f.edited ? "isTrue" : "isFalse", value: f.edited });
  if (f.file_type !== undefined) out.push({ criteria: "fileFormat", operation: "==", value: f.file_type });
  return out;
}

/** True for a real "YYYY-MM-DD" calendar day. */
export function isCalendarDay(day: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === day;
}

/** The day `days` after a "YYYY-MM-DD" day (negative: before). */
export function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The search descriptor's entries; the plugin intersects them. None: no filter. */
export function searchCriteria(f: SearchFilters): SearchCriterion[] {
  const out: SearchCriterion[] = [];
  if (f.filename !== undefined) out.push({ criteria: "filename", operation: "any", value: f.filename });
  if (f.rating !== undefined) out.push({ criteria: "rating", operation: "==", value: f.rating });
  for (const keyword of f.keywords ?? []) out.push({ criteria: "keywords", operation: "all", value: keyword });
  if (f.start_date !== undefined && f.end_date !== undefined) {
    out.push({ criteria: "captureTime", operation: "in", value: f.start_date, value2: f.end_date });
  } else if (f.start_date !== undefined) {
    out.push({ criteria: "captureTime", operation: ">", value: shiftDay(f.start_date, -1) });
  } else if (f.end_date !== undefined) {
    out.push({ criteria: "captureTime", operation: "<", value: shiftDay(f.end_date, 1) });
  }
  return [...out, ...libraryCriteria(f)];
}

type ListedPhoto = CommandResult<"search_photos">["photos"][number];

/** Plugin 0.21.0 (Photos.lua describe opts.where, issue #139): a listed photo carries its gps and path. */
export const WHERE_PLUGIN = "0.21.0";
/** The notice a listing or the context carries instead, when Lightroom runs an older plugin (issue #139 "Cross-cutting"). */
export const WHERE_NOTICE = "Lightroom runs an LrC-AVG plugin older than 0.21.0, so photos carry no gps (and listings no path). Restart Lightroom so it loads the current plugin.";

/**
 * A photo as the read tools list it; rating 0 when the plugin sent none (unrated). With `where` (the
 * plugin is WHERE_PLUGIN or later) also gps, null for none, and path.
 */
export function listing(p: ListedPhoto, where: boolean): Record<string, unknown> {
  return {
    uuid: p.uuid ?? null,
    filename: p.filename ?? null,
    rating: p.rating ?? 0,
    capture_time: p.capture_time ?? null,
    virtual_copy: p.is_virtual_copy ?? null,
    ...(p.copy_name !== undefined ? { copy_name: p.copy_name } : {}),
    ...(where ? { gps: p.gps ?? null, path: p.path ?? null } : {}),
  };
}
