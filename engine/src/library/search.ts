// The catalog reads kept from Automaat (PHASE6_PROTOTYPE_PLAN row 2): the findPhotos search
// descriptor for lr_search_photos, the photo listing every read tool returns, and the limits.
//
// The descriptor's entries are Automaat's [upstream claim: vendor\automaat\plugin\LightroomMCP.lrplugin\HandlerSearch.lua:38-76]:
// filename "any" (contains), rating "==", one keywords "all" entry per keyword, and captureTime "in"
// from a start to an end day, or ">" the day before a start, or "<" the day after an end. The
// criteria names filename, rating, keywords and captureTime, and the operations "==", "any", "all",
// "in", ">" and "<", are on the SDK's page [handle: https://lrc.mcor.dev/modules/LrCatalog.html
// findPhotos]; that Lightroom 15.5.1 matches them as Automaat expects is [unverified] until the row 2
// check (docs\reports\phase6\catalog-tools-check\).

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

export type SearchFilters = {
  filename?: string | undefined;
  keywords?: string[] | undefined;
  rating?: number | undefined;
  start_date?: string | undefined;
  end_date?: string | undefined;
};

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
  return out;
}

type ListedPhoto = CommandResult<"search_photos">["photos"][number];

/** A photo as the read tools list it; rating 0 when the plugin sent none (unrated). */
export function listing(p: ListedPhoto): Record<string, unknown> {
  return {
    uuid: p.uuid ?? null,
    filename: p.filename ?? null,
    rating: p.rating ?? 0,
    capture_time: p.capture_time ?? null,
    virtual_copy: p.is_virtual_copy ?? null,
    ...(p.copy_name !== undefined ? { copy_name: p.copy_name } : {}),
  };
}
