// lr_begin_session with the settings page (PHASE5_PLAN row 3), against the simulated Lightroom
// (tests/helpers/session-harness.ts; get_prefs from tests/helpers/lightroom-sim-prefs.ts): the page
// is read first, the session runs on its values in the order settings\session.ts gives, the log and
// the result say where each came from, and a page that cannot be read leaves the defaults and says why.

import { describe, expect, it } from "vitest";
import { client, clean, intent, lr, manager, plugin, readLog, useSessionHarness } from "./helpers/session-harness.js";
import { defaultSimPrefs } from "./helpers/lightroom-sim-prefs.js";

useSessionHarness();

const page = (changes: Record<string, unknown>): void => {
  lr.prefs = { ...defaultSimPrefs(), ...changes };
};
const names = (): string[] => plugin.received.map((r) => r.name).filter((n) => n !== "hello" && n !== "ping");
const sentOf = (name: string) => plugin.received.filter((r) => r.name === name).map((r) => r.payload);

describe("lr_begin_session: the settings page", () => {
  it("reads the page before anything else and runs the session on its values", async () => {
    clean();
    page({ mode: "approve_each_pass", max_passes: 6, long_edge: 1200, quality: 60, clip_high_pct: 2, clip_low_pct: 3, decay: [0.5, 0.25] });
    const out = await manager.begin({ intent_id: "test_plain", return_image: "none" });
    expect(names().slice(0, 2)).toEqual(["get_prefs", "get_context"]);
    expect(out.json).toMatchObject({ pass: "0/6", max_passes: 6, guardrails: { clip_high_pct: 2, clip_low_pct: 3 } });
    expect(out.json["session_settings"]).toMatchObject({
      approval: "approve_each_pass",
      long_edge: 1200,
      quality: 60,
      decay: [0.5, 0.25],
      approval_note: expect.stringContaining("lr_step first waits up to 40 s"),
      from: { approval: "page", max_passes: "page", long_edge: "page", quality: "page", clip_high_pct: "page", clip_low_pct: "page", decay: "page" },
      page: { read: true, note: null, problems: [] },
    });
    expect(sentOf("export_preview").at(-1)).toMatchObject({ long_edge: 1200, quality: 60 });
    const log = readLog();
    expect(log).toMatchObject({ max_passes: 6, guardrails: { clip_high_pct: 2, clip_low_pct: 3 }, decay: [0.5, 0.25] });
    expect(log.settings).toMatchObject({ approval: "approve_each_pass", long_edge: 1200, quality: 60, from: { max_passes: "page" } });
  });

  it("steps with the page's decay (a pass-1 change capped at base maximum x 0.5)", async () => {
    clean();
    page({ decay: [0.5] });
    const begun = await manager.begin({ intent_id: "test_plain", return_image: "none" });
    const before = Number(lr.settings["Texture"] ?? 0);
    await manager.step({ session_id: begun.json["session_id"] as string, settings: { texture: 40 }, rationale: "test", return_image: "none" });
    expect(Number(lr.settings["Texture"]) - before).toBe(20); // texture's base maximum is 40 per pass (session\rules.ts)
  });

  it("takes the arguments over the page", async () => {
    clean();
    page({ max_passes: 6, long_edge: 1200, clip_high_pct: 2, clip_low_pct: 3 });
    const out = await manager.begin({ intent_id: "test_plain", max_passes: 2, long_edge: 800, guardrails: { clip_high_pct: 0.4 }, return_image: "none" });
    expect(out.json).toMatchObject({ pass: "0/2", guardrails: { clip_high_pct: 0.4, clip_low_pct: 3 } });
    expect(out.json["session_settings"]).toMatchObject({ long_edge: 800, from: { max_passes: "argument", long_edge: "argument", clip_high_pct: "argument", clip_low_pct: "page" } });
    expect(sentOf("export_preview").at(-1)).toMatchObject({ long_edge: 800 });
  });

  it("measures every render at measure_long_edge, guardrail re-renders included, and logs it (issue #168)", async () => {
    clean();
    const begun = await manager.begin({ intent_id: "test_plain", measure_long_edge: 2400, return_image: "none" });
    expect(begun.json["session_settings"]).toMatchObject({ long_edge: 1600, measure_long_edge: 2400, from: { long_edge: "page", measure_long_edge: "argument" } });
    const out = await manager.step({ session_id: begun.json["session_id"] as string, settings: { exposure: 1 }, rationale: "much brighter", return_image: "none" });
    expect((out.json["guardrail_actions"] as unknown[]).length).toBeGreaterThan(0); // the guardrail rendered again
    expect(sentOf("export_preview").map((p) => p["long_edge"])).toEqual(sentOf("export_preview").map(() => 2400));
    expect(out.json).toMatchObject({ width: 1600, measured_long_edge: 2400 });
    expect(readLog().settings).toMatchObject({ measure_long_edge: 2400, from: { measure_long_edge: "argument" } });
  });

  it("leaves measure_long_edge off by default", async () => {
    clean();
    const off = await manager.begin({ intent_id: "test_plain", return_image: "none" });
    expect(off.json["session_settings"]).toMatchObject({ measure_long_edge: null, from: { measure_long_edge: "default" } });
    expect(off.json).not.toHaveProperty("measured_long_edge");
  });

  it("raises a measure_long_edge below long_edge to it", async () => {
    clean();
    const low = await manager.begin({ intent_id: "test_plain", long_edge: 1200, measure_long_edge: 1000, return_image: "none" });
    expect(low.json["session_settings"]).toMatchObject({ long_edge: 1200, measure_long_edge: 1200 });
    expect(sentOf("export_preview").at(-1)).toMatchObject({ long_edge: 1200 });
  });

  it("takes an intent's clip limit over the page's (decision 1A)", async () => {
    clean();
    intent("test_guard", { guardrail_overrides: { clip_low_pct: 5 } });
    page({ clip_high_pct: 2, clip_low_pct: 3 });
    const out = await manager.begin({ intent_id: "test_guard", return_image: "none" });
    expect(out.json).toMatchObject({ guardrails: { clip_high_pct: 2, clip_low_pct: 5 } });
    expect(out.json["session_settings"]).toMatchObject({ from: { clip_high_pct: "page", clip_low_pct: "intent" } });
  });

  it("makes the page's number of copies in Variants mode", async () => {
    clean();
    page({ variant_count: 2 });
    const out = await manager.begin({ intent_id: "test_variants", mode: "variants", return_image: "none" });
    expect(sentOf("create_virtual_copies")).toEqual([{ target_uuid: "SIM-UUID", names: ["AVG test_variants A", "AVG test_variants B"] }]);
    expect(out.json["session_settings"]).toMatchObject({ from: { variant_count: "page" } });
    expect(readLog().variant_count).toBe(2);
  });

  it("does not use a value the plugin replaced by its default, and lists it", async () => {
    clean();
    page({ max_passes: 4, invalid: [{ key: "maxPasses", value: "20", reason: "outside 1-16" }] });
    const out = await manager.begin({ intent_id: "test_plain", return_image: "none" });
    expect(out.json["session_settings"]).toMatchObject({ from: { max_passes: "default" }, page: { read: true, problems: ["maxPasses = 20: outside 1-16 (the page's value is not used)"] } });
    expect(readLog().settings?.page.problems).toHaveLength(1);
  });

  it("uses the defaults when get_prefs fails, and says why", async () => {
    clean();
    lr.prefs = null; // the sim answers unknown_command
    const out = await manager.begin({ intent_id: "test_plain", return_image: "none" });
    expect(out.json).toMatchObject({ pass: "0/8", guardrails: { clip_high_pct: 0.5, clip_low_pct: 1 } });
    expect(out.json["session_settings"]).toMatchObject({ from: { max_passes: "default", decay: "default" }, page: { read: false, note: expect.stringContaining("get_prefs failed (unknown_command") } });
  });

  it("does not ask a plugin before 0.5.0, uses the defaults and says why", async () => {
    clean();
    lr.pluginVersion = "0.4.0";
    client.stop();
    client.start();
    await client.waitConnected(2000);
    const out = await manager.begin({ intent_id: "test_plain", return_image: "none" });
    expect(names()).not.toContain("get_prefs");
    expect(out.json["session_settings"]).toMatchObject({ page: { read: false, note: expect.stringContaining("plugin 0.4.0 has no settings page") } });
    expect(readLog().settings?.page.read).toBe(false);
  });
});
