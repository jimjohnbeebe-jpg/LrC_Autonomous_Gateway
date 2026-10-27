// `npm run stats:check` (issue #216): lr_get_photo_stats and lr_get_preview quality "fast" in Lightroom.
// The pure parts: when a fast preview caught up with a change, and the verdict. The CLI (stats-check-cli.ts)
// drives Lightroom. Report: docs\reports\phase11\METRICS-PARITY.md.

/** The time budget the check holds the stats to: about 3 s a photo, the export time the tool description states [inference]. */
export const MS_PER_PHOTO = 3000;
/** Seconds after the write at which a fast preview is taken. */
export const OFFSETS_S = [0, 0.5, 1, 2, 3.5, 5, 8, 12] as const;
/** A fast preview counts as caught up once it moved this share of the way the export moved [inference: the figure]. */
export const CAUGHT_UP = 0.75;

export type Sample = { at_ms: number; source: string; luma_mean: number | null; ms: number };

/**
 * The first sample, from the thumbnail, whose luma moved at least CAUGHT_UP of the way the exact export moved
 * (thumbnail compared with the thumbnail before the write, export with the export). Null with a reason when
 * none did, or when the change was too small to tell (under 1 level of luma).
 */
export function caughtUpAt(samples: readonly Sample[], thumbBefore: number, exportBefore: number, exportAfter: number): { at_ms: number | null; why?: string } {
  const moved = exportAfter - exportBefore;
  if (Math.abs(moved) < 1) return { at_ms: null, why: `the export's luma moved ${moved.toFixed(2)}, too little to tell` };
  const hit = samples.find((s) => s.source === "thumbnail" && s.luma_mean !== null && (s.luma_mean - thumbBefore) / moved >= CAUGHT_UP);
  return hit ? { at_ms: hit.at_ms } : { at_ms: null, why: `no thumbnail caught up within ${OFFSETS_S.at(-1)} s` };
}

export type StatsRun = { photos: number; measured: number; total_ms: number; thumbnails: number; fast_tries: number; put_back: boolean | null; answer: string | null };

/** WORKED when every photo was measured within the budget, a fast preview came from the thumbnail, the photo is back, and Jim said y. */
export function verdict(r: StatsRun): { worked: boolean; lines: string[] } {
  const budget = r.photos * MS_PER_PHOTO;
  const rows: Array<[boolean, string]> = [
    [r.photos > 0 && r.measured === r.photos, `lr_get_photo_stats measured ${r.measured} of ${r.photos} photos`],
    [r.total_ms <= budget, `the ${r.photos} photos took ${Math.round(r.total_ms / 100) / 10} s (budget ${budget / 1000} s, ${MS_PER_PHOTO / 1000} s a photo)`],
    [r.thumbnails > 0, `${r.thumbnails} of ${r.fast_tries} fast previews came from Lightroom's cached preview`],
    [r.put_back === true, `the photo changed for the staleness test is back as it was${r.put_back === null ? " (the test did not run)" : ""}`],
    [r.answer === "y", `Jim's answer: ${r.answer ?? "not asked"}`],
  ];
  return { worked: rows.every(([ok]) => ok), lines: rows.map(([ok, text]) => `${ok ? "YES" : "NO "} ${text}`) };
}
