// Lightroom's 8 HSL bands on the HSV hue of a render (Phase 10 row 7). The centres and widths (FWHM) are
// spike S14's, measured on a generated hue chart with one band at Saturation -100 at a time [handle:
// docs\reports\phase10\S14.md "c. HSL bands"]. The bands overlap there; to give each chromatic pixel one
// band, the edge between two neighbours divides the gap between their centres in proportion to their
// widths [inference: our choice, so a wide band such as green takes more of the gap than a narrow one].
// Still [unverified] (S14 "Consequences"): whether bands measured on a rendered sRGB chart hold on raw photos.

export const HSL_BANDS = [
  { band: "red", centre: 351, width: 27 },
  { band: "orange", centre: 24, width: 24 },
  { band: "yellow", centre: 53, width: 31 },
  { band: "green", centre: 110, width: 90 },
  { band: "aqua", centre: 168, width: 35 },
  { band: "blue", centre: 218, width: 80 },
  { band: "purple", centre: 283, width: 59 },
  { band: "magenta", centre: 325, width: 21 },
] as const;

export type Band = (typeof HSL_BANDS)[number]["band"];
export type BandShares = Record<Band, number>;

/** Each band's upper edge, in degrees: where its gap to the next band's centre divides. */
const EDGES = HSL_BANDS.map((a, i) => {
  const b = HSL_BANDS[(i + 1) % HSL_BANDS.length] as (typeof HSL_BANDS)[number];
  const gap = (b.centre - a.centre + 360) % 360;
  return (a.centre + (gap * a.width) / (a.width + b.width)) % 360;
});

/** The band of each 1-degree hue bin, taken at its centre. */
const BAND_OF = Array.from({ length: 360 }, (_, degree) => {
  const hue = degree + 0.5;
  // Band k runs from the edge before it (band k - 1's) up to its own edge; red's crosses 0.
  return HSL_BANDS.findIndex((_, k) => {
    const lo = EDGES[(k + HSL_BANDS.length - 1) % HSL_BANDS.length] as number;
    const span = ((EDGES[k] as number) - lo + 360) % 360;
    return (hue - lo + 360) % 360 < span;
  });
});

/** The % of the chromatic pixels in each band, from a 360-bin hue histogram of them (stats.ts accumulate); all 0 when there are none. */
export function bandShares(hue: Float64Array, chromatic: number): BandShares {
  const counts = new Array<number>(HSL_BANDS.length).fill(0);
  for (let degree = 0; degree < 360; degree++) counts[BAND_OF[degree] as number]! += hue[degree] as number;
  return Object.fromEntries(HSL_BANDS.map((b, i) => [b.band, chromatic === 0 ? 0 : Math.round(((counts[i] as number) / chromatic) * 1000) / 10])) as BandShares;
}
