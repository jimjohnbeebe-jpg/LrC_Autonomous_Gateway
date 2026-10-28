// The pure parts of `npm run masks:verify` (src/devtools/masks-verify.ts, GitHub issue #210): where a render is
// clearly red or green, how a place is told, the verdict and the put-back result; part 3's flip-back on a fake bridge.

import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { BridgeClient } from "../src/bridge/index.js";
import { colourPoints, notPutBack, verdict, where, writeTable, type Ctx, type Step } from "../src/devtools/masks-verify.js";
import { mirrorPart, orientationBack } from "../src/devtools/masks-verify-mirror.js";
import { MASK_TABLE_KEY, applyOp } from "../src/params/index.js";

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

  it("counts a failed put-back and an orientation not flipped back as not put back", () => {
    expect(notPutBack([step({}), step({ part: "mirror", id: "orientation_put_back" })])).toBe(false);
    expect(notPutBack([step({ part: "mirror", id: "orientation_put_back", answer: "BA (was AB)", ok: false })])).toBe(true);
    expect(notPutBack([step({ id: "put_back", ok: false })])).toBe(true);
    expect(notPutBack([step({ notes: ["case A put back: NO (x)"] })])).toBe(true);
  });
});

/** A part-3 context: the photo's orientation read back from `orientations` in turn (the last one repeats), Jim's answers from `answers`. */
function fakeCtx(orientations: string[], answers: string[], guard: Ctx["guard"]): { c: Ctx; asked: string[]; owed: unknown[] } {
  const asked: string[] = [];
  const owed: unknown[] = [];
  const client = { request: async () => ({ settings: { orientation: orientations.length > 1 ? orientations.shift() : orientations[0] } }) } as unknown as BridgeClient;
  return { asked, owed, c: { client, say: () => undefined, ask: async (q) => (asked.push(q), answers.shift() ?? "y"), guard, owe: (o) => owed.push(o) } };
}
const photo = { uuid: "u", filename: "m.jpg" };
const noCase: Ctx["guard"] = async () => ({ value: null, put_back: { ok: true, why: "" } });

/** A Lightroom photo that Jim's menu actions turn: Rotate Right steps each side's cycle (run 2: BA, AD, DC, CB), Flip pairs them. */
function turningCtx(start: string): { c: Ctx; asked: string[] } {
  const sides = [["AB", "BC", "CD", "DA"], ["BA", "AD", "DC", "CB"]];
  let o = start;
  const asked: string[] = [];
  const client = { request: async () => ({ settings: { orientation: o } }) } as unknown as BridgeClient;
  const ask = async (q: string) => {
    asked.push(q);
    const side = sides.findIndex((x) => x.includes(o));
    const at = (sides[side] as string[]).indexOf(o);
    if (q.includes("Flip Horizontal")) o = (sides[1 - side] as string[])[at] as string;
    else if (q.includes("Rotate Right")) o = (sides[side] as string[])[(at + 1) % 4] as string;
    return "y";
  };
  return { asked, c: { client, say: () => undefined, ask, guard: noCase } };
}

describe("masks:verify part 3 flip-back", () => {
  it("asks for the flip-back and reads it when Jim stops at a turn; the start is owed from before the flip until it reads so again", async () => {
    const { c, asked, owed } = fakeCtx(["AB", "BA", "BA", "AB"], ["y", "n", "y"], noCase);
    const steps = await mirrorPart(c, photo, [], 0);
    expect(asked.at(-1)).toMatch(/Flip Horizontal, then Photo > Rotate Right/);
    expect(steps.map((x) => x.id)).toEqual(["orientation_BA", "rotate", "orientation_put_back"]);
    expect(steps.at(-1)).toMatchObject({ ok: true, data: { uuid: "u" } });
    expect(owed).toEqual([{ uuid: "u", filename: "m.jpg", start: "AB" }, null]);
  });

  it("flips back when the run stops in a case, asks one more action while it reads mirrored, and an orientation left mirrored counts as not put back and stays owed", async () => {
    const { c, asked, owed } = fakeCtx(["AB", "BA"], ["y", "y", "n"], async () => {
      throw new Error("x.jpg could not be put back");
    });
    const steps: Step[] = [];
    await expect(mirrorPart(c, photo, steps, 0)).rejects.toThrow("could not be put back");
    expect(asked).toHaveLength(3);
    expect(asked.at(-1)).toMatch(/m\.jpg reads BA, not AB as before the check\. .*Photo > Flip Horizontal\. Done\?$/);
    expect(steps.map((x) => [x.id, x.ok])).toEqual([["orientation_put_back", false]]);
    expect(notPutBack(steps)).toBe(true);
    expect(owed.at(-1)).toEqual({ uuid: "u", filename: "m.jpg", start: "AB" });
  });

  it("reaches the start one menu action at a time, from any turn of either side", async () => {
    for (const from of ["DC", "CB", "BC", "AD"]) {
      const { c, asked } = turningCtx(from);
      const back = await orientationBack(c, photo, "AB", null, 0);
      expect(back.ok, from).toBe(true);
      expect(asked.length, from).toBeLessThanOrEqual(4);
    }
    const { c, asked } = turningCtx("AB");
    expect((await orientationBack(c, photo, "AB", null, 0)).ok).toBe(true);
    expect(asked).toEqual([]); // nothing owed: nothing asked
  });

  it("does not count a put-back as the mirror part's yes", () => {
    expect(verdict([step({ part: "mirror", id: "orientation_BA", ok: false, answer: "see cases" }), step({ part: "mirror", id: "orientation_put_back" })], ["mirror"]).lines.at(-1)).toBe("---- mirror: no step answered yes");
  });
});

describe("masks:verify writeTable", () => {
  it("names the fields of a mask that reads back different", async () => {
    const plan = applyOp([], { op: "create", kind: "radial", name: "AVG r", geometry: { left: 0.2, top: 0.2, right: 0.4, bottom: 0.4 } });
    const back = structuredClone(plan.entries).map((e) => ({ ...e, CorrectionActive: false }));
    const client = { request: async () => ({ read_back: { [MASK_TABLE_KEY]: back } }) } as unknown as BridgeClient;
    expect((await writeTable(client, "u", plan.entries, "x")).problems).toEqual(["mask AVG r reads back different: CorrectionActive"]);
  });
});
