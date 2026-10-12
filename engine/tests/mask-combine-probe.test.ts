// `npm run masks:combine`'s pure parts (src\devtools\mask-combine-probe.ts; issue #131) on made-up tables:
// each candidate built by the engine's own code in the form it names, beside the photo's masks untouched,
// with the allow-list as it was after each build; an AI part found; each form judged by its reads, the AI
// result and Jim's answer; the run's verdict. Nothing here talks to Lightroom.

import { describe, expect, it } from "vitest";
import type { BridgeClient } from "../src/bridge/index.js";
import { CANDIDATES, build, computeAi, hasAi, judge, verdict } from "../src/devtools/mask-combine-probe.js";
import { VERIFIED_FORMS, formOf } from "../src/params/index.js";
import { newCorrection } from "../src/params/mask-ops.js";
import { C, IMAGE, MASK_TABLE_KEY, type Component, type Correction } from "../src/params/mask-table.js";

const theirs = newCorrection("radial", "Jim's", { left: 0.1, top: 0.1, right: 0.3, bottom: 0.3 }, null, {}, []);
const parts = (e: Correction | undefined): Component[] => (e?.[C.masks] as Component[] | undefined) ?? [];
const sdk = (entries: Correction[]) => ({ [MASK_TABLE_KEY]: structuredClone(entries) });

describe("masks:combine candidates", () => {
  it("builds each candidate in the form it names, after the photo's masks, and leaves the allow-list as it was", () => {
    const listed = [...VERIFIED_FORMS];
    expect(CANDIDATES.length).toBeGreaterThanOrEqual(10);
    for (const c of CANDIDATES) {
      const { entries, id } = build([theirs], c);
      expect(entries[0], c.id).toEqual(theirs);
      const mine = entries.find((e) => e[C.id] === id);
      expect(mine?.["LocalExposure2012"], c.id).toBe(0.5); // +2 EV in the panel
      const form = c.forms.at(-1) as string;
      if (!form.includes(":")) expect(formOf(parts(mine)), c.id).toBe(form);
      expect([...VERIFIED_FORMS], c.id).toEqual(listed);
    }
    expect(CANDIDATES.slice(0, 3).map((c) => c.forms[0])).toEqual(["radial, add sky", "radial, subtract sky", "radial, intersect sky"]);
  });

  it("knows which candidates hold an AI part", () => {
    expect(CANDIDATES.filter((c) => { const b = build([], c); return hasAi(b.entries, b.id); }).map((c) => c.id)).toEqual(["radial_add_sky", "radial_subtract_sky", "radial_intersect_sky", "sky_add_radial"]);
  });
});

describe("masks:combine judging", () => {
  const c = CANDIDATES[5]!;
  const { entries, id } = build([theirs], c);
  it("passes a form read back as written twice with Jim's yes, and names what differs otherwise", () => {
    expect(judge(c, entries, id, { read_back: sdk(entries), read_again: sdk(entries) }, undefined, "y")).toMatchObject({ form: "radial, subtract radial", ok: true, problems: [] });
    const changed = structuredClone(entries);
    Object.assign(parts(changed[1])[1] as Component, { MaskBlendMode: 0 });
    const r = judge(c, entries, id, { read_back: sdk(entries), read_again: sdk(changed) }, undefined, "y");
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/read_again: AVG combine radial_subtract_radial: .*reads back different.*MaskBlendMode/);
    expect(judge(c, entries, id, { read_back: sdk(entries), read_again: sdk(entries) }, undefined, "n").ok).toBe(false);
    expect(judge(c, entries, id, { read_back: sdk(entries), read_again: sdk(entries) }, { outcome: "ErrorReason 1", ok: false, ms: 5 }, "not asked").ok).toBe(false);
  });

  it("works only when every candidate was tried and each one passed", () => {
    const yes = judge(c, entries, id, { read_back: sdk(entries), read_again: sdk(entries) }, undefined, "y");
    const no = { ...yes, ok: false, answer: "n" };
    expect(verdict(CANDIDATES.map(() => yes), CANDIDATES.length).worked).toBe(true);
    const v = verdict([yes, no], 2);
    expect(v.worked).toBe(false);
    expect(v.lines[1]).toMatch(/^NO  radial, subtract radial \(Jim: n\)$/);
    expect(v.lines.at(-1)).toMatch(/\(not tried\)$/);
  });
});

describe("masks:combine AI wait", () => {
  it("asks Lightroom with the guard over every AI part, then reads until the part still computing has a result", async () => {
    const { entries, id } = build([], CANDIDATES[1]!);
    const sent: Array<[string, Record<string, unknown>]> = [];
    let reads = 0;
    const client = {
      request: async (name: string, payload: Record<string, unknown>) => {
        sent.push([name, payload]);
        if (name !== "get_settings") return { status: "started" };
        const now = structuredClone(entries);
        if (++reads >= 3) Object.assign(parts(now[0])[1] as Component, { [IMAGE.digest]: "D0" });
        return { settings: sdk(now) };
      },
    } as unknown as BridgeClient;
    expect(await computeAi(client, "U", id, 5000, 1)).toMatchObject({ outcome: "computed", ok: true });
    expect(reads).toBe(3);
    expect(sent[0]?.[1]).toMatchObject({ photo_uuid: "U", watch: { ids: [id], what: "What", image: "Mask/Image" } });
    const never = { request: async (name: string) => (name === "get_settings" ? { settings: sdk(entries) } : {}) } as unknown as BridgeClient;
    expect(await computeAi(never, "U", id, 5, 1)).toMatchObject({ ok: false, outcome: "no result within 0.005 s" });
  });
});
