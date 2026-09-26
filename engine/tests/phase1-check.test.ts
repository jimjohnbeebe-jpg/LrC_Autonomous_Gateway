// Contract test of the Phase 1 check (src/devtools/phase1-check.ts) against a simulated plugin.
// The simulation is Node, not Lightroom: it starts from the live S5 NEF dump and imitates what the
// real plugin does with the commands (snapshots, Look = {} clearing the Look, [] for empty tables).
// Clamping one key and ignoring another are made up here, only to exercise the probe's categories;
// what Lightroom really does is what the check will record.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeClient } from "../src/bridge/index.js";
import { runPhase1Check, type Answer } from "../src/devtools/phase1-check.js";
import { loadDefaultParamMap } from "../src/params/index.js";
import { FakePlugin } from "./helpers/fake-plugin.js";

const nefDump = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../docs/reports/phase0/S5/s5_20260907-_OZ80093.NEF.json", import.meta.url)), "utf8"),
) as { settings: Record<string, unknown> };

/** Lua's Json.lua writes every empty table as []. */
function luaize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(luaize);
  if (v && typeof v === "object") {
    const entries = Object.entries(v);
    return entries.length === 0 ? [] : Object.fromEntries(entries.map(([k, x]) => [k, luaize(x)]));
  }
  return v;
}

class SimulatedLightroom {
  settings: Record<string, unknown> = structuredClone(nefDump.settings);
  readonly snapshots = new Map<string, Record<string, unknown>>();
  readonly history: string[] = [];
  fileFormat = "RAW";
  restoreDrops: string | null = null;

  install(plugin: FakePlugin): void {
    const uuid = "SIM-UUID";
    const ok = (payload: unknown) => ({ ok: true as const, payload });
    plugin.handlers.set("get_context", () => ok({ uuid, local_id: 1, lrc_version: "15.5.1", filename: "20260907-_OZ80093.NEF", file_format: this.fileFormat }));
    plugin.handlers.set("get_settings", () => ok({ uuid, settings: luaize(this.settings) }));
    plugin.handlers.set("apply_settings", (p) => {
      this.history.push(String(p["history_name"]));
      for (const [k, v] of Object.entries(p["settings"] as Record<string, unknown>)) {
        if (k === "Look" && (Array.isArray(v) ? v.length === 0 : Object.keys(v as object).length === 0)) delete this.settings["Look"];
        else if (k === "Exposure2012") this.settings[k] = Math.max(-5, Math.min(5, v as number)); // made-up clamp
        else if (k === "Dehaze" && ((v as number) < -100 || (v as number) > 100)) continue; // made-up ignore
        else this.settings[k] = structuredClone(v);
      }
      return ok({ uuid, apply_ms: 25, read_back: luaize(this.settings) });
    });
    plugin.handlers.set("create_snapshot", (p) => {
      const id = `SNAP-${this.snapshots.size + 1}`;
      this.snapshots.set(id, structuredClone(this.settings));
      return ok({ uuid, snapshot_id: id, id_global: "G", name: p["name"], same_name_count: 1 });
    });
    plugin.handlers.set("apply_snapshot", (p) => {
      this.settings = structuredClone(this.snapshots.get(String(p["snapshot_id"])) ?? {});
      if (this.restoreDrops) delete this.settings[this.restoreDrops];
      return ok({ uuid, read_back: luaize(this.settings) });
    });
  }
}

let plugin: FakePlugin;
let lr: SimulatedLightroom;
let client: BridgeClient;
const said: string[] = [];

beforeEach(async () => {
  plugin = await FakePlugin.start();
  lr = new SimulatedLightroom();
  lr.install(plugin);
  client = new BridgeClient({
    commandPort: plugin.commandPort,
    eventPort: plugin.eventPort,
    connectGapMs: 5,
    reconnectMs: 30,
    readToken: () => plugin.token,
  });
  said.length = 0;
});

afterEach(async () => {
  client.stop();
  await plugin.close();
});

function run(answers: Answer[]) {
  const queue = [...answers];
  return runPhase1Check({
    client,
    map: loadDefaultParamMap(),
    ask: async () => queue.shift() ?? "no answer",
    say: (line) => said.push(line),
    connectTimeoutMs: 2000,
  });
}

describe("devtools: Phase 1 check against a simulated plugin", () => {
  it("passes when the writes read back, the snapshot restores and Jim answers yes twice", async () => {
    const { accepted, results } = await run(["y", "y"]);
    expect(accepted).toBe(true);
    expect(results["summary"]).toMatchObject({ acceptance_suggestion: "WORKED", extended_steps_ok: 6, extended_steps_total: 6 });
    expect(results["exposure"]).toEqual({ start: 0.33, target: 0.83, read_back: 0.83 });
    expect(results["revert"]).toMatchObject({ ok: true, differing_keys: [] });
    expect(results["pings"]).toMatchObject({ utf8: { ok: true }, in_flight: { ok: true } });
    // Every write is named in the FR-4.4 form "AVG <id> pass n/N" (rule 03-lightroom).
    expect(lr.history).toEqual(Array.from({ length: 9 }, (_, i) => `AVG P1check pass ${i + 1}/9`));
    expect(lr.settings).toEqual(nefDump.settings);
  });

  it("records what happened one step beyond each limit", async () => {
    const { results } = await run(["y", "y"]);
    const probe = results["range_probe"] as {
      parameters: number;
      min_accepted: number;
      per_parameter: Array<{ sdk_key: string; below_outcome: string; above_outcome: string }>;
    };
    expect(probe.parameters).toBe(57);
    expect(probe.min_accepted).toBe(57);
    const byKey = new Map(probe.per_parameter.map((p) => [p.sdk_key, p]));
    expect(byKey.get("Exposure2012")).toMatchObject({ below_outcome: "clamped", above_outcome: "clamped" });
    // Dehaze stays at 100 from the "maximum" write, so below is "ignored"; above then reads 100,
    // which is both the limit and the previous value.
    expect(byKey.get("Dehaze")).toMatchObject({ below_outcome: "ignored", above_outcome: "clamped_or_ignored" });
    expect(byKey.get("Contrast2012")).toMatchObject({ below_outcome: "accepted", above_outcome: "accepted" });
  });

  it("fails when Jim does not confirm the History step", async () => {
    const { accepted, results } = await run(["n", "y"]);
    expect(accepted).toBe(false);
    expect(results["jim"]).toMatchObject({ history_step_seen: "n", photo_looks_restored: "y" });
  });

  it("fails and names the keys when the snapshot does not restore everything", async () => {
    lr.restoreDrops = "Texture";
    const { accepted, results } = await run(["y", "y"]);
    expect(accepted).toBe(false);
    expect(results["revert"]).toMatchObject({ ok: false, differing_keys: ["Texture"] });
  });

  it("refuses a photo whose exposure has no room for +0.5, instead of writing -0.5", async () => {
    lr.settings["Exposure2012"] = 4.6;
    const { accepted, results } = await run(["y", "y"]);
    expect(accepted).toBe(false);
    expect(lr.history).toEqual([]);
    expect(lr.snapshots.size).toBe(0);
    expect((results["errors"] as string[])[0]).toMatch(/\+0\.5 would pass \+5/);
  });

  it("refuses a photo that is not raw before writing anything, and asks nothing", async () => {
    lr.fileFormat = "JPG";
    const { accepted, results } = await run(["y", "y"]);
    expect(accepted).toBe(false);
    expect(lr.history).toEqual([]);
    expect(lr.snapshots.size).toBe(0);
    expect(results["jim"]).toBeUndefined();
    expect((results["errors"] as string[])[0]).toMatch(/not a raw file/);
  });

  it("reports a failed connection plainly", async () => {
    await plugin.close();
    const { accepted, results } = await runPhase1Check({
      client,
      map: loadDefaultParamMap(),
      ask: async () => "y",
      say: (line) => said.push(line),
      connectTimeoutMs: 200,
    });
    expect(accepted).toBe(false);
    expect(results["summary"]).toEqual({ acceptance_suggestion: "FAILED", connected: false });
    expect(said).toContain("FAILED: could not connect to Lightroom.");
  });
});
