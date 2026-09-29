// The settings module's pure parts (PHASE5_PLAN row 3): the page's values checked field by field,
// the order a session takes its values in, the folders, and the bridge's ports file.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { choosePorts, portsFileReader, readPortsFile } from "../src/bridge/endpoint.js";
import { SESSION_DEFAULTS } from "../src/session/rules.js";
import { EngineFolders, PAGE_SPECS, isFullPath, parsePage, resolveSessionSettings } from "../src/settings/index.js";
import { defaultSimPrefs } from "./helpers/lightroom-sim-prefs.js";

describe("settings page: defaults", () => {
  it("starts from the session's built-in defaults (session\\rules.ts SESSION_DEFAULTS)", () => {
    const { values, problems } = parsePage(defaultSimPrefs());
    expect(problems).toEqual([]);
    expect(values).toMatchObject({
      mode: SESSION_DEFAULTS.approval,
      max_passes: SESSION_DEFAULTS.maxPasses,
      variant_count: SESSION_DEFAULTS.variantCount,
      long_edge: SESSION_DEFAULTS.longEdge,
      quality: SESSION_DEFAULTS.quality,
      clip_high_pct: SESSION_DEFAULTS.clipHighPct,
      clip_low_pct: SESSION_DEFAULTS.clipLowPct,
      decay: [...SESSION_DEFAULTS.decay],
      intents_dir: "",
      log_dir: "",
      receive_port: 8765,
      send_port: 8766,
    });
    expect(Object.keys(values).sort()).toEqual(PAGE_SPECS.map((s) => s.wire).sort());
  });
});

describe("settings page: parsePage", () => {
  const page = (changes: Record<string, unknown>) => parsePage({ ...defaultSimPrefs(), ...changes });

  it("takes valid values", () => {
    const { values, problems } = page({ mode: "approve_each_pass", max_passes: 6, variant_count: 2, long_edge: 1200, quality: 90, clip_high_pct: 0.25, decay: [1, 0.5] });
    expect(problems).toEqual([]);
    expect(values).toMatchObject({ mode: "approve_each_pass", max_passes: 6, variant_count: 2, long_edge: 1200, quality: 90, clip_high_pct: 0.25, decay: [1, 0.5] });
  });

  it.each([
    ["max_passes", 9],
    ["max_passes", 2.5],
    ["variant_count", 4],
    ["long_edge", 799],
    ["quality", "75"],
    ["clip_low_pct", -1],
    ["mode", "fast"],
    ["decay", []],
    ["decay", [1, 0]],
    ["decay", [1, 1, 1, 1, 1, 1, 1, 1, 1]],
    ["intents_dir", 5],
    ["receive_port", 8767],
    ["send_port", 80],
  ])("leaves out %s = %j, with a problem, and keeps the other fields", (wire, bad) => {
    const { values, problems } = page({ [wire]: bad });
    expect(values).not.toHaveProperty(wire);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(wire);
    expect(Object.keys(values)).toHaveLength(PAGE_SPECS.length - 1);
  });

  it("leaves out a missing field", () => {
    const raw = defaultSimPrefs();
    delete raw["quality"];
    const { values, problems } = parsePage(raw);
    expect(values).not.toHaveProperty("quality");
    expect(problems).toEqual(["quality: missing"]);
  });

  it("does not count a value the plugin replaced by its default as the page's (`invalid`)", () => {
    const { values, problems } = page({ max_passes: 4, invalid: [{ key: "maxPasses", value: "12", reason: "outside 1-8" }] });
    expect(values).not.toHaveProperty("max_passes");
    expect(problems).toEqual(["maxPasses = 12: outside 1-8 (the page's value is not used)"]);
  });

  it("leaves out both ports when they are the same", () => {
    const { values, problems } = page({ receive_port: 9000, send_port: 9000 });
    expect(values).not.toHaveProperty("receive_port");
    expect(values).not.toHaveProperty("send_port");
    expect(problems).toEqual(["receive_port and send_port are the same port"]);
  });

  it("takes `invalid` as Lua sends an empty table ([]) and ignores one that is not a list", () => {
    expect(page({ invalid: [] }).problems).toEqual([]);
    expect(page({ invalid: "nonsense" }).problems).toEqual([]);
  });
});

describe("settings: a session's values in order", () => {
  it("uses the defaults with nothing given", () => {
    const s = resolveSessionSettings({}, {}, {});
    expect(s).toMatchObject({ approval: "autonomous", maxPasses: 4, variantCount: 3, longEdge: 1600, quality: 75, clipHighPct: 0.5, clipLowPct: 1, decay: [1, 0.6, 0.4, 0.25] });
    expect(new Set(Object.values(s.from))).toEqual(new Set(["default"]));
  });

  it("takes the page over the defaults", () => {
    const s = resolveSessionSettings({}, {}, { mode: "approve_each_pass", max_passes: 6, variant_count: 2, long_edge: 1200, quality: 60, clip_high_pct: 2, clip_low_pct: 3, decay: [0.5] });
    expect(s).toMatchObject({ approval: "approve_each_pass", maxPasses: 6, variantCount: 2, longEdge: 1200, quality: 60, clipHighPct: 2, clipLowPct: 3, decay: [0.5] });
    expect(new Set(Object.values(s.from))).toEqual(new Set(["page"]));
  });

  it("takes the arguments over the page", () => {
    const s = resolveSessionSettings({ max_passes: 2, variant_count: 3, long_edge: 800, guardrails: { clip_high_pct: 0.1, clip_low_pct: 0.2 } }, { clip_high_pct: 5, clip_low_pct: 5 }, { max_passes: 6, variant_count: 2, long_edge: 1200, clip_high_pct: 2, clip_low_pct: 3 });
    expect(s).toMatchObject({ maxPasses: 2, variantCount: 3, longEdge: 800, clipHighPct: 0.1, clipLowPct: 0.2 });
    expect(s.from).toMatchObject({ max_passes: "argument", variant_count: "argument", long_edge: "argument", clip_high_pct: "argument", clip_low_pct: "argument" });
  });

  it("takes an intent's clip limits over the page's, one limit at a time (decision 1A)", () => {
    const s = resolveSessionSettings({}, { clip_low_pct: 5 }, { clip_high_pct: 2, clip_low_pct: 3 });
    expect(s).toMatchObject({ clipHighPct: 2, clipLowPct: 5 });
    expect(s.from).toMatchObject({ clip_high_pct: "page", clip_low_pct: "intent" });
  });
});

describe("settings: folders", () => {
  const env = { LOCALAPPDATA: "C:\\Users\\U\\AppData\\Local" };
  const read = (values: Record<string, string>) => ({ read: true, values });

  it("uses the defaults until the page names a folder", () => {
    const f = new EngineFolders(env);
    expect(f.intents()).toEqual({ path: path.join(env.LOCALAPPDATA, "LrC-AVG", "intents"), from: "default" });
    expect(f.log()).toEqual({ path: path.join(env.LOCALAPPDATA, "LrC-AVG", "logs"), from: "default" });
    f.update(read({ intents_dir: "", log_dir: "" }));
    expect(f.log().from).toBe("default");
  });

  it("uses the page's full paths, and keeps them when a later read fails", () => {
    const f = new EngineFolders(env);
    f.update(read({ intents_dir: "D:\\Photos\\intents", log_dir: "\\\\nas\\share\\logs" }));
    expect(f.intents()).toEqual({ path: "D:\\Photos\\intents", from: "page" });
    expect(f.logDir()).toBe("\\\\nas\\share\\logs");
    f.update({ read: false, values: {} });
    expect(f.intentsDir()).toBe("D:\\Photos\\intents");
  });

  it("refuses a page folder that is not a full path, and says so", () => {
    const f = new EngineFolders(env);
    f.update(read({ intents_dir: "intents", log_dir: "C:logs" }));
    expect(f.intents()).toMatchObject({ from: "default", problem: 'the page\'s folder "intents" is not a full path' });
    expect(f.log().from).toBe("default");
    expect([isFullPath("C:\\a"), isFullPath("c:/a"), isFullPath("\\\\srv\\s"), isFullPath("\\a"), isFullPath("\\\\\\a")]).toEqual([true, true, true, false, false]);
  });

  it("lets the environment variables win (decision 2d)", () => {
    const f = new EngineFolders({ ...env, LRC_AVG_LOG_DIR: "D:\\repo\\logs", LRC_AVG_INTENTS_DIR: "D:\\repo\\intents" });
    f.update(read({ intents_dir: "D:\\Photos\\intents", log_dir: "D:\\Photos\\logs" }));
    expect(f.log()).toEqual({ path: "D:\\repo\\logs", from: "environment" });
    expect(f.intents()).toEqual({ path: "D:\\repo\\intents", from: "environment" });
  });
});

describe("bridge: the ports file", () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-ports-"));
    file = path.join(dir, "bridge_ports.json");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("reads the plugin's ports", () => {
    writeFileSync(file, JSON.stringify({ receive: 9765, send: 9766, plugin_version: "0.5.0", written_at: "2026-09-28T00:00:00Z" }));
    expect(readPortsFile(file)).toEqual({ ports: { receive: 9765, send: 9766 }, problem: null });
  });

  it("gives no ports, and no problem, without a file (a plugin before 0.5.0)", () => {
    expect(readPortsFile(file)).toEqual({ ports: null, problem: null });
  });

  it.each([
    ["not JSON", "{nope"],
    ["a port out of range", JSON.stringify({ receive: 70000, send: 8766 })],
    ["the same port twice", JSON.stringify({ receive: 8765, send: 8765 })],
    ["a missing port", JSON.stringify({ receive: 8765 })],
  ])("gives no ports and a problem for %s", (_what, text) => {
    writeFileSync(file, text);
    const r = readPortsFile(file);
    expect(r.ports).toBeNull();
    expect(r.problem).toContain(file);
  });

  it("chooses given ports over the file, and the file over 8765/8766", () => {
    const file9 = () => ({ receive: 9765, send: 9766 });
    let reads = 0;
    const counted = () => (reads++, file9());
    expect(choosePorts({ command: 1111, event: 2222 }, counted)).toEqual({ command: 1111, event: 2222, from: "options" });
    expect(reads).toBe(0);
    expect(choosePorts({ command: undefined, event: undefined }, file9)).toEqual({ command: 9765, event: 9766, from: "ports file" });
    expect(choosePorts({ command: undefined, event: undefined }, () => null)).toEqual({ command: 8765, event: 8766, from: "default" });
    expect(choosePorts({ command: 1111, event: undefined }, () => null)).toEqual({ command: 1111, event: 8766, from: "options" });
  });

  it("logs a file it cannot use once, not at every connection attempt", () => {
    writeFileSync(file, "{nope");
    const lines: string[] = [];
    const read = portsFileReader((m) => lines.push(m), file);
    read();
    read();
    expect(lines).toHaveLength(1);
    writeFileSync(file, JSON.stringify({ receive: 9765, send: 9766 }));
    expect(read()).toEqual({ receive: 9765, send: 9766 });
    writeFileSync(file, "{nope");
    read();
    expect(lines).toHaveLength(2);
  });
});
