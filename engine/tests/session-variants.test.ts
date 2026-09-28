// Variants mode (src/session/variants.ts, copies.ts, pick.ts, targets.ts; PRD 6.6, AVG-008,
// PHASE4_PLAN row 7) against the simulated Lightroom's copies (tests/helpers/lightroom-sim-catalog.ts):
// the copies with pass 0 and their variant priors, the contact sheet, one refined pass per copy,
// awaiting_pick, the pick, and the end.

import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { SHORT, clean, fails, lr, manager, plugin, readLog, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

const begin = () => manager.begin({ intent_id: "test_variants", mode: "variants" });
const step = (target: "A" | "B" | "C" | "master" | undefined, settings: Record<string, unknown> = { exposure: 0.1 }) =>
  manager.step({ session_id: ID(), ...(target ? { target } : {}), settings, rationale: "test" });
const ID = (): string => readLog().session_id;
const copy = (n: number) => lr.copies.get(`SIM-COPY-${n}`) as { uuid: string; copy_name: string; settings: Record<string, unknown> };
const sent = (name: string) => plugin.received.filter((r) => r.name === name).map((r) => r.payload);

/** Every copy steps once: the round that ends in awaiting_pick. */
async function refineAll(): Promise<Awaited<ReturnType<typeof step>>> {
  await step("A");
  await step("B");
  return step("C");
}

describe("Variants mode: begin", () => {
  it("makes the copies, runs pass 0 on each with the intent's priors plus its variant's, and leaves the master alone", async () => {
    clean();
    const out = await begin();
    expect(sent("create_virtual_copies")).toEqual([{ target_uuid: "SIM-UUID", names: ["AVG test_variants A", "AVG test_variants B", "AVG test_variants C"] }]);
    expect(lr.copies.size).toBe(3);
    // Numbers add up (0.1 + 0.1 for B); a switch takes the variant's value (C's lens.ca_remove 0).
    expect([1, 2, 3].map((n) => [copy(n).settings["Exposure2012"], copy(n).settings["AutoLateralCA"]])).toEqual([
      [0.1, 1],
      [0.2, 1],
      [expect.any(Number), 0],
    ]);
    expect(copy(2).settings["Contrast2012"]).toBe(20);
    expect(lr.settings["Exposure2012"]).toBe(0); // the master
    expect(lr.snapshots.size).toBe(1);
    expect(lr.history.slice(0, 2)).toEqual([`AVG ${SHORT} A pass 0/4`, `AVG ${SHORT} B pass 0/4`]);
    // C's exposure +1.1 clips the highlights: its own baseline corrections.
    expect(lr.history).toContain(`AVG ${SHORT} C pass 0/4 baseline 1`);
    expect(lr.history.some((h) => h.startsWith(`AVG ${SHORT} pass`))).toBe(false);
    const variants = out.json["variants"] as Array<Record<string, unknown>>;
    expect(variants.map((v) => [v["id"], v["label"], v["copy_name"], v["uuid"], v["pass"]])).toEqual([
      ["A", "natural", "AVG test_variants A", "SIM-COPY-1", "0/4"],
      ["B", "dramatic", "AVG test_variants B", "SIM-COPY-2", "0/4"],
      ["C", "bright", "AVG test_variants C", "SIM-COPY-3", "0/4"],
    ]);
    expect((variants[2]?.["guardrail_actions"] as unknown[]).length).toBeGreaterThan(0);
    expect(out.json).toMatchObject({ ok: true, mode: "variants", pass: "0/4", target: { uuid: "SIM-UUID" }, intent_brief: { brief: "The test_variants brief." } });
  });

  it("returns a contact sheet of the copies as the image", async () => {
    clean();
    const out = await begin();
    const sheet = out.json["contact_sheet"] as { width: number; height: number; panels: Array<{ label: string }> };
    expect(sheet.panels.map((p) => p.label)).toEqual(["A natural - pass 0", "B dramatic - pass 0", "C bright - pass 0"]);
    const meta = await sharp(out.image as Buffer).metadata();
    expect([meta.width, meta.height]).toEqual([sheet.width, sheet.height]);
    expect(Math.max(sheet.width, sheet.height)).toBeLessThanOrEqual(1600);
  });

  it("with before_after puts the master before the session first; makes 2 copies when asked", async () => {
    clean();
    const out = await manager.begin({ intent_id: "test_variants", mode: "variants", return_image: "before_after", variant_count: 2 });
    expect((out.json["contact_sheet"] as { panels: Array<{ label: string }> }).panels.map((p) => p.label)).toEqual(["before", "A natural - pass 0", "B dramatic - pass 0"]);
    expect(lr.copies.size).toBe(2);
    expect(readLog().variant_count).toBe(2);
  });

  it("sends no image with return_image none", async () => {
    clean();
    const out = await manager.begin({ intent_id: "test_variants", mode: "variants", return_image: "none" });
    expect(out.image).toBeUndefined();
    expect(out.json["contact_sheet"]).toBeUndefined();
  });

  it("logs the copies and each copy's pass 0 in session log v2", async () => {
    clean();
    await begin();
    const log = readLog();
    expect(log).toMatchObject({ schema: "lrc-avg/session-log/2", mode: "variants", variant_count: 3, picked: null });
    expect(log.variants.map((v) => [v.id, v.uuid, v.copy_name, v.picked])).toEqual([
      ["A", "SIM-COPY-1", "AVG test_variants A", false],
      ["B", "SIM-COPY-2", "AVG test_variants B", false],
      ["C", "SIM-COPY-3", "AVG test_variants C", false],
    ]);
    expect(log.passes.map((p) => [p.target, p.n, p.kind])).toEqual([
      ["A", 0, "pass0"],
      ["B", 0, "pass0"],
      ["C", 0, "pass0"],
    ]);
    expect(log.passes[1]?.requested).toMatchObject({ exposure: 0.2, contrast: 20 });
    expect(log.passes[1]?.rationale).toMatch(/variant B \(dramatic\) priors/);
  });

  it("selects each copy before working on it, with its identity as the plugin checks it", async () => {
    clean();
    await begin();
    expect(sent("select_photo")).toEqual([1, 2, 3].map((n) => ({ uuid: `SIM-COPY-${n}`, expect: { is_virtual_copy: true, master_local_id: 1, copy_name: `AVG test_variants ${"ABC"[n - 1]}` } })));
    lr.selected = "OTHER-UUID"; // a click elsewhere between two calls
    const out = await step("A");
    expect(out.json).toMatchObject({ target: "A", pass: "1/4" });
    expect(lr.selected).toBe("SIM-COPY-1");
  });
});

describe("Variants mode: one refined pass per copy, then the pick", () => {
  it("steps each copy once, refuses a second step before the pick, and ends the round with awaiting_pick and the contact sheet", async () => {
    clean();
    await begin();
    const a = await step("A", { exposure: -0.2 });
    expect(a.json).toMatchObject({ target: "A", pass: "1/4", passes_left: 3 });
    expect(a.json["awaiting_pick"]).toBeUndefined();
    expect(copy(1).settings["Exposure2012"]).toBe(-0.1);
    expect(lr.history).toContain(`AVG ${SHORT} A pass 1/4`);
    expect((await fails(step("A"))).code).toBe("AWAITING_PICK");
    expect((await fails(step(undefined))).code).toBe("INVALID_ARGUMENTS");
    expect((await fails(step("master"))).code).toBe("INVALID_ARGUMENTS");
    await step("B");
    const c = await step("C", { exposure: -0.3 });
    expect(c.json).toMatchObject({ target: "C", awaiting_pick: true, next: expect.stringMatching(/lr_select_variant/) });
    expect((c.json["variants"] as Array<{ id: string; pass: string }>).map((v) => [v.id, v.pass])).toEqual([
      ["A", "1/4"],
      ["B", "1/4"],
      ["C", "1/4"],
    ]);
    const sheet = c.json["contact_sheet"] as { width: number; panels: Array<{ label: string }> };
    expect(sheet.panels.map((p) => p.label)).toEqual(["A natural - pass 1", "B dramatic - pass 1", "C bright - pass 1"]);
    expect((await sharp(c.image as Buffer).metadata()).width).toBe(sheet.width);
    const refused = await fails(step("B"));
    expect(refused).toMatchObject({ code: "AWAITING_PICK", message: expect.stringMatching(/Every copy has had its refined pass/) });
  });

  it("continues on the pick: its pass count carries on, other copies take no more passes, accept keeps the pick's recipe", async () => {
    clean();
    await begin();
    await refineAll();
    const picked = await manager.selectVariant({ session_id: ID(), variant: "B" });
    expect(picked.json).toMatchObject({ picked: { id: "B", uuid: "SIM-COPY-2" }, pass: "1/4", passes_left: 3 });
    expect((picked.json["unpicked"] as Array<{ id: string }>).map((u) => u.id)).toEqual(["A", "C"]);
    expect(picked.image?.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(lr.selected).toBe("SIM-COPY-2");
    expect((await fails(manager.selectVariant({ session_id: ID(), variant: "A" }))).code).toBe("INVALID_ARGUMENTS");

    const next = await step(undefined, { contrast: 10 });
    expect(next.json).toMatchObject({ target: "B", pass: "2/4" });
    expect(lr.history).toContain(`AVG ${SHORT} B pass 2/4`);
    expect(copy(2).settings["Contrast2012"]).toBe(30);
    expect((await fails(step("A"))).code).toBe("INVALID_ARGUMENTS");

    const end = await manager.end({ session_id: ID(), outcome: "accept" });
    expect(end.json).toMatchObject({ outcome: "accept", photo: "B", passes: "2/4" });
    expect((end.json["copies"] as Array<{ id: string; picked: boolean }>).map((c) => [c.id, c.picked])).toEqual([
      ["A", false],
      ["B", true],
      ["C", false],
    ]);
    const recipe = JSON.parse(readFileSync(end.json["recipe_path"] as string, "utf8")) as { source: { uuid: string }; settings: Record<string, unknown> };
    expect(recipe.source.uuid).toBe("SIM-COPY-2");
    expect(recipe.settings["contrast"]).toBe(30);
    const log = readLog();
    expect(log).toMatchObject({ outcome: "accept", picked: "B" });
    expect(log.variants.map((v) => v.picked)).toEqual([false, true, false]);
    expect(log.passes.map((p) => [p.target, p.n])).toEqual([
      ["A", 0],
      ["B", 0],
      ["C", 0],
      ["A", 1],
      ["B", 1],
      ["C", 1],
      ["B", 2],
    ]);
  });

  it("takes a pick before every copy has had its refined pass, and says which had none", async () => {
    clean();
    await begin();
    await step("A");
    const picked = await manager.selectVariant({ session_id: ID(), variant: "C" });
    expect(picked.json).toMatchObject({ picked: { id: "C" }, pass: "0/4", picked_before_refining: ["B", "C"] });
    expect((await step(undefined)).json).toMatchObject({ target: "C", pass: "1/4" });
  });

  it("refuses a copy the session does not have", async () => {
    clean();
    await manager.begin({ intent_id: "test_variants", mode: "variants", variant_count: 2 });
    expect((await fails(manager.selectVariant({ session_id: ID(), variant: "C" }))).code).toBe("INVALID_ARGUMENTS");
    expect((await fails(step("C"))).code).toBe("INVALID_ARGUMENTS");
  });

  it("refuses the pick and the copies in Converge mode", async () => {
    clean();
    await manager.begin({ intent_id: "test_plain" });
    expect((await fails(manager.selectVariant({ session_id: ID(), variant: "A" }))).code).toBe("INVALID_ARGUMENTS");
    expect((await fails(step("A"))).code).toBe("INVALID_ARGUMENTS");
    expect(sent("select_photo")).toEqual([]);
  });
});

describe("Variants mode: the end", () => {
  it("refuses accept before a pick; revert puts the master back and keeps the copies with their edits", async () => {
    clean();
    await begin();
    await step("A");
    const refused = await fails(manager.end({ session_id: ID(), outcome: "accept" }));
    expect(refused.code).toBe("AWAITING_PICK");
    lr.settings["Exposure2012"] = 0.7; // an edit to the master in Lightroom during the session
    const out = await manager.end({ session_id: ID(), outcome: "revert" });
    expect(out.json).toMatchObject({ outcome: "revert", photo: "master", revert: { differing: [] }, copies_note: expect.stringMatching(/stay in the catalog/) });
    expect(lr.settings["Exposure2012"]).toBe(0);
    expect(sent("select_photo").at(-1)).toEqual({ uuid: "SIM-UUID", expect: { is_virtual_copy: false } });
    expect(copy(1).settings["Exposure2012"]).toBe(0.2); // A kept its pass 0 and pass 1
    expect(lr.copies.size).toBe(3);
    expect(readLog()).toMatchObject({ outcome: "revert", picked: null });
  });

  it("names the pick in lr_get_session_log's log, with every pass's photo", async () => {
    clean();
    await begin();
    await manager.selectVariant({ session_id: ID(), variant: "A" });
    const log = manager.getLog({ session_id: ID() }).json["log"] as { picked: string; mode: string };
    expect(log).toMatchObject({ picked: "A", mode: "variants" });
  });
});
