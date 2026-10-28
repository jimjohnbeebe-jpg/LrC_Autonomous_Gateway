// Issue #217 row 3 and the Point Color fix: mask curves and Point Color through LrDevelopController. The names and
// values the engine builds (params\mask-controller.ts), the session pass that sends them (session\mask-controller.ts)
// against a stand-in for the plugin's mask_controller (plugin\LrC-AVG.lrplugin\MaskControl.lua, which keeps the
// values per mask and answers before/after as getValue would), the plugin's thin-adapter shape, and the masks:parity
// controller part's checks. What Lightroom does with them is Jim's `npm run masks:parity` (MASK-CONTROLLER.md).

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HelloResult } from "../src/bridge/index.js";
import { MAIN, RED, curvesHold, swatchHeld } from "../src/devtools/masks-verify-controller.js";
import { CONTROLLER_PARAMS, MASK_TABLE_KEY, curveWrites, curvesOf, precheck, swatchRequest, swatchesOf, type Correction } from "../src/params/index.js";
import type { FakeHandler } from "./helpers/fake-plugin.js";
import { avgPlugin, codeOnly } from "./helpers/lua-code.js";
import { ID, clean, client, fails, lr, newManager, plugin, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();
afterEach(() => vi.restoreAllMocks());

const LIFT = [[0, 0], [128, 150], [255, 255]] as Array<[number, number]>;
const SWATCH = { src_hue: 0.1, src_sat: 0.8, src_lum: 0.4, hue_shift: 0.5 };

describe("params: the controller's names and values", () => {
  it("sends curves as flat pairs under the local_* names and reads them back as pairs", () => {
    expect(curveWrites({ main: LIFT, blue: [[0, 10], [255, 245]] })).toEqual([
      { param: "local_Maincurve", points: [0, 0, 128, 150, 255, 255] },
      { param: "local_Bluecurve", points: [0, 10, 255, 245] },
    ]);
    expect(curvesOf({ local_Maincurve: [0, 0, 128, 150, 255, 255], local_Redcurve: "odd" })).toEqual({ main: LIFT });
    expect(CONTROLLER_PARAMS).toEqual(["local_Maincurve", "local_Redcurve", "local_Greencurve", "local_Bluecurve", "local_PointColors"]);
  });

  it("refuses a curve Lightroom would not take", () => {
    const edit = (main: Array<[number, number]>) => () => precheck({ op: "edit", mask_id: "X", curves: { main } });
    expect(edit([[0, 0]])).toThrow(/2-32 points/);
    expect(edit([[0, 0], [128, 300], [255, 255]])).toThrow(/whole number 0-255/);
    expect(edit([[10, 0], [255, 255]])).toThrow(/starts at input 0/);
    expect(edit([[0, 0], [200, 100], [128, 150], [255, 255]])).toThrow(/rise/);
    expect(() => precheck({ op: "edit", mask_id: "X", curves: {} })).toThrow(/at least one of main/);
    expect(() => precheck({ op: "edit", mask_id: "X", curves: { main: LIFT }, name: "x" })).toThrow(/own lr_edit_mask call/);
  });

  it("sends a swatch in the reference's field names, only the fields given, and reads Lightroom's back", () => {
    expect(swatchRequest({ action: "add", swatch: { ...SWATCH, hue_range: [0, 0.3, 0.6, 1] } })).toEqual({
      param: "local_PointColors",
      action: "add",
      swatch: { SrcHue: 0.1, SrcSat: 0.8, SrcLum: 0.4, HueShift: 0.5, HueRange: { LowerNone: 0, LowerFull: 0.3, UpperFull: 0.6, UpperNone: 1 } },
      max: 8,
    });
    expect(swatchRequest({ action: "delete", index: 2 })).toEqual({ param: "local_PointColors", action: "delete", index: 2, max: 8 });
    expect(swatchesOf({ local_PointColors: [{ SrcHue: 2, SrcSat: 0.5, SrcLum: 0.5, Variance: 0, LumRange: { LowerNone: 0, LowerFull: 0.1, UpperFull: 0.9, UpperNone: 1 } }] })).toEqual([{ src_hue: 2, src_sat: 0.5, src_lum: 0.5, lum_range: [0, 0.1, 0.9, 1] }]);
    expect(swatchesOf({ local_PointColors: {} })).toEqual([]);
  });
});

/** The plugin's mask_controller, per mask: curves and swatches as getValue would read them; `expect` refused as MaskControl.lua does. */
function installController(state: Record<string, Record<string, unknown>> = {}): void {
  plugin.handlers.set("mask_controller", (p) => {
    const id = String(p["mask_id"]);
    const values = (state[id] ??= { local_Maincurve: [0, 0, 255, 255], local_PointColors: [] });
    if (Object.entries((p["expect"] ?? {}) as Record<string, unknown>).some(([k, v]) => JSON.stringify(values[k]) !== JSON.stringify(v))) {
      return { ok: false, error: { code: "write_not_taken", message: "local_Maincurve changed in Lightroom after the pass wrote it; nothing was written", recoverable: false } };
    }
    const read = (p["read"] as string[]).reduce<Record<string, unknown>>((o, k) => ({ ...o, [k]: structuredClone(values[k] ?? null) }), {});
    const written: string[] = [];
    for (const c of (p["curves"] ?? []) as Array<{ param: string; points: number[] }>) {
      if (JSON.stringify(values[c.param]) !== JSON.stringify(c.points)) (values[c.param] = c.points), written.push(c.param);
    }
    const sw = p["swatches"] as { param: string; action: string; swatch?: unknown; list?: unknown[] } | undefined;
    if (sw?.action === "add") (values[sw.param] = [...(values[sw.param] as unknown[]), sw.swatch]), written.push(sw.param);
    if (sw?.action === "set") (values[sw.param] = sw.list), written.push(sw.param);
    const after = (p["read"] as string[]).reduce<Record<string, unknown>>((o, k) => ({ ...o, [k]: structuredClone(values[k] ?? null) }), {});
    return { ok: true, payload: { uuid: p["target_uuid"], mask_id: id, before: read, after, written, settled: true, ms: 5 } };
  });
}

describe("session: lr_edit_mask curves and point_colors", () => {
  const pass = { session_id: ID, rationale: "test", return_image: "none" as const };
  const sent = () => plugin.received.filter((r) => r.name === "mask_controller").map((r) => r.payload);
  let maskId = "";
  beforeEach(async () => {
    const carry = JSON.parse(readFileSync(new URL("../../docs/reports/phase8.5/mask-carry/mask_carry_2026-10-11T22-37-39-161Z.json", import.meta.url), "utf8")) as { table_before: Correction[] };
    const brush = structuredClone(carry.table_before.find((e) => e["CorrectionName"] === "Brush") as Correction);
    maskId = String(brush["CorrectionID"]);
    lr.settings[MASK_TABLE_KEY] = [brush];
    vi.spyOn(client, "hello").mockReturnValue({ ...(client.hello() as HelloResult), plugin_version: "1.7.0" });
    installController();
  });

  it("is one pass that sends the curve to the selected photo's mask, writes no table, and returns what Lightroom holds", async () => {
    const m = newManager();
    await m.begin({ intent_id: "test_plain", return_image: "none", max_passes: 4 });
    const table = structuredClone(lr.settings[MASK_TABLE_KEY]);
    const out = await m.editMask({ ...pass, mask_id: maskId, curves: { main: LIFT } });
    expect(sent()).toEqual([{ target_uuid: lr.uuid, mask_id: maskId, curves: [{ param: "local_Maincurve", points: [0, 0, 128, 150, 255, 255] }], read: CONTROLLER_PARAMS }]);
    expect(out.json).toMatchObject({ pass: "1/4", history_names: [], controller: { curves: { main: LIFT }, point_colors: [], settled: true } });
    expect(lr.settings[MASK_TABLE_KEY]).toEqual(table);
  });

  it("adds a Point Color swatch through the controller, and reads it live in lr_list_masks", async () => {
    const m = newManager();
    await m.begin({ intent_id: "test_plain", return_image: "none", max_passes: 4 });
    const out = await m.editMask({ ...pass, mask_id: maskId, point_colors: { action: "add", swatch: SWATCH } });
    expect(sent()[0]).toMatchObject({ swatches: { param: "local_PointColors", action: "add", swatch: { SrcHue: 0.1, SrcSat: 0.8, SrcLum: 0.4, HueShift: 0.5 }, max: 8 } });
    expect(out.json).toMatchObject({ controller: { point_colors: [SWATCH] } });
    const listed = await m.listMasks({ session_id: ID, live_mask_id: maskId });
    expect(listed.json["live"]).toEqual({ mask_id: maskId, curves: { main: [[0, 0], [255, 255]] }, point_colors: [SWATCH] });
  });

  it("uses no pass when Lightroom already holds the curve, and refuses an older plugin before writing", async () => {
    const m = newManager();
    await m.begin({ intent_id: "test_plain", return_image: "none", max_passes: 4 });
    expect(await fails(m.editMask({ ...pass, mask_id: maskId, curves: { main: [[0, 0], [255, 255]] } }))).toMatchObject({ code: "NO_CHANGE" });
    vi.spyOn(client, "hello").mockReturnValue({ ...(client.hello() as HelloResult), plugin_version: "1.6.0" });
    expect(await fails(m.editMask({ ...pass, mask_id: maskId, curves: { main: LIFT } }))).toMatchObject({ code: "PLUGIN_TOO_OLD" });
    expect(sent()).toHaveLength(1);
  });

  /** The sim renders global settings only: while the mask's main curve is not straight, render 3 EV brighter (it clips); `meanwhile` runs once, at that render. */
  function curveBrightens(state: Record<string, Record<string, unknown>>, meanwhile = (): void => {}): void {
    const real = plugin.handlers.get("export_preview") as FakeHandler;
    let once = true;
    plugin.handlers.set("export_preview", async (q, id) => {
      const curve = state[maskId]?.["local_Maincurve"];
      if (curve === undefined || JSON.stringify(curve) === "[0,0,255,255]") return real(q, id);
      if (once) (once = false), meanwhile();
      const saved = lr.settings["Exposure2012"];
      lr.settings["Exposure2012"] = Number(saved) + 3;
      try {
        return await real(q, id);
      } finally {
        lr.settings["Exposure2012"] = saved;
      }
    });
  }

  it("undoes a curve that clips, telling the plugin what the pass left", async () => {
    const state: Record<string, Record<string, unknown>> = {};
    installController(state);
    clean();
    curveBrightens(state);
    const m = newManager();
    await m.begin({ intent_id: "test_plain", return_image: "none", max_passes: 4 });
    const out = await m.editMask({ ...pass, mask_id: maskId, curves: { main: LIFT } });
    expect(sent()[1]).toMatchObject({ curves: [{ param: "local_Maincurve", points: [0, 0, 255, 255] }], expect: { local_Maincurve: [0, 0, 128, 150, 255, 255] } });
    expect(out.json).toMatchObject({ guardrail_actions: [{ kind: "reverted", limit: "clip_high" }], controller: { curves: { main: [[0, 0], [255, 255]] } } });
  });

  it("leaves a curve changed in Lightroom while the pass rendered, and reports the undo unmet", async () => {
    const state: Record<string, Record<string, unknown>> = {};
    installController(state);
    const mine = [0, 0, 100, 160, 255, 255];
    clean();
    curveBrightens(state, () => void ((state[maskId] as Record<string, unknown>)["local_Maincurve"] = mine));
    const m = newManager();
    await m.begin({ intent_id: "test_plain", return_image: "none", max_passes: 4 });
    const out = await m.editMask({ ...pass, mask_id: maskId, curves: { main: LIFT } });
    expect(out.json).toMatchObject({ guardrail_actions: [{ kind: "unmet", reason: expect.stringMatching(/changed in Lightroom.*the mask change stays/) }] });
    expect(state[maskId]?.["local_Maincurve"]).toEqual(mine);
  });

  it("passes the plugin's refusal on (not in Develop)", async () => {
    plugin.handlers.set("mask_controller", () => ({ ok: false, error: { code: "not_in_develop", message: "press D", recoverable: true } }));
    const m = newManager();
    await m.begin({ intent_id: "test_plain", return_image: "none", max_passes: 4 });
    expect(await fails(m.editMask({ ...pass, mask_id: maskId, curves: { main: LIFT } }))).toMatchObject({ code: "NOT_IN_DEVELOP" });
  });
});

describe("plugin: mask_controller is a thin adapter", () => {
  const lua = (f: string): string => readFileSync(path.join(avgPlugin, f), "utf8");
  it("names no parameter or swatch field: the engine sends them, and only local_* names pass", () => {
    for (const f of ["MaskControl.lua", "MaskSwatches.lua"]) {
      expect(lua(f), f).not.toMatch(/"local_[A-Za-z]+"|Src(Hue|Sat|Lum)|HueRange|MaskGroupBasedCorrections/);
    }
    expect(lua("MaskControl.lua")).toContain('p:match("^local_%w+$")');
  });

  it("refuses outside Develop and checks the photo and its AI masks before it selects the mask", () => {
    const code = codeOnly(lua("MaskControl.lua"));
    const run = code.slice(code.indexOf("function MaskControl.run("));
    const order = ["Needs.check(", "getCurrentModuleName", "Catalog.exclusive(", "Develop.writeTarget(", "withMask("].map((s) => run.indexOf(s));
    expect(order.every((i, n) => i > 0 && (n === 0 || i > (order[n - 1] as number)))).toBe(true);
    expect(code).toMatch(/DevelopSession\.flush\(true\)/);
    // A curve that does not read before is refused before the writes; a put-back happens only on the mask still selected.
    const apply = code.slice(code.indexOf("local function apply("), code.indexOf("function MaskControl.run("));
    const refuse = apply.indexOf('if type(before[c.param]) ~= "" then');
    expect(refuse).toBeGreaterThan(0);
    expect(refuse).toBeLessThan(apply.indexOf("LrTasks.pcall(function()"));
    expect(apply).toMatch(/local onMask = LrTasks\.pcall\(guard\)/);
    // The undo's `expect` is checked before the writes; a swatch change counts as possibly made before its call returns.
    expect(apply.indexOf("payload.expect")).toBeGreaterThan(0);
    expect(apply.indexOf("payload.expect")).toBeLessThan(apply.indexOf("LrTasks.pcall(function()"));
    expect(apply.indexOf("swatched = true")).toBeLessThan(apply.indexOf("MaskSwatches.edit(op, list, guard)"));
    expect(apply).toMatch(/if MaskSwatches\.same\(now, list\) then return end/);
  });

  it("checks the photo and the selected mask (guard) before every write, the put-backs included", () => {
    for (const f of ["MaskControl.lua", "MaskSwatches.lua"]) {
      const lines = codeOnly(lua(f)).split("\n");
      const writes = lines.flatMap((l, i) => (/\bcall\(""|LrDevelopController\.(setValue|addPointColorSwatch|deletePointColorSwatch|updateSelectedPointColorSwatch)\b/.test(l) ? [i] : []));
      expect(writes.length, f).toBeGreaterThan(f === "MaskControl.lua" ? 1 : 5);
      for (const i of writes) expect(lines.slice(Math.max(0, i - 3), i + 1).join("\n"), `${f}:${i + 1}`).toContain("guard()");
    }
  });
});

describe("masks:parity controller part", () => {
  it("counts a curve read back within 1 and a swatch within 0.01, and nothing else", () => {
    expect(curvesHold({ local_Maincurve: [0, 0, 128, 181, 255, 255] }, MAIN)).toBe(true);
    expect(curvesHold({ local_Maincurve: [0, 0, 128, 170, 255, 255] }, MAIN)).toBe(false);
    expect(curvesHold({ local_Maincurve: [0, 0, 255, 255] }, RED)).toBe(false);
    expect(swatchHeld({ local_PointColors: [{ SrcHue: 0.105, SrcSat: 0.8, SrcLum: 0.4, HueShift: 0.5 }] }, SWATCH)).toBe(true);
    expect(swatchHeld({ local_PointColors: [{ SrcHue: 0.1, SrcSat: 0.8, SrcLum: 0.4, HueShift: 0.2 }] }, SWATCH)).toBe(false);
  });
});
