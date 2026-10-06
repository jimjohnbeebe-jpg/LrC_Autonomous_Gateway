// Slider values and the mini track (Phase 7 row 4c; spec docs\hud\lrc-avg-hud-spec-v2.md 7, Option C
// docs\hud\option-c\NOTES.md section 5 item 11 and section 7 "Mini track"):
//   - values as Lightroom's Basic panel writes them: a true minus sign U+2212, "+" on positive values of
//     signed sliders (a slider whose range starts at 0 or above has no sign; Temp neither), Exposure to
//     two decimals, Temp with a thousands separator; text (profiles, "curve", "on") as given;
//   - the track: the before → after segment and the thumb at `after`, as fractions of the slider's range
//     (hud\ui\render.ts draws them); Temp on a log scale [inference: spec 7; Lightroom's own Temp
//     mapping is [unverified]].
// Pure, so hud\ui\rows.test.ts covers it.

const MINUS = "−";

function digits(name: string, v: number): string {
  if (name === "exposure") return Math.abs(v).toFixed(2);
  if (name === "temperature") return Math.round(Math.abs(v)).toLocaleString("en-US");
  return String(Math.round(Math.abs(v) * 100) / 100);
}

/** A value as the slider shows it; `min` is the slider's lowest value (the row's). */
export function shownValue(name: string, v: number | string | undefined, min?: number): string {
  if (v === undefined) return "";
  if (typeof v !== "number") return v;
  const s = digits(name, v);
  if (v < 0 && s !== digits(name, 0)) return MINUS + s;
  const signed = name !== "temperature" && (min === undefined || min < 0);
  return v > 0 && signed ? `+${s}` : s;
}

/** The signed change for the delta column: "+0.37", "−3", "0". */
export function shownDelta(name: string, d: number): string {
  const s = name === "exposure" ? Math.abs(d).toFixed(2) : String(Math.round(Math.abs(d) * 100) / 100);
  if (Number(s) === 0) return "0";
  return (d < 0 ? MINUS : "+") + s;
}

/** Where v sits on the slider, 0..1; null when the row has no range. */
export function fraction(name: string, v: number, min: number | undefined, max: number | undefined): number | null {
  if (min === undefined || max === undefined || max <= min) return null;
  const c = Math.min(max, Math.max(min, v));
  if (name === "temperature" && min > 0) return Math.log(c / min) / Math.log(max / min);
  return (c - min) / (max - min);
}

export type Track = { from: number; to: number; thumb: number };

/** The segment (at least `minSpan`) and the thumb; an undone pass puts the thumb back at `before`, with no segment. */
export function track(
  row: { name: string; before?: number | string | undefined; after: number | string; min?: number | undefined; max?: number | undefined },
  undone: boolean,
  minSpan = 0.02,
): Track | null {
  if (typeof row.after !== "number" || typeof row.before !== "number") return null;
  const b = fraction(row.name, row.before, row.min, row.max);
  const a = fraction(row.name, row.after, row.min, row.max);
  if (a === null || b === null) return null;
  if (undone) return { from: b, to: b, thumb: b };
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const pad = Math.max(0, minSpan - (hi - lo)) / 2;
  return { from: Math.max(0, lo - pad), to: Math.min(1, hi + pad), thumb: a };
}
