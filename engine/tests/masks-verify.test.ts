// The pure parts of `npm run masks:verify` (src/devtools/masks-verify.ts, GitHub issue #210): where a render is
// clearly red or green, how a place is told, and the verdict.

import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { colourPoints, verdict, where, type Step } from "../src/devtools/masks-verify.js";

/** A 300 x 200 grey JPEG with a red square at the top left and a green one at the bottom right (or none). */
async function render(colours: boolean): Promise<Buffer> {
  const square = (r: number, g: number, b: number) => sharp({ create: { width: 60, height: 60, channels: 3, background: { r, g, b } } }).png().toBuffer();
  const base = sharp({ create: { width: 300, height: 200, channels: 3, background: { r: 128, g: 120, b: 110 } } });
  const parts = colours ? [{ input: await square(220, 30, 30), left: 20, top: 20 }, { input: await square(30, 200, 40), left: 220, top: 130 }] : [];
  return base.composite(parts).jpeg({ quality: 90 }).toBuffer();
}

const step = (over: Partial<Step>): Step => ({ part: "colour", photo: "a.jpg", id: "x", question: "q", answer: "y", ok: true, notes: [], ...over });

describe("masks:verify", () => {
  it("finds the clearly red and the clearly green area of a render", async () => {
    const at = await colourPoints(await render(true));
    expect(at.red?.x).toBeGreaterThan(0.06);
    expect(at.red?.x).toBeLessThan(0.27);
    expect(at.red?.y).toBeLessThan(0.4);
    expect(at.green?.x).toBeGreaterThan(0.73);
    expect(at.green?.y).toBeGreaterThan(0.65);
  });

  it("finds nothing on a warm grey render", async () => {
    expect(await colourPoints(await render(false))).toEqual({ red: null, green: null });
  });

  it("tells a place in words and per cent", () => {
    expect(where({ x: 0.1, y: 0.9 })).toBe("in the bottom left (about 10 % across, 90 % down)");
  });

  it("works only when every part has a yes and no step is a no", () => {
    const yes = [step({}), step({ part: "person", id: "person_entire" }), step({ part: "mirror", id: "orientation_BA" })];
    expect(verdict(yes, ["colour", "person", "mirror"]).worked).toBe(true);
    expect(verdict([...yes, step({ part: "person", id: "person_teeth", answer: "Lightroom: ErrorReason 1", ok: false, skipped: true })], ["colour", "person", "mirror"]).worked).toBe(true);
    const no = verdict([...yes, step({ answer: "n", ok: false })], ["colour", "person", "mirror"]);
    expect(no.worked).toBe(false);
    expect(no.lines.at(-1)).toMatch(/^NO {3}colour a\.jpg x \(Jim: n\)$/);
    expect(verdict(yes.slice(0, 1), ["colour", "person"]).lines.at(-1)).toBe("---- person: no step answered yes");
  });
});
