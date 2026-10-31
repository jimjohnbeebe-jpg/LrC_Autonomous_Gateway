// Lightroom's Color Grading wheel hue for a tint seen in a render (Phase 10 row 7), from spike S14's
// sweep: each wheel set to 12 hues 30 degrees apart (saturation fixed) on a generated grey wedge, and the
// sRGB hue of the tint each gave measured as castOf does below [handle: docs\reports\phase10\S14.md
// "b. Grading wheels"; the pairs are run 2's `photos[2].grading.wheels[*].steps[*]` {set_hue, hue} in
// docs\reports\phase10\S14\run2\s14_check_2026-10-25T23-35-11-636Z.json; castOf is
// engine\src\devtools\s14-charts.ts castOf]. The 12 pairs go all the way round the circle, so no hue is
// outside the fit; between two pairs the wheel hue is interpolated linearly, which is [inference]: S14
// measured only the 12 points (fit rms about 12 degrees, misses up to about 20 near green and blue).

export type Wheel = "shadows" | "midtones" | "highlights";

/** The measured hue of set hues 0, 30, ... 330, per wheel. */
const MEASURED: Record<Wheel, readonly number[]> = {
  shadows: [352, 20, 51, 93, 139, 163, 177, 191, 227, 282, 312, 331],
  midtones: [353, 14, 50, 102, 141, 163, 177, 194, 227, 277, 313, 335],
  highlights: [353, 14, 50, 103, 140, 161, 176, 196, 228, 276, 314, 335],
};
const STEP = 360 / 12;

/** The measured hues unwrapped to rise from the first, closed with the first again plus 360. */
const UNWRAPPED: Record<Wheel, number[]> = Object.fromEntries(
  (Object.entries(MEASURED) as Array<[Wheel, readonly number[]]>).map(([wheel, hues]) => {
    const out: number[] = [];
    for (const hue of [...hues, hues[0] as number]) {
      let h = hue;
      while (out.length > 0 && h <= (out[out.length - 1] as number)) h += 360;
      out.push(h);
    }
    return [wheel, out];
  }),
) as Record<Wheel, number[]>;

/** The hue, in degrees, of the shift from `base` to `toned` (sRGB 0-255): S14's castOf. */
export function shiftHue(toned: readonly number[], base: readonly number[]): number {
  const [r, g, b] = toned.map((v, i) => v - (base[i] as number)) as [number, number, number];
  return (((Math.atan2((Math.sqrt(3) / 2) * (g - b), r - (g + b) / 2) * 180) / Math.PI) + 360) % 360;
}

/** The set hue that S14's fit says gives a tint of measured hue `measured`, 0-359. */
export function wheelFromMeasured(wheel: Wheel, measured: number): number {
  const u = UNWRAPPED[wheel];
  const first = u[0] as number;
  let m = measured;
  while (m < first) m += 360;
  while (m >= first + 360) m -= 360;
  let i = 0;
  while (m >= (u[i + 1] as number)) i++;
  const lo = u[i] as number;
  const t = (m - lo) / ((u[i + 1] as number) - lo);
  return Math.round(STEP * (i + t)) % 360;
}

/** The wheel hue for a colour `toned` against the neutral `base` of the same lightness. */
export function wheelHue(wheel: Wheel, toned: readonly number[], base: readonly number[]): number {
  return wheelFromMeasured(wheel, shiftHue(toned, base));
}
