// Masks of several parts (issue #131, src\params\mask-combine.ts): a part built as Lightroom stored Jim's
// hand-made Add, Subtract and Intersect [handle: docs\reports\phase8.5\mask-carry\
// mask_carry_2026-10-11T22-37-39-161Z.json `table_before[0..2]`], every other form refused by name until
// VERIFIED_FORMS lists it, the AI part found wherever it is, and per-part summaries.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { VERIFIED_FORMS, aiPart, formOf, listed, modeOf, uncaptured } from "../src/params/mask-combine.js";
import { aiWatch, applyOp, firstComponent, newCorrection, precheck, type MaskOp } from "../src/params/mask-ops.js";
import { summarize } from "../src/params/mask-summary.js";
import { C, IMAGE, LINEAR, M, MaskError, RADIAL, WHAT, type Component, type Correction } from "../src/params/mask-table.js";

const run = JSON.parse(readFileSync(fileURLToPath(new URL("../../docs/reports/phase8.5/mask-carry/mask_carry_2026-10-11T22-37-39-161Z.json", import.meta.url)), "utf8")) as { table_before: Correction[] };
const parts = (e: Correction | undefined): Component[] => (e?.[C.masks] as Component[] | undefined) ?? [];
const HAND_MADE = { add: run.table_before[0], subtract: run.table_before[1], intersect: run.table_before[2] } as Record<string, Correction>;

const fail = (f: () => unknown): { code: string; form?: string | undefined } => {
  try {
    f();
  } catch (err) {
    return { code: (err as MaskError).code, form: ((err as MaskError).details as { form?: string } | undefined)?.form };
  }
  throw new Error("expected a refusal");
};
const LINEAR_G = { zero: { x: 0.5, y: 0.5 }, full: { x: 0.5, y: 0.1 } };
const BOX = { left: 0.2, top: 0.3, right: 0.7, bottom: 0.9 };
const linear = (): Correction => newCorrection("linear", "AVG l", LINEAR_G, null, {}, []);
const radial = (): Correction => newCorrection("radial", "AVG r", BOX, null, {}, []);
const edit = (e: Correction, extra: Omit<Extract<MaskOp, { op: "edit" }>, "op" | "mask_id">) => applyOp([e], { op: "edit", mask_id: String(e[C.id]), ...extra });

// The tests below start from Lightroom's own three forms and add what each needs; the shipped list is tested on its own.
const SHIPPED = [...VERIFIED_FORMS];
beforeEach(() => {
  for (const f of [...VERIFIED_FORMS]) if (!["linear, add radial", "linear, subtract radial", "linear, intersect radial"].includes(f)) VERIFIED_FORMS.delete(f);
});

describe("mask combine: the shipped forms", () => {
  it("lists the masks:combine run's ten forms, sky standing for every AI kind, and nothing else", () => {
    for (const f of SHIPPED) VERIFIED_FORMS.add(f);
    expect(SHIPPED).toHaveLength(14);
    for (const f of ["radial, subtract sky", "radial, intersect landscape_water", "subject, add radial", "radial, subtract radial: remove part 2"]) expect(listed(f), f).toBe(true);
    for (const f of ["radial, add radial", "sky, subtract radial", "linear, subtract sky", "radial, subtract radial, add sky", "radial, subtract radial: part 2 inverted true"]) expect(listed(f), f).toBe(false);
  });

  it("lists what every listed part edit leaves, so the mask stays editable after it (Greptile, PR #143)", () => {
    for (const f of SHIPPED) VERIFIED_FORMS.add(f);
    const two = edit(radial(), { combine: { mode: "subtract", kind: "radial", geometry: { left: 0.4, top: 0.4, right: 0.5, bottom: 0.5 } } }).entries[0] as Correction;
    for (const change of [{ part: 2, geometry: { left: 0.3 } }, { part: 2, combine: { mode: "intersect" } }, { part: 2, remove_part: true as const }]) {
      expect(uncaptured(edit(two, change).entries), JSON.stringify(change)).toBeNull();
    }
  });
});

describe("mask combine: the captured forms", () => {
  it("names Jim's three hand-made masks by their form, and lets the tools write them back", () => {
    for (const [mode, e] of Object.entries(HAND_MADE)) {
      expect(formOf(parts(e))).toBe(`linear, ${mode} radial`);
      expect(modeOf(parts(e)[1] as Component)).toBe(mode);
    }
    expect(uncaptured(Object.values(HAND_MADE))).toBeNull();
  });

  it("builds the radial part with exactly the captured fields, and the captured blend, inversion, value and Flipped of each mode", () => {
    for (const [mode, e] of Object.entries(HAND_MADE)) {
      const [lin, rad] = parts(e) as [Component, Component];
      const first = newCorrection("linear", "AVG l", { zero: { x: Number(lin[LINEAR.zeroX]), y: Number(lin[LINEAR.zeroY]) }, full: { x: 0.5, y: 0 } }, null, {}, []);
      const box = { left: 0.2, top: 0.3, right: 0.7, bottom: 0.9 };
      const built = parts(edit(first, { combine: { mode, kind: "radial", geometry: box } }).entries[0])[1] as Component;
      expect(Object.keys(built).sort(), mode).toEqual(Object.keys(rad).sort());
      for (const k of [M.what, M.blend, M.inverted, M.value, RADIAL.flipped, RADIAL.angle, RADIAL.midpoint, RADIAL.roundness, RADIAL.version]) expect(built[k], `${mode} ${k}`).toEqual(rad[k]);
      expect(built).toMatchObject({ [RADIAL.left]: 0.2, [RADIAL.top]: 0.3, [RADIAL.right]: 0.7, [RADIAL.bottom]: 0.9, [M.name]: "Radial Gradient 1" });
    }
  });

  it("keeps the mask's correction fields and first part, and summarises the parts", () => {
    const e = linear();
    const r = edit(e, { combine: { mode: "subtract", kind: "radial", geometry: BOX }, sliders: { "local.exposure": 2 } });
    const out = r.entries[0] as Correction;
    expect(parts(out)[0]).toEqual(parts(e)[0]);
    expect(r.after).toMatchObject({ kind: "mixed", components: 2, sliders: { "local.exposure": 2 }, parts: [{ kind: "linear", inverted: false, geometry: { zero: LINEAR_G.zero } }, { kind: "radial", mode: "subtract", inverted: false, geometry: { left: 0.2 } }] });
    expect(r.ai).toBeUndefined();
  });
});

describe("mask combine: the gate", () => {
  it("refuses every form VERIFIED_FORMS does not list, naming it", () => {
    const two = edit(linear(), { combine: { mode: "subtract", kind: "radial", geometry: BOX } }).entries[0] as Correction;
    const cases: Array<[Correction, Omit<Extract<MaskOp, { op: "edit" }>, "op" | "mask_id">, string]> = [
      [radial(), { combine: { mode: "subtract", kind: "radial", geometry: BOX } }, "radial, subtract radial"],
      [radial(), { combine: { mode: "subtract", kind: "sky" } }, "radial, subtract sky"],
      [linear(), { combine: { mode: "intersect", kind: "luminance", geometry: { lum_range: [0, 0.2, 0.8, 1] } } }, "linear, intersect luminance"],
      [newCorrection("sky", "s", {}, null, {}, []), { combine: { mode: "add", kind: "radial", geometry: BOX } }, "sky, add radial"],
      [two, { combine: { mode: "add", kind: "radial", geometry: BOX } }, "linear, subtract radial, add radial"],
      [two, { part: 2, geometry: { left: 0.1 } }, "linear, subtract radial: reshape part 2"],
      [two, { part: 2, inverted: true }, "linear, subtract radial: part 2 inverted true"],
      [two, { part: 2, combine: { mode: "add" } }, "linear, subtract radial: part 2 to add"],
      [two, { part: 2, remove_part: true }, "linear, subtract radial: remove part 2"],
    ];
    for (const [e, extra, form] of cases) expect(fail(() => edit(e, extra)), form).toEqual({ code: "MASK_OP_NOT_CAPTURED", form });
  });

  it("refuses a part's arguments that make no sense before reading the table", () => {
    const op = (extra: Record<string, unknown>) => () => precheck({ op: "edit", mask_id: "X", ...extra } as MaskOp);
    for (const extra of [
      { combine: { mode: "add" } }, // no kind, no part
      { combine: { mode: "blend", kind: "radial", geometry: BOX } },
      { combine: { mode: "add", kind: "person_entire" } },
      { combine: { mode: "add", kind: "sky", geometry: BOX } },
      { combine: { mode: "add", kind: "radial" } }, // no geometry
      { part: 2, combine: { mode: "add", kind: "radial" } },
      { part: 1, combine: { mode: "add" } },
      { part: 1, remove_part: true },
      { part: 2 },
      { part: 2, inverted: true, geometry: BOX },
      { part: 0, inverted: true },
      { remove_part: true },
      { inverted: true, combine: { mode: "add", kind: "radial", geometry: BOX } }, // combine with a whole-mask change
      { geometry: BOX, combine: { mode: "add", kind: "radial", geometry: BOX } },
    ]) expect(fail(op(extra)).code, JSON.stringify(extra)).toBe("INVALID_ARGUMENTS");
    expect(fail(op({ combine: { mode: "add", kind: "objects" } })).code).toBe("MASK_KIND_NOT_SUPPORTED");
    for (const kind of ["brush", "color_range", "depth_range"]) expect(fail(op({ combine: { mode: "add", kind } })).code).toBe("INVALID_ARGUMENTS");
  });

  it("writes a part edit once the table lists it (stage 2), and treats part 1 of a one-part mask as the mask", () => {
    const two = edit(linear(), { combine: { mode: "subtract", kind: "radial", geometry: BOX } }).entries[0] as Correction;
    VERIFIED_FORMS.add("linear, subtract radial: reshape part 2").add("linear, subtract radial: part 2 to intersect").add("linear, subtract radial: remove part 2");
    expect(parts(edit(two, { part: 2, geometry: { left: 0.1 } }).entries[0])[1]).toMatchObject({ [RADIAL.left]: 0.1, [RADIAL.right]: 0.7 });
    expect(parts(edit(two, { part: 2, combine: { mode: "intersect" } }).entries[0])[1]).toMatchObject({ [M.blend]: 1, [M.inverted]: true, [M.value]: 0, [RADIAL.flipped]: false });
    expect(parts(edit(two, { part: 2, remove_part: true }).entries[0])).toEqual([parts(two)[0]]);
    expect(fail(() => edit(two, { part: 3, geometry: BOX })).code).toBe("INVALID_ARGUMENTS");
    expect(parts(edit(radial(), { part: 1, geometry: { left: 0.1 } }).entries[0])[0]).toMatchObject({ [RADIAL.left]: 0.1 });
    expect(fail(() => edit(two, { inverted: true })).code).toBe("MASK_OP_NOT_CAPTURED"); // a whole mask of several parts: name the part
  });

  it("returns the AI kind of an added AI part for Lightroom to compute, in Adobe's form with the mode's fields", () => {
    VERIFIED_FORMS.add("radial, subtract sky");
    const r = edit(radial(), { combine: { mode: "subtract", kind: "sky" } });
    expect(r.ai).toBe("sky");
    expect(parts(r.entries[0])[1]).toMatchObject({ [M.what]: WHAT.image, [IMAGE.subType]: 2, [IMAGE.referencePoint]: "0.500000 0.500000", [IMAGE.errorReason]: 0, [M.blend]: 1, [M.inverted]: false, [M.value]: 0 });
  });
});

describe("mask combine: the AI part and the table check", () => {
  const sky = (digest?: string, error?: number): Component => ({ [M.what]: WHAT.image, [IMAGE.subType]: 2, ...(digest ? { [IMAGE.digest]: digest } : {}), ...(error !== undefined ? { [IMAGE.errorReason]: error } : {}) });
  it("reads the AI part wherever it is: the one still computing, else one with an ErrorReason, else the first AI part", () => {
    const rad = parts(radial())[0] as Component;
    expect(aiPart([rad, sky()])).toEqual(sky());
    expect(aiPart([sky("D1"), sky(undefined, 0)])).toEqual(sky(undefined, 0));
    expect(aiPart([rad, sky("D1"), sky(undefined, 1)])).toEqual(sky(undefined, 1));
    expect(aiPart([rad, sky("D1")])).toEqual(sky("D1"));
    expect(aiPart([rad])).toBe(rad);
    const e = { ...radial(), [C.masks]: [rad, sky()] } as Correction;
    expect(firstComponent([e], String(e[C.id]))).toEqual(sky());
    expect(aiWatch(["X"])).toMatchObject({ what: M.what, image: WHAT.image });
  });

  it("refuses to write back an unlisted form or a part it does not know, and shows an unknown mode as other", () => {
    const odd = structuredClone(HAND_MADE["add"]) as Correction;
    Object.assign(parts(odd)[1] as Component, { [M.value]: 0.5 });
    expect(uncaptured([odd])?.why).toBe('its 2 components ("linear, MaskBlendMode 0 MaskInverted false MaskValue 0.5 radial") are not a form verified in Lightroom');
    expect(summarize(odd).parts?.[1]?.mode).toBe("other");
    const brush = structuredClone(HAND_MADE["add"]) as Correction;
    Object.assign(parts(brush)[1] as Component, { [M.what]: "Mask/Paint" });
    expect(uncaptured([brush])?.why).toBe("its kind (Mask/Paint) was not round-tripped in the masks captures");
  });
});
