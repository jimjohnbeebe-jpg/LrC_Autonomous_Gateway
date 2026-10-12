// Masks of several parts in a session (issue #131): lr_edit_mask `combine` and `part` against the Lightroom
// sim (helpers\lightroom-sim-masks.ts, which keeps a written table verbatim except a radial's Flipped). A
// verified form is written as one pass beside the photo's other masks; an unverified one, a part edit
// included, is refused with nothing written until VERIFIED_FORMS lists it (injected here, as stage 2 will
// add the forms `npm run masks:combine` verified); an AI part is computed and waited for wherever it is.

import { afterEach, describe, expect, it } from "vitest";
import { MASK_TABLE_KEY, VERIFIED_FORMS, type Correction } from "../src/params/index.js";
import { captureTable } from "./helpers/lightroom-sim-masks.js";
import { waitUntil } from "./helpers/fake-plugin.js";
import { ID, clean, client, fails, lr, newManager, plugin, readLog, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

const STAGE_1 = ["linear, add radial", "linear, subtract radial", "linear, intersect radial"];
afterEach(() => {
  for (const f of [...VERIFIED_FORMS]) if (!STAGE_1.includes(f)) VERIFIED_FORMS.delete(f);
});

const masks = (): Correction[] => (lr.settings[MASK_TABLE_KEY] ?? []) as Correction[];
const partsOf = (e: Correction | undefined): Array<Record<string, unknown>> => (e?.["CorrectionMasks"] as Array<Record<string, unknown>> | undefined) ?? [];
const pass = { session_id: ID, rationale: "test", return_image: "none" as const };
const BOX = { left: 0.2, top: 0.3, right: 0.7, bottom: 0.9 };
const LINEAR = { kind: "linear", name: "AVG sky", geometry: { zero: { x: 0.5, y: 0.5 }, full: { x: 0.5, y: 0.1 } } };
const RADIAL = { kind: "radial", name: "AVG pool", geometry: BOX };
const OTHER = captureTable[1] as Correction; // a mask of the user's, carried

/** A session on the sim; `version`: the plugin the bridge reconnects to first (its hello is read at connect). */
async function session(version?: string) {
  if (version) {
    lr.pluginVersion = version;
    const drops = client.stats.drops;
    plugin.dropEventClient();
    await waitUntil(() => client.stats.drops === drops + 1);
    await client.waitConnected(2000);
  }
  clean();
  lr.settings[MASK_TABLE_KEY] = [structuredClone(OTHER)];
  const m = newManager({ aiTimings: { computeMs: 300, dcWaitMs: 300, pollMs: 10, pollMaxMs: 20 } });
  await m.begin({ intent_id: "test_plain", return_image: "none", max_passes: 8 });
  const create = async (a: Record<string, unknown>) => String(((await m.createMask({ ...pass, ...a } as Parameters<typeof m.createMask>[0])).json["mask"] as { id: string }).id);
  return { m, create };
}

describe("mask combine in a session (issue #131)", () => {
  it("refuses an AI part on a plugin before 0.21.0, whose guard reads only the first part, with nothing written", async () => {
    const { m, create } = await session("0.20.0");
    VERIFIED_FORMS.add("radial, subtract sky");
    const id = await create(RADIAL);
    const writes = lr.history.length;
    expect(await fails(m.editMask({ ...pass, mask_id: id, combine: { mode: "subtract", kind: "sky" } }))).toMatchObject({ code: "PLUGIN_TOO_OLD" });
    expect(lr.history.length).toBe(writes);
    expect(m.current()?.pass).toBe("1/8");
  });

  it("adds a radial part to a linear mask in a verified form, lists its parts, edits its sliders, and carries the other mask", async () => {
    const { m, create } = await session();
    const id = await create(LINEAR);
    const out = await m.editMask({ ...pass, mask_id: id, combine: { mode: "subtract", kind: "radial", geometry: BOX } });
    expect(out.json).toMatchObject({ pass: "2/8", op: "edit", mask: { id, kind: "mixed", components: 2, parts: [{ kind: "linear" }, { kind: "radial", mode: "subtract", inverted: false, geometry: BOX }] } });
    expect(lr.history.at(-1)).toMatch(/pass 2\/8 mask edit$/);
    expect(partsOf(masks()[1])[1]).toMatchObject({ What: "Mask/CircularGradient", MaskBlendMode: 1, MaskInverted: false, MaskValue: 0, Flipped: true });
    const listed = (await m.listMasks({ session_id: ID })).json["masks"] as Array<{ id: string; parts?: unknown[] }>;
    expect(listed.find((x) => x.id === id)?.parts).toHaveLength(2);
    const slid = await m.editMask({ ...pass, mask_id: id, sliders: { "local.exposure": 2 } });
    expect(slid.json).toMatchObject({ pass: "3/8", mask: { id, sliders: { "local.exposure": 2 }, components: 2 } });
    expect(masks()[0]).toEqual(OTHER);
    expect(masks()).toHaveLength(2);
    expect(readLog().passes.at(-2)?.mask).toMatchObject({ op: "edit", before: { components: 1 }, after: { components: 2, parts: [{ kind: "linear" }, { mode: "subtract" }] } });
  });

  it("refuses an unverified form with nothing written and the pass not used, naming the form", async () => {
    const { m, create } = await session();
    const id = await create(RADIAL);
    const writes = lr.history.length;
    expect(await fails(m.editMask({ ...pass, mask_id: id, combine: { mode: "subtract", kind: "sky" } }))).toMatchObject({
      code: "MASK_OP_NOT_CAPTURED",
      details: { form: "radial, subtract sky" },
      message: expect.stringContaining('"linear, add radial"'),
    });
    expect(lr.history.length).toBe(writes);
    expect(m.current()?.pass).toBe("1/8");
  });

  it("refuses a part edit until the table lists it, then reshapes, re-modes and removes the part", async () => {
    const { m, create } = await session();
    VERIFIED_FORMS.add("radial, subtract radial");
    const id = await create(RADIAL);
    await m.editMask({ ...pass, mask_id: id, combine: { mode: "subtract", kind: "radial", geometry: { left: 0.4, top: 0.4, right: 0.6, bottom: 0.6 } } });
    expect(await fails(m.editMask({ ...pass, mask_id: id, part: 2, geometry: { left: 0.3 } }))).toMatchObject({ code: "MASK_OP_NOT_CAPTURED", details: { form: "radial, subtract radial: reshape part 2" } });
    VERIFIED_FORMS.add("radial, subtract radial: reshape part 2").add("radial, subtract radial: part 2 to add").add("radial, add radial").add("radial, add radial: remove part 2");
    await m.editMask({ ...pass, mask_id: id, part: 2, geometry: { left: 0.3 } });
    expect(partsOf(masks()[1])[1]).toMatchObject({ Left: 0.3, Right: 0.6 });
    await m.editMask({ ...pass, mask_id: id, part: 2, combine: { mode: "add" } });
    expect(partsOf(masks()[1])[1]).toMatchObject({ MaskBlendMode: 0, MaskInverted: false, MaskValue: 1 });
    const out = await m.editMask({ ...pass, mask_id: id, part: 2, remove_part: true });
    expect(out.json).toMatchObject({ pass: "5/8", mask: { id, kind: "radial", components: 1 } });
    expect(masks()[0]).toEqual(OTHER);
  });

  it("computes an added AI part: the update watches every AI part, and the wait reads part 2", async () => {
    const { m, create } = await session("0.21.0"); // Pending.lua watches every AI part (mask-parts.ts AI_PART_PLUGIN)
    VERIFIED_FORMS.add("radial, subtract sky");
    const id = await create(RADIAL);
    const out = await m.editMask({ ...pass, mask_id: id, combine: { mode: "subtract", kind: "sky" } });
    expect(out.json).toMatchObject({ pass: "2/8", ai: { route: "table" }, mask: { id, computed: true, parts: [{ kind: "radial" }, { kind: "sky", mode: "subtract" }] } });
    const update = plugin.received.find((r) => r.name === "update_ai_settings")?.payload as { watch: Record<string, unknown> };
    expect(update.watch).toMatchObject({ ids: [id], what: "What", image: "Mask/Image" });
    expect(partsOf(masks()[1])[1]).toMatchObject({ MaskSubType: 2, MaskDigest: expect.any(String) });
    expect(plugin.received.filter((r) => r.name === "create_ai_mask_dc")).toHaveLength(0);
  });

  it("puts the mask back as it was when Lightroom finds nothing for the AI part (its ErrorReason, read on part 2)", async () => {
    const { m, create } = await session("0.21.0");
    VERIFIED_FORMS.add("radial, subtract sky");
    const id = await create(RADIAL);
    const before = structuredClone(masks()[1]);
    lr.masks.tableRoute = "absent";
    expect(await fails(m.editMask({ ...pass, mask_id: id, combine: { mode: "subtract", kind: "sky" } }))).toMatchObject({ code: "MASK_NOTHING_FOUND", message: expect.stringContaining("put back as it was") });
    expect(masks()[1]).toEqual(before);
    expect(masks()[0]).toEqual(OTHER);
    expect(lr.history.at(-1)).toMatch(/pass 2\/8 mask ai revert$/);
    expect(m.current()?.pass).toBe("1/8");
  });
});
