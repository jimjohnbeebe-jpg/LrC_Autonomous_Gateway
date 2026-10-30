// Perceptual measurements of a rendered preview (Phase 10 row 7, issue #194): reported to Claude next to
// the metrics, never targets. Measured on the 8-bit sRGB pixels as compute.ts's metrics are. Definitions:
//   L*      CIE 1976 lightness, 0-100: each channel decoded with the sRGB transfer function (a 256-entry
//           table), Y = the D65 sRGB matrix's middle row, L* = 116 f(Y) - 16 [handle: IEC 61966-2-1 as
//           given at https://en.wikipedia.org/wiki/SRGB and https://en.wikipedia.org/wiki/CIELAB_color_space]
//   L       L* percentiles p2 p5 p20 p50 p80 p95 p98, nearest rank on a 0.1-wide L* histogram
//   zones   the % of pixels in 11 L* zones, 0-3 3-12 12-22 22-33 33-44 44-56 56-68 68-79 79-90 90-97
//           97-100 [stated: Jim's spec, issue #194 first comment, section 2.1], counted on the same histogram
//   cast    shadows (sh, L* 5-35), midtones (mid, 35-70) and highlights (hi, 70-95): mean a* and b*, the
//           chroma C and Lab hue h of that mean, and `wheel`, the hue to set on Lightroom's Color Grading
//           wheel of that range for a tint of that hue (wheel-fit.ts); h and wheel are null under CAST_MIN_CHROMA
//   bands   the % of the chromatic pixels (compute.ts CHROMATIC_MIN) whose HSV hue falls in each of
//           Lightroom's 8 HSL bands (bands.ts)
//   cf      colourfulness M = sigma_rgyb + 0.3 mu_rgyb on the 8-bit values, rg = R - G, yb = (R + G) / 2 - B
//           [handle: Hasler and Suesstrunk 2003, https://www.researchgate.net/publication/243135534_Measuring_colorfulness_in_natural_images]
//   rms     RMS contrast: the population standard deviation of L* / 100
// The tone ranges and the chroma threshold are ours [inference]; their edges are half-open ([5, 35) ...),
// the last closed at 95.

import { bandShares } from "./bands.js";
import { percentile } from "./stats.js";
import { round, type Cast, type Perceptual, type ToneRange } from "./types.js";
import { wheelHue, type Wheel } from "./wheel-fit.js";

export const ZONE_EDGES = [0, 3, 12, 22, 33, 44, 56, 68, 79, 90, 97, 100] as const;
export const TONE_RANGES: Readonly<Record<ToneRange, readonly [number, number]>> = { sh: [5, 35], mid: [35, 70], hi: [70, 95] };
/** Below this chroma a range's cast has no hue worth naming [inference: about one just-noticeable difference]. */
export const CAST_MIN_CHROMA = 1;
const PERCENTILES = [2, 5, 20, 50, 80, 95, 98] as const;
const WHEELS: Record<ToneRange, Wheel> = { sh: "shadows", mid: "midtones", hi: "highlights" };
/** D65 white, Y = 1. */
const WHITE = { x: 0.95047, z: 1.08883 } as const;


/** sRGB 8-bit -> linear 0-1. */
const LINEAR = Float64Array.from({ length: 256 }, (_, v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
const lab = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
/** lab() on a 1/65536 grid of 0-1: off by at most 0.007 in a pixel's L*, 0.03 in its a* and 0.012 in its b* [inference: half a step, times the slope of lab() at its knee (about 7.8), times 116, 500 or 200]. */
const LAB_STEPS = 65536;
const LAB = Float64Array.from({ length: LAB_STEPS + 2 }, (_, i) => lab(i / LAB_STEPS));
const labFast = (t: number): number => LAB[(t * LAB_STEPS + 0.5) | 0] as number;
/** Each channel's share of X / Xn, Y and Z / Zn (the D65 sRGB matrix), by 8-bit level. */
const share = (row: readonly number[], white: number): Float64Array[] => row.map((m) => LINEAR.map((c) => (m * c) / white));
const [XR, XG, XB] = share([0.4124564, 0.3575761, 0.1804375], WHITE.x) as [Float64Array, Float64Array, Float64Array];
const [YR, YG, YB] = share([0.2126729, 0.7151522, 0.072175], 1) as [Float64Array, Float64Array, Float64Array];
const [ZR, ZG, ZB] = share([0.0193339, 0.119192, 0.9503041], WHITE.z) as [Float64Array, Float64Array, Float64Array];
const unlab = (f: number): number => (f > 6 / 29 ? f ** 3 : (116 * f - 16) / (24389 / 27));
const encode = (c: number): number => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** The sRGB values (0-255, unclamped) of an L*a*b* colour. */
export function labToRgb(L: number, a: number, b: number): [number, number, number] {
  const fy = (L + 16) / 116;
  const x = WHITE.x * unlab(fy + a / 500);
  const y = unlab(fy);
  const z = WHITE.z * unlab(fy - b / 200);
  return [
    encode(3.2404542 * x - 1.5371385 * y - 0.4985314 * z),
    encode(-0.969266 * x + 1.8760108 * y + 0.041556 * z),
    encode(0.0556434 * x - 0.2040259 * y + 1.0572252 * z),
  ];
}

type Sums = { n: number; a: number; b: number; L: number };

/** The perceptual set of interleaved 8-bit pixels; `hue` is compute.ts's 360-bin HSV hue histogram of the chromatic pixels. */
export function measurePerceptual(data: Uint8Array, channels: number, hue: Float64Array, chromatic: number): Perceptual {
  const histogram = new Float64Array(1001);
  const [LOW, SH_TOP] = TONE_RANGES.sh;
  const [, MID_TOP] = TONE_RANGES.mid;
  const [, HIGH] = TONE_RANGES.hi;
  // Per tone range (0 sh, 1 mid, 2 hi): pixel count, sum of L*, a*, b*.
  const sums = new Float64Array(12);
  let lSum = 0, lSquares = 0, rg = 0, rg2 = 0, yb = 0, yb2 = 0;
  const n = data.length / channels;
  for (let i = 0; i < data.length; i += channels) {
    const r8 = data[i] as number, g8 = data[i + 1] as number, b8 = data[i + 2] as number;
    const fy = labFast((YR[r8] as number) + (YG[g8] as number) + (YB[b8] as number));
    const L = 116 * fy - 16;
    histogram[(L * 10 + 0.5) | 0]! += 1; // L* is 0-100
    lSum += L;
    lSquares += L * L;
    const d = r8 - g8, e = (r8 + g8) / 2 - b8;
    rg += d; rg2 += d * d; yb += e; yb2 += e * e;
    if (L < LOW || L > HIGH) continue;
    const k = L < SH_TOP ? 0 : L < MID_TOP ? 4 : 8;
    sums[k]! += 1;
    sums[k + 1]! += L;
    sums[k + 2]! += 500 * (labFast((XR[r8] as number) + (XG[g8] as number) + (XB[b8] as number)) - fy);
    sums[k + 3]! += 200 * (fy - labFast((ZR[r8] as number) + (ZG[g8] as number) + (ZB[b8] as number)));
  }
  const lMean = lSum / n;
  const spread = (sum: number, squares: number): number => Math.max(0, squares / n - (sum / n) ** 2);
  const cf = Math.sqrt(spread(rg, rg2) + spread(yb, yb2)) + 0.3 * Math.hypot(rg / n, yb / n);
  const cast = (key: ToneRange, k: number): Cast | null => castOf({ n: sums[k] as number, L: sums[k + 1] as number, a: sums[k + 2] as number, b: sums[k + 3] as number }, WHEELS[key]);
  return {
    L: Object.fromEntries(PERCENTILES.map((p) => [`p${p}`, percentile(histogram, n, p) / 10])) as Perceptual["L"],
    zones: zoneShares(histogram, n),
    cast: { sh: cast("sh", 0), mid: cast("mid", 4), hi: cast("hi", 8) },
    bands: bandShares(hue, chromatic),
    cf: round(cf, 1),
    rms: round(Math.sqrt(Math.max(0, lSquares / n - lMean * lMean)) / 100, 3),
  };
}

/** The % of pixels in each zone; bin i holds L* i / 10, and a zone takes the bins from its lower edge up to (not including) its upper one, the last up to 100. */
function zoneShares(histogram: Float64Array, total: number): number[] {
  const zones = new Array<number>(ZONE_EDGES.length - 1).fill(0);
  let zone = 0;
  for (let i = 0; i < histogram.length; i++) {
    while (zone < zones.length - 1 && i >= (ZONE_EDGES[zone + 1] as number) * 10) zone++;
    zones[zone]! += histogram[i] as number;
  }
  return zones.map((count) => round((count / total) * 100, 1));
}

function castOf(sums: Sums, wheel: Wheel): Cast | null {
  if (sums.n === 0) return null;
  const a = sums.a / sums.n;
  const b = sums.b / sums.n;
  const C = Math.hypot(a, b);
  if (C < CAST_MIN_CHROMA) return { a: round(a, 1), b: round(b, 1), C: round(C, 1), h: null, wheel: null };
  const h = Math.round((((Math.atan2(b, a) * 180) / Math.PI) + 360) % 360) % 360;
  const L = sums.L / sums.n;
  return { a: round(a, 1), b: round(b, 1), C: round(C, 1), h, wheel: wheelHue(wheel, labToRgb(L, a, b), labToRgb(L, 0, 0)) };
}
