// The pure parts of `npm run phase10:check` (phase10-check-cli.ts, Phase 10 row 13): whether pass 0 wrote a look's
// `set` on another photo as the look holds it (acceptance L-7), and the check's lines and headline.

import type { CanonicalSettings, ParamMap, Pipeline } from "../params/index.js";
import { stepOk, type Step } from "./develop-check.js";

/** Lightroom rounds a slider it takes (Exposure to 0.01, Temperature to whole Kelvin) [inference]: a number counts as reproduced within 1 % of its range. */
const TOLERANCE = 0.01;

/** The look's `set` names whose value on the photo is not the look's, each with both values; empty when every one reproduced. */
export function notReproduced(set: Readonly<Record<string, unknown>>, now: CanonicalSettings, map: ParamMap, pipeline: Pipeline): Array<{ name: string; look: unknown; photo: unknown }> {
  const off: Array<{ name: string; look: unknown; photo: unknown }> = [];
  for (const [name, look] of Object.entries(set)) {
    const photo = now[name];
    const spec = map.spec(name, pipeline);
    const same =
      typeof look === "number" && typeof photo === "number" && spec?.kind === "number"
        ? Math.abs(look - photo) <= TOLERANCE * (spec.max - spec.min)
        : JSON.stringify(look) === JSON.stringify(photo);
    if (!same) off.push({ name, look, photo: photo ?? null });
  }
  return off;
}

/** One YES/NO line per step and per answer; WORKED when every step is as expected and every answer is y. */
export function verdictLines(steps: readonly Step[], answers: readonly string[], asked: number): { lines: string[]; worked: boolean } {
  const lines = steps.map((s) => `${stepOk(s) ? "YES" : "NO "} ${s.step}: ${s.error ?? (s.statuses.join(", ") || "no answer")} (expected ${s.expect.join(" or ")})`);
  for (const [i, a] of answers.entries()) lines.push(`${a === "y" ? "YES" : "NO "} Jim's answer ${i + 1}: ${a}`);
  return { lines, worked: steps.length > 0 && steps.every(stepOk) && answers.length === asked && answers.every((a) => a === "y") };
}
