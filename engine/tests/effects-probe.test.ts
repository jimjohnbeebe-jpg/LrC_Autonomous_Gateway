// The effects probe (devtools\effects-probe.ts, `npm run effects:probe`, issue #125) against the
// simulated plugin: the sim's NEF and a rendered DSC_0031.JPG in a "fixtures" collection, as in
// s10-check.test.ts. The sim takes any numeric value, so this checks the probe's shape and its
// put-back, not Lightroom's answer.

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeClient } from "../src/bridge/index.js";
import { CANDIDATES, runEffectsProbe, STYLES } from "../src/devtools/effects-probe.js";
import { COLLECTION } from "../src/devtools/s10-config.js";
import { BridgeGate } from "../src/mcp/index.js";
import { loadDefaultParamMap } from "../src/params/index.js";
import { FakePlugin } from "./helpers/fake-plugin.js";
import { LightroomSim } from "./helpers/lightroom-sim.js";

const rendered = JSON.parse(readFileSync(new URL("./fixtures/s10-rendered-dsc0031.json", import.meta.url), "utf8")) as { settings: Record<string, unknown> };
const JPG = "SIM-JPG";
let tmp = "";
let plugin: FakePlugin;
let lr: LightroomSim;
let client: BridgeClient;
const said: string[] = [];

beforeEach(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-effects-"));
  mkdirSync(path.join(tmp, "previews"));
  plugin = await FakePlugin.start();
  lr = new LightroomSim(path.join(tmp, "previews"));
  lr.library.photos.push({ uuid: JPG, local_id: 4, filename: "DSC_0031.JPG", rating: 0, keywords: [], day: "2004-09-25", gps: null, file_format: "JPG", settings: structuredClone(rendered.settings) });
  lr.library.collections.push({ local_id: 503, name: COLLECTION, smart: false, photos: [lr.uuid, JPG] });
  lr.install(plugin);
  said.length = 0;
});

afterEach(async () => {
  client?.stop();
  await plugin.close();
  rmSync(tmp, { recursive: true, force: true });
});

function run() {
  client = new BridgeClient({ commandPort: plugin.commandPort, eventPort: plugin.eventPort, connectGapMs: 5, reconnectMs: 30, readToken: () => plugin.token });
  const gate = new BridgeGate(client, async () => ({ ok: true, lock: { port: 8767, release: async () => {} } }), { waitMs: 2000 });
  return runEffectsProbe({ client, gate, map: loadDefaultParamMap(), ask: async () => "no answer", say: (l) => said.push(l), stamp: "2026-10-12T10-00-00-000Z", dumpDir: path.join(tmp, "census"), recorderDir: tmp, previewDir: path.join(tmp, "previews"), connectTimeoutMs: 2000, settleMs: 0 });
}

type J = Record<string, unknown>;

describe("effects probe", () => {
  it("probes both photos' vignette and grain keys, styles and luma, then puts both back", async () => {
    const before = structuredClone(lr.library.find(JPG)?.settings);
    const { worked, results } = await run();
    expect(results["errors"]).toEqual([]);
    expect(worked).toBe(true);
    const photos = results["photos"] as J[];
    expect(photos.map((p) => p["filename"])).toEqual(["20260907-_OZ80093.NEF", "DSC_0031.JPG"]);
    for (const p of photos) {
      expect((p["range"] as J)["parameters"]).toBe(CANDIDATES.length);
      expect((p["range"] as J)["completed"]).toBe(true);
      expect(((p["style"] as J)["steps"] as J[]).map((s) => s["written"])).toEqual([...STYLES]);
      const luma = (p["luma"] as J)["steps"] as J[];
      expect(luma.map((s) => typeof s["corner_to_centre"])).toEqual(["number", "number"]);
      expect((p["put_back"] as J)["ok"]).toBe(true);
    }
    expect(lr.library.find(JPG)?.settings).toEqual(before);
    expect(said).toContain("Effects probe: WORKED");
  });

  it("fails when a write fails, though both photos are put back (Greptile, PR #145)", async () => {
    const apply = plugin.handlers.get("apply_settings")!;
    plugin.handlers.set("apply_settings", (p, id) => ((p["settings"] as J)["PostCropVignetteStyle"] !== undefined && Object.keys(p["settings"] as J).length === 1
      ? { ok: false, error: { code: "write_failed", message: "no", recoverable: false } }
      : apply(p, id)));
    const { worked, results } = await run();
    expect(worked).toBe(false);
    expect((results["errors"] as string[]).join(" ")).toContain("did not complete the style writes");
    expect((results["photos"] as J[]).map((p) => (p["put_back"] as J)["ok"])).toEqual([true, true]);
  });

  it("fails, writing nothing to it, when a named photo is not in the collection", async () => {
    lr.library.find(JPG)!.filename = "OTHER.JPG";
    const { worked, results } = await run();
    expect(worked).toBe(false);
    expect(String((results["errors"] as string[])[0])).toContain("DSC_0031.JPG");
    expect(plugin.received.some((r) => r.name === "apply_settings" && r.payload["photo_uuid"] === JPG)).toBe(false);
  });
});
