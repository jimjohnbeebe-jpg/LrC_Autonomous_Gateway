// Spike S14 (devtools\s14-*.ts, `npm run s14:check`): the colour maths on synthetic data and the
// charts read back through gridMeans; then the whole run against the simulated plugin, with the sim's
// NEF, a rendered DSC_0031.JPG and the two charts registered as already imported. The sim's export is
// grey noise and it takes any value, so the run checks the steps and the put-back, not Lightroom.

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeClient } from "../src/bridge/index.js";
import { COLLECTION } from "../src/devtools/s10-config.js";
import { castOf, gridMeans, HUE_CHART, HUE_CHART_SV, hsvToRgb, makeCharts, rgbToHs, WEDGE, wedgeLevel, type Rgb } from "../src/devtools/s14-charts.js";
import { runS14Check } from "../src/devtools/s14-check.js";
import { CHART_COLLECTION, sameValue } from "../src/devtools/s14-config.js";
import { CURVE_VARIANTS } from "../src/devtools/s14-curve.js";
import { fitConvention } from "../src/devtools/s14-grading.js";
import { bandOf } from "../src/devtools/s14-hsl.js";
import { BridgeGate } from "../src/mcp/index.js";
import { loadDefaultParamMap } from "../src/params/index.js";
import { FakePlugin } from "./helpers/fake-plugin.js";
import { LightroomSim } from "./helpers/lightroom-sim.js";

type J = Record<string, unknown>;
let tmp = "";
beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-s14-"));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("S14 colour maths", () => {
  it("reads HSV hue and saturation back from hsvToRgb", () => {
    for (const h of [0, 45, 120, 200, 300]) {
      const { hue, sat } = rgbToHs(hsvToRgb(h, 0.7, 0.9));
      expect(Math.abs(hue - h)).toBeLessThan(1.5);
      expect(sat).toBeCloseTo(0.7, 1);
    }
  });

  it("names a cast's hue: red 0, green 120, blue 240", () => {
    const base: Rgb = [60, 60, 60];
    expect(Math.round(castOf([80, 60, 60], base).hue)).toBe(0);
    expect(Math.round(castOf([60, 80, 60], base).hue)).toBe(120);
    expect(Math.round(castOf([60, 60, 80], base).hue)).toBe(240);
    expect(castOf(base, base).strength).toBe(0);
  });

  it("fits a hue convention in either direction, and refuses weak casts", () => {
    const sets = Array.from({ length: 12 }, (_, i) => i * 30);
    expect(fitConvention(sets.map((s) => ({ set: s, hue: (s + 15) % 360, strength: 0.1 })))).toMatchObject({ direction: 1, offset_deg: 15, rms_deg: 0 });
    expect(fitConvention(sets.map((s) => ({ set: s, hue: (560 - s) % 360, strength: 0.1 })))).toMatchObject({ direction: -1, offset_deg: 200 });
    expect(fitConvention(sets.map((s) => ({ set: s, hue: s, strength: 0.001 })))).toBeNull();
  });

  it("finds a band's centre and width from the saturation lost", () => {
    const base = Array.from({ length: 360 }, (_, h) => hsvToRgb(h, 0.7, 0.9));
    const after = base.map((_, h) => {
      const d = Math.abs(((h - 120 + 540) % 360) - 180);
      return hsvToRgb(h, 0.7 * Math.min(1, d / 20), 0.9); // full loss at 120, none beyond 20 degrees
    });
    const band = bandOf(base, after);
    expect(band?.["centre_deg"]).toBe(120);
    expect(Number(band?.["fwhm_deg"])).toBeGreaterThanOrEqual(17); // 20 degrees, less 8-bit rounding at the ends
    expect(Number(band?.["fwhm_deg"])).toBeLessThanOrEqual(23);
    expect(bandOf(base, base)).toBeNull();
  });

  it("compares curves point by point", () => {
    expect(sameValue([0, 0, 255, 255], [0, 0, 255, 255])).toBe(true);
    expect(sameValue([0, 0, 128, 160, 255, 255], [0, 0, 255, 255])).toBe(false);
    expect(sameValue("Custom", "Linear")).toBe(false);
  });

  it("makes both charts, and gridMeans reads their levels and hues back", async () => {
    const files = await makeCharts(tmp);
    const wedge = await gridMeans(readFileSync(files.wedge), WEDGE.cols, WEDGE.rows);
    wedge.forEach((c, i) => expect(Math.abs(c[0] - wedgeLevel(i))).toBeLessThanOrEqual(1));
    const hue = await gridMeans(readFileSync(files.hue), HUE_CHART.cols, HUE_CHART.rows);
    expect(hue).toHaveLength(360);
    for (const h of [0, 90, 181, 359]) {
      const hs = rgbToHs(hue[h] as Rgb);
      expect(Math.abs(((hs.hue - h + 540) % 360) - 180)).toBeLessThan(1.5);
      expect(hs.sat).toBeCloseTo(HUE_CHART_SV.s, 1);
    }
  });
});

describe("S14 check (simulated plugin)", () => {
  const rendered = JSON.parse(readFileSync(new URL("./fixtures/s10-rendered-dsc0031.json", import.meta.url), "utf8")) as { settings: Record<string, unknown> };
  const MIXER = { GrayMixerRed: -8, GrayMixerYellow: -6 };
  let plugin: FakePlugin;
  let lr: LightroomSim;
  let client: BridgeClient;
  const said: string[] = [];

  beforeEach(async () => {
    mkdirSync(path.join(tmp, "previews"));
    plugin = await FakePlugin.start();
    lr = new LightroomSim(path.join(tmp, "previews"));
    const add = (uuid: string, local_id: number, filename: string) =>
      lr.library.photos.push({ uuid, local_id, filename, rating: 0, keywords: [], day: "2026-10-25", gps: null, file_format: filename.endsWith(".png") ? "PNG" : "JPG", settings: structuredClone(rendered.settings) });
    add("SIM-JPG", 4, "DSC_0031.JPG");
    add("SIM-WEDGE", 5, "S14-grey-wedge.png");
    add("SIM-HUE", 6, "S14-hue-chart.png");
    lr.files.byPath.set(path.join(tmp, "charts", "S14-grey-wedge.png"), "SIM-WEDGE");
    lr.files.byPath.set(path.join(tmp, "charts", "S14-hue-chart.png"), "SIM-HUE");
    lr.library.collections.push({ local_id: 503, name: COLLECTION, smart: false, photos: [lr.uuid, "SIM-JPG"] });
    lr.exportLongEdge = 240; // small renders: the run makes about 70
    lr.install(plugin);
    // Lightroom adds the GrayMixer keys with ConvertToGrayscale true, and not for the raw Adobe Monochrome pair alone
    // (S10; Jim's first S14 run); the sim does neither, so this does.
    const apply = plugin.handlers.get("apply_settings")!;
    plugin.handlers.set("apply_settings", (p, id) => {
      const s = p["settings"] as J;
      if (s["ConvertToGrayscale"] === true) Object.assign(lr.settingsOf(String(p["photo_uuid"])), MIXER);
      return apply(p, id);
    });
    said.length = 0;
  });

  afterEach(async () => {
    client?.stop();
    await plugin.close();
  });

  const run = () => {
    client = new BridgeClient({ commandPort: plugin.commandPort, eventPort: plugin.eventPort, connectGapMs: 5, reconnectMs: 30, readToken: () => plugin.token });
    const gate = new BridgeGate(client, async () => ({ ok: true, lock: { port: 8767, release: async () => {} } }), { waitMs: 2000 });
    return runS14Check({ client, gate, map: loadDefaultParamMap(), ask: async () => "y", say: (l) => said.push(l), stamp: "2026-10-25T10-00-00-000Z", dumpDir: path.join(tmp, "census"), recorderDir: tmp, previewDir: path.join(tmp, "previews"), connectTimeoutMs: 2000, settleMs: 0 }, path.join(tmp, "charts"));
  };

  it("runs every part on the four photos, puts each back and keeps the charts in their collection", async () => {
    const before = ["SIM-JPG", "SIM-WEDGE", "SIM-HUE"].map((u) => structuredClone(lr.library.find(u)?.settings));
    const { worked, results } = await run();
    expect(results["errors"]).toEqual([]);
    expect(worked).toBe(true);
    const photos = results["photos"] as J[];
    expect(photos.map((p) => p["filename"])).toEqual(["20260907-_OZ80093.NEF", "DSC_0031.JPG", "S14-grey-wedge.png", "S14-hue-chart.png"]);
    expect(photos.every((p) => (p["put_back"] as J)["ok"] === true)).toBe(true);
    expect(((photos[0]?.["curve"] as J)["variants"] as J[]).map((v) => v["taken"])).toEqual(CURVE_VARIANTS.map(() => true));
    expect((photos[1]?.["mixer"] as J)["mixer_keys"]).toEqual(Object.keys(MIXER).sort());
    expect(photos.slice(0, 2).map((p) => ((p["mixer"] as J)["steps"] as J[]).length)).toEqual([1, 1]); // the raw pair carries ConvertToGrayscale since Phase 10 row 2
    expect(((photos[2]?.["grading"] as J)["wheels"] as J[]).map((w) => w["wheel"])).toEqual(["shadows", "midtones", "highlights"]);
    expect(((photos[3]?.["hsl"] as J)["bands"] as J[])).toHaveLength(8);
    expect((results["questions"] as J[]).map((q) => q["id"])).toEqual(["grading"]); // the sim's renders never change, so no curve question
    expect(["SIM-JPG", "SIM-WEDGE", "SIM-HUE"].map((u) => lr.library.find(u)?.settings)).toEqual(before);
    expect(lr.library.collections.find((c) => c.name === CHART_COLLECTION)?.photos).toEqual(["SIM-WEDGE", "SIM-HUE"]);
    expect(lr.library.collections.find((c) => c.name === COLLECTION)?.photos).toEqual([lr.uuid, "SIM-JPG"]); // in "fixtures" for the run only
    expect(results["charts_out_of_fixtures"]).toBe(true);
    expect(said).toContain("Spike S14: WORKED");
  });

  it("fails, writing nothing, when the fixtures lack the rendered JPEG", async () => {
    lr.library.find("SIM-JPG")!.filename = "OTHER.JPG";
    const { worked, results } = await run();
    expect(worked).toBe(false);
    expect((results["errors"] as string[]).join(" ")).toContain("DSC_0031.JPG");
    expect(plugin.received.some((r) => r.name === "apply_settings")).toBe(false);
  });
});
