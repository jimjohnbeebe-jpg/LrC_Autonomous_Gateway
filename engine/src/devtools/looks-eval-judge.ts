// `npm run looks:eval` (Phase 10 row 6): the blind judging and the reveal. Both copies of each photo are rendered by
// uuid through the engine's PreviewService (an LrExportSession export, preview\service.ts), put side by side with
// sharp (preview\composite.ts, labelled L and R; which copy goes left is drawn per pair, independently of the arms),
// saved as pair-NN.jpg in the run folder and opened in Windows' default viewer; Jim answers L, R or T (tie) in this
// window. Each answer is saved at once, so a stopped judging continues with the next pair. Only after the last pair
// are the arms named and counted (looks-eval.ts tally, headlines, mayReveal); after the reveal no pair is judged.

import { writeFileSync } from "node:fs";
import path from "node:path";
import { COMPOSITE_GUTTER, composite } from "../preview/index.js";
import { armOf, armText, fmtP, headlines, pairEdited, pickLeft, tally, winner, type EvalPhoto, type Slot, type Tally } from "./looks-eval.js";
import type { EvalCtx } from "./looks-eval-run.js";

/** Each copy's render: 1600 px, the engine's default preview edge (mcp\tools-shared.ts DEFAULT_LONG_EDGE) [inference: enough to judge on a screen]. */
export const JUDGE_EDGE = 1600;
const QUALITY = 90;

async function pairImage(ctx: EvalCtx, p: EvalPhoto, left: Slot): Promise<{ file: string; column: boolean }> {
  const right: Slot = left === "P" ? "Q" : "P";
  const render = async (slot: Slot): Promise<Buffer> => (await ctx.deps.previews.render({ photoUuid: p.copies[slot] as string, longEdge: JUDGE_EDGE, quality: QUALITY })).jpeg;
  const l = await render(left);
  const r = await render(right);
  // A long edge of two panels side by side: equal panels then always go in a row (composite() picks a column only
  // when it shows them larger, and it never enlarges a panel [handle: preview\composite.ts composite(),
  // engine\tests\preview-composite.test.ts "never enlarges a panel"]).
  const c = await composite([{ image: l, label: "L" }, { image: r, label: "R" }], { longEdge: 2 * JUDGE_EDGE + COMPOSITE_GUTTER, quality: QUALITY });
  const file = path.join(ctx.deps.runDir, `pair-${p.nn}.jpg`);
  writeFileSync(file, c.jpeg);
  return { file, column: c.layout === "column" };
}

/** Every edited, unjudged pair; false when the input ended (the answers so far are saved). */
export async function judgeAll(ctx: EvalCtx): Promise<boolean> {
  const { deps, ev } = ctx;
  if (ev.revealed_at !== null) {
    deps.say(`The arms were revealed at ${ev.revealed_at}: no pair is judged after that, since it would not be blind.`);
    return true;
  }
  const todo = ev.photos.filter((p) => pairEdited(p) && p.judged === null);
  const skipped = ev.photos.filter((p) => !pairEdited(p));
  deps.say("");
  deps.say(`Judging: ${todo.length} pair(s). Each opens in your image viewer; look at it there, then answer here.`);
  if (skipped.length > 0) deps.say(`  Not shown (an edit was not accepted): photo ${skipped.map((p) => p.nn).join(", ")}.`);
  for (const [i, p] of todo.entries()) {
    const left = pickLeft();
    const { file, column } = await pairImage(ctx, p, left);
    deps.open(file);
    const answer = await deps.choose(`Pair ${i + 1} of ${todo.length} (photo ${p.nn}${column ? "; L is the upper one" : ""}): which do you prefer?`);
    if (answer === null) return false;
    p.judged = { at: new Date().toISOString(), left, answer, file: deps.redact(file) };
    ctx.save();
  }
  return true;
}

/** The reveal: the headline lines, then each pair with its arms. */
export function reveal(ctx: EvalCtx): { lines: string[]; tally: Tally } {
  const { ev } = ctx;
  if (ev.revealed_at === null) {
    ev.revealed_at = new Date().toISOString();
    ctx.save();
  }
  const t = tally(ev);
  const lines = [
    ...headlines(ev, t),
    `A = ${armText(ev.arms.A)}; B = ${armText(ev.arms.B)}. A won ${t.a_wins}; exact two-sided sign test, ties dropped: p = ${fmtP(t.p)}.`,
    ...ev.photos.map((p) => {
      const w = winner(p);
      const shown = p.judged ? `left ${p.judged.left} (${armOf(p, p.judged.left)}), answer ${p.judged.answer}` : "not judged";
      return `  ${p.nn} ${p.filename}: P = ${armOf(p, "P")}, Q = ${armOf(p, "Q")}; ${shown}; preferred ${w ?? "-"}`;
    }),
  ];
  for (const l of lines) ctx.deps.say(l);
  return { lines, tally: t };
}
