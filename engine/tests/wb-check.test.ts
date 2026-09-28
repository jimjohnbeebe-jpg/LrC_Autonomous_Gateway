// The white balance check (devtools\wb-check.ts, `npm run wb:check`) against the simulated plugin
// (helpers\lightroom-sim.ts). The sim keeps WhiteBalance as it is when Temperature is written alone,
// as Lightroom did in the Phase 4 check [handle: docs\reports\phase4\P4\p4_check_2026-09-28T04-18-17-511Z.json
// preset.source_prepared.white_balance_after], and takes "Custom" when it is written, unless
// WhiteBalance is in `ignored` (Lightroom refusing it).

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeClient } from "../src/bridge/index.js";
import type { Answer } from "../src/devtools/phase1-check.js";
import { PHOTO } from "../src/devtools/phase4-config.js";
import { HISTORY, runWbCheck, shifted, snapshotName } from "../src/devtools/wb-check.js";
import { BridgeGate } from "../src/mcp/index.js";
import { loadDefaultParamMap } from "../src/params/index.js";
import { FakePlugin } from "./helpers/fake-plugin.js";
import { LightroomSim, nefDump } from "./helpers/lightroom-sim.js";

const map = loadDefaultParamMap();
let tmp = "";
let plugin: FakePlugin;
let lr: LightroomSim;
let client: BridgeClient;
const said: string[] = [];
const prompts: string[] = [];

beforeEach(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-wbcheck-"));
  mkdirSync(path.join(tmp, "previews"));
  plugin = await FakePlugin.start();
  lr = new LightroomSim(path.join(tmp, "previews"));
  lr.filename = PHOTO;
  lr.install(plugin);
  said.length = 0;
  prompts.length = 0;
});

afterEach(async () => {
  client?.stop();
  await plugin.close();
  rmSync(tmp, { recursive: true, force: true });
});

/** Jim from the prompts' words: Enter after a click; a drag of the Temp slider moves it and sets "Custom", as Lightroom's panel does [inference]. */
async function jim(text: string): Promise<string | null> {
  prompts.push(text);
  if (/drag the Temp slider/.test(text)) Object.assign(lr.settings, { WhiteBalance: "Custom", Temperature: Number(lr.settings["Temperature"]) + 50 });
  return "";
}

function run(answers: Answer[], options: { busy?: boolean } = {}) {
  const queue = [...answers];
  client = new BridgeClient({ commandPort: plugin.commandPort, eventPort: plugin.eventPort, connectGapMs: 5, reconnectMs: 30, readToken: () => plugin.token });
  const gate = new BridgeGate(client, async () => (options.busy ? { ok: false, port: 8767, pid: 4242 } : { ok: true, lock: { port: 8767, release: async () => {} } }), { waitMs: 2000 });
  return runWbCheck({ client, gate, map, ask: async () => queue.shift() ?? "no answer", prompt: jim, say: (l) => said.push(l), stamp: "2026-09-28T12-00-00-000Z", connectTimeoutMs: 2000 });
}

type J = Record<string, unknown>;
const applied = (): J[] => plugin.received.filter((r) => r.name === "apply_settings").map((r) => r.payload);

describe("npm run wb:check", () => {
  it("records Lightroom taking Custom with a temperature and a tint, then puts the photo back", async () => {
    const { worked, results } = await run(["y", "y", "y"]);
    expect(worked).toBe(true);
    expect(results["summary"]).toEqual({
      suggestion: "WORKED",
      white_balance_after_temperature_alone: "As Shot",
      custom_taken_with_temperature: true,
      custom_taken_with_tint: true,
      preset_carries_temperature_after_custom: true,
      put_back: true,
    });
    expect(lr.history).toEqual([HISTORY.temperature, HISTORY.custom, HISTORY.tint]);
    // Every write by uuid (the selection untouched); step 1 writes Temperature alone.
    expect(applied().every((p) => p["photo_uuid"] === lr.uuid && p["target_uuid"] === undefined)).toBe(true);
    expect(applied().map((p) => Object.keys(p["settings"] as J).sort())).toEqual([["Temperature"], ["Temperature", "WhiteBalance"], ["Tint", "WhiteBalance"]]);
    expect(results["temperature_alone"]).toMatchObject({ written: { Temperature: 5800 }, white_balance: "As Shot", temperature_taken: true, jim: { panel_as_shot: true, panel_custom: null, temp_slider_moved: true } });
    expect(results["temperature_custom"]).toMatchObject({ written: { Temperature: 6100, WhiteBalance: "Custom" }, custom_taken: true, temperature_taken: true, mismatches: [], jim: { panel_custom: true } });
    expect(results["temperature_custom"]).not.toHaveProperty("by_hand");
    expect(results["tint_custom"]).toMatchObject({ reset_to_as_shot: true, written: { Tint: 11, WhiteBalance: "Custom" }, custom_taken: true, tint_taken: true, temperature_kept: true });
    expect(results["preset"]).toMatchObject({ after_temperature_alone: { temperature_carried: false }, after_custom: { temperature_carried: true, tint_carried: true, also_written: { WhiteBalance: "Custom" } } });
    expect(results["snapshot"]).toMatchObject({ name: snapshotName("2026-09-28T12-00-00-000Z") });
    expect(lr.settings).toEqual(nefDump.settings);
    expect(said).toContain("  PUT BACK: YES");
  });

  it("records Lightroom refusing Custom, reads the value Jim's slider sets, and still puts the photo back", async () => {
    lr.ignored.add("WhiteBalance");
    const { worked, results } = await run(["y", "y", "n"]);
    expect(worked).toBe(true); // the check ran; the answer is NO
    expect(results["summary"]).toMatchObject({ custom_taken_with_temperature: false, custom_taken_with_tint: false, preset_carries_temperature_after_custom: false, put_back: true });
    expect(results["temperature_custom"]).toMatchObject({ custom_taken: false, temperature_taken: true, mismatches: [{ sdk_key: "WhiteBalance", written: "Custom", read_back: "As Shot" }], by_hand: { read: true, white_balance: "Custom" } });
    expect(prompts.some((p) => p.includes("drag the Temp slider"))).toBe(true);
    expect(lr.settings).toEqual(nefDump.settings);
    expect(said).toContain('  Lightroom took "Custom" with a temperature: NO; with a tint: NO; a preset then carries the temperature: NO');
  });

  it("asks whether the panel reads Custom when Jim says it does not read As Shot", async () => {
    const { results } = await run(["n", "y", "y", "y"]);
    expect(results["temperature_alone"]).toMatchObject({ jim: { panel_as_shot: false, panel_custom: true, temp_slider_moved: true } });
  });

  it("writes nothing when the photo's white balance is not As Shot", async () => {
    lr.settings["WhiteBalance"] = "Custom";
    const { worked, results } = await run([]);
    expect(worked).toBe(false);
    expect(results["errors"]).toEqual([expect.stringContaining('white balance is "Custom", not "As Shot"')]);
    expect(plugin.received.filter((r) => r.name === "apply_settings" || r.name === "create_snapshot")).toEqual([]);
    expect(results).not.toHaveProperty("put_back");
  });

  it("writes nothing when another photo stays selected", async () => {
    lr.filename = "20260907-_OZ80093.NEF";
    const { worked, results } = await run([]);
    expect(worked).toBe(false);
    expect(prompts).toHaveLength(3);
    expect(results["errors"]).toEqual([`${PHOTO} was not selected. Nothing was written.`]);
    expect(lr.writes).toEqual([]);
  });

  it("puts the photo back after a write fails", async () => {
    const apply = plugin.handlers.get("apply_settings");
    plugin.handlers.set("apply_settings", (p, id) =>
      p["history_name"] === HISTORY.custom ? { ok: false, error: { code: "apply_failed", message: "simulated", recoverable: false } } : (apply as NonNullable<typeof apply>)(p, id),
    );
    const { worked, results } = await run(["y", "y", "y"]);
    expect(worked).toBe(false);
    expect(results["errors"]).toEqual([expect.stringContaining("the check stopped: ")]);
    expect(results["put_back"]).toMatchObject({ ok: true, differing: [] });
    expect(lr.settings).toEqual(nefDump.settings);
    expect(said).toContain("White balance check: FAILED");
  });

  it("says PUT BACK: NO, naming the settings, when the snapshot does not put the photo back", async () => {
    plugin.handlers.set("apply_snapshot", (p) => ({ ok: true, payload: { uuid: lr.uuid, read_back: lr.settingsOf(String(p["photo_uuid"])) } }));
    const { worked, results } = await run(["y", "y", "y"]);
    expect(worked).toBe(false);
    expect(results["tint_custom"]).toMatchObject({ reset_to_as_shot: false });
    expect(results["put_back"]).toMatchObject({ ok: false, differing: ["Temperature", "Tint", "WhiteBalance"] });
    expect(results["errors"]).toEqual(["the photo is not as before the check: Temperature, Tint, WhiteBalance differ. Tell Claude Code."]);
    expect(said).toContain("  PUT BACK: NO");
  });

  it("stops when another engine holds the bridge", async () => {
    const { worked, results } = await run([], { busy: true });
    expect(worked).toBe(false);
    expect(results["errors"]).toEqual([expect.stringContaining("another LrC-AVG engine is using the Lightroom bridge")]);
    expect(lr.writes).toEqual([]);
  });

  it("moves a value the other way when the shift would pass the slider's maximum", () => {
    expect(shifted(map, "temperature", 5500, 300)).toBe(5800);
    expect(shifted(map, "temperature", 49900, 300)).toBe(49600);
    expect(shifted(map, "tint", 148, 5)).toBe(143);
  });
});
