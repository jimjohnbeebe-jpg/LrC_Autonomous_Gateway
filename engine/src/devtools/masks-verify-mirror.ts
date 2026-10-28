// `npm run masks:verify`, part 3 (issue #210 item 3): do masks land where asked on a mirrored photo? Jim flips one
// photo (Photo > Flip Horizontal, a menu path [unverified] in Develop) and turns it a quarter turn three times (Photo > Rotate Right,
// Ctrl+], the menu path and shortcut [unverified]), which shows all four mirrored codes
// (BA, DC, CB, AD) [inference: the mirrored codes are closed under a quarter turn]. In each, masks:crop's two
// cases run with the mirrored refusal lifted for this check only (params withMirrorMapping): case A at the
// photo's own crop, case B with its crop turned 10 degrees; radials at three preview points and a gradient,
// rendered and measured with sharp (mask-crop-run.ts), so Jim answers nothing about them. Each case is put
// back from the snapshot taken in that orientation; at the end, or on any earlier stop, Jim undoes the flip and the check reads the
// orientation back.

import { MIRRORED, withMirrorMapping, type SdkSettings } from "../params/index.js";
import { oneCase, runFor, turnCrop, type CaseResult } from "./mask-crop-run.js";
import type { Ctx, Photo, Step } from "./masks-verify.js";

const orientationOf = async (c: Ctx, photo: Photo): Promise<string> => String((await c.client.request("get_settings", { photo_uuid: photo.uuid })).settings["orientation"] ?? "AB");
const isMirrored = (o: string): boolean => (MIRRORED as readonly string[]).includes(o);

/** Cases A and B in the photo's current orientation `o`, each put back from a snapshot taken now. */
async function bothCases(c: Ctx, photo: Photo, o: string): Promise<Step> {
  const run = runFor(c.client, photo.uuid, c.say);
  const cases: Array<CaseResult | { case: string; ok: false; error: string }> = [];
  const notes: string[] = [];
  for (const which of ["A", "B"] as const) {
    const r = await c.guard(photo, async (sdk: SdkSettings) => {
      cases.push(await oneCase(run, which, which === "A" ? sdk : await turnCrop(run, sdk), withMirrorMapping));
    });
    if (r.error) cases.push({ case: which, ok: false, error: r.error });
    if (!r.put_back.ok) notes.push(`case ${which} put back: NO (${r.put_back.why})`);
  }
  const now = await orientationOf(c, photo);
  if (now !== o) notes.push(`orientation read ${now} after the put-back, not ${o}`);
  const ok = cases.length === 2 && cases.every((x) => x.ok) && notes.length === 0;
  return { part: "mirror", photo: photo.filename, id: `orientation_${o}`, question: null, answer: ok ? "every radial and gradient where asked" : "see cases", ok, notes, data: { cases } };
}

/** Jim undoes the flip and the check reads the orientation back; `all`: the four mirrored codes were run (three turns). */
async function flipBack(c: Ctx, photo: Photo, start: string, all: boolean, steps: Step[]): Promise<void> {
  await c.ask(all
    ? "  In Lightroom: Photo > Rotate Right (Ctrl+]) once more, then Photo > Flip Horizontal, to put the photo back as it was. Done?"
    // [inference: undoing the flip leaves a turn of the start, so Rotate Right reaches it]
    : "  In Lightroom: Photo > Flip Horizontal, then Photo > Rotate Right (Ctrl+]) until the photo stands as it did before the check. Done?");
  const end = await orientationOf(c, photo).catch((err: unknown) => `not read (${String(err)})`);
  steps.push({ part: "mirror", photo: photo.filename, id: "orientation_put_back", question: null, answer: `${end} (was ${start})`, ok: end === start, notes: [] });
}

/** Part 3 on one photo that is not mirrored yet; steps go into `steps` as they happen. Once Jim has flipped it, every
 *  way out (a "n", a stop, an error) goes through the flip-back. */
export async function mirrorPart(c: Ctx, photo: Photo, steps: Step[] = []): Promise<Step[]> {
  const fail = (id: string, answer: string): Step[] => {
    steps.push({ part: "mirror", photo: photo.filename, id, question: null, answer, ok: false, notes: [] });
    return steps;
  };
  const start = await orientationOf(c, photo);
  if (isMirrored(start)) return fail("start", `the photo is already mirrored (${start}): select one that is not`);
  if ((await c.ask(`  In Lightroom, with ${photo.filename} selected: Photo > Flip Horizontal. Done?`)) !== "y") return fail("flip", "Jim: n");
  const seen = new Set<string>();
  try {
    for (let i = 0; i < MIRRORED.length; i++) {
      const o = await orientationOf(c, photo);
      if (!isMirrored(o) || seen.has(o)) {
        steps.push({ part: "mirror", photo: photo.filename, id: `turn_${i + 1}`, question: null, answer: `orientation ${o}: ${seen.has(o) ? "seen before" : "not mirrored"}`, ok: false, notes: [] });
        break;
      }
      seen.add(o);
      c.say(`  orientation ${o}: case A (its own crop) and case B (crop turned 10 degrees), measured, nothing to answer.`);
      steps.push(await bothCases(c, photo, o));
      if (i < MIRRORED.length - 1 && (await c.ask("  In Lightroom: Photo > Rotate Right (Ctrl+]). Done?")) !== "y") return fail("rotate", "Jim: n");
    }
  } finally {
    await flipBack(c, photo, start, seen.size === MIRRORED.length, steps);
  }
  return steps;
}
