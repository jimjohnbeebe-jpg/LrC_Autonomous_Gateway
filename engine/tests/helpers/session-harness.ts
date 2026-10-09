// Shared set-up of the session loop tests (session-begin, -step, -probe and -end.test.ts): the
// simulated Lightroom in its "tonal" model (lightroom-sim.ts) behind a fake plugin, a bridge
// client, two test intents and a SessionManager, new for every test.
//
// The `let` exports are live bindings: a test file calls useSessionHarness() once, and its tests
// then read the objects of the current test through the imports.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "vitest";
import { BridgeClient } from "../../src/bridge/index.js";
import { IntentLibrary } from "../../src/intents/index.js";
import { dayStamp, sessionLogSchema } from "../../src/log/index.js";
import { toToolError, type ToolError } from "../../src/mcp/errors.js";
import { loadDefaultParamMap, type Pipeline } from "../../src/params/index.js";
import { PreviewService } from "../../src/preview/index.js";
import { SessionManager, type SessionDeps, type SessionOutput } from "../../src/session/index.js";
import { FakePlugin } from "./fake-plugin.js";
import { LightroomSim } from "./lightroom-sim.js";

export const map = loadDefaultParamMap();
export const ID = "abcdef12-3456-7890-abcd-ef1234567890";
export const SHORT = "abcdef";

export let tmp: string;
export let logDir: string;
export let userDir: string;
export let plugin: FakePlugin;
export let lr: LightroomSim;
export let client: BridgeClient;
export let manager: SessionManager;

export const intent = (id: string, extra: Record<string, unknown> = {}): void => {
  mkdirSync(userDir, { recursive: true });
  writeFileSync(path.join(userDir, `${id}.json`), JSON.stringify({ schema_version: 2, id, label: id, category: "test", brief: `The ${id} brief.`, priors: {}, ...extra }), "utf8");
};

/**
 * White balance on a pipeline for the tests: its SDK key, and a Kelvin step as the change that warms
 * the tonal model as much on that pipeline (2000 K on raw, 40 relative units on rendered: lightroom-sim.ts tonal()).
 */
export const wb = (pipeline: Pipeline): { key: string; step: (kelvin: number) => number } => ({
  key: pipeline === "raw" ? "Temperature" : "IncrementalTemperature",
  step: (kelvin) => (pipeline === "raw" ? kelvin : kelvin / 50),
});

/** A photo whose render clips at neither end (the tonal model with whites -20 and blacks +20). */
export const clean = (): void => {
  Object.assign(lr.settings, { Exposure2012: 0, Whites2012: -20, Blacks2012: 20, Highlights2012: 0, Shadows2012: 0, Contrast2012: 0 });
};

/** The error a failed call reaches Claude as (Tools.run maps it the same way). */
export const fails = async (p: Promise<SessionOutput>): Promise<ToolError> => {
  try {
    await p;
  } catch (err) {
    return toToolError(err);
  }
  throw new Error("expected the call to fail");
};

export const newManager = (extra: Partial<SessionDeps> = {}): SessionManager => {
  const previews = new PreviewService(client, { previewDir: path.join(tmp, "previews") });
  return new SessionManager({
    client,
    map,
    intents: new IntentLibrary({ map, userDir }),
    render: (r) => previews.render({ longEdge: r.longEdge, quality: r.quality, targetUuid: r.targetUuid, regions: r.regions }),
    logDir,
    engineVersion: "test",
    newId: () => ID,
    ...extra,
  });
};

/**
 * Register the per-test set-up and clean-up; call once at the top of a session test file, or of each
 * describe.each(PIPELINES) block. "rendered": the master is DSC_0031.JPG (lightroom-sim-rendered.ts).
 */
export function useSessionHarness(pipeline: Pipeline = "raw"): void {
  beforeEach(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-session-"));
    logDir = path.join(tmp, "logs");
    userDir = path.join(tmp, "intents");
    mkdirSync(path.join(tmp, "previews"));
    plugin = await FakePlugin.start();
    lr = new LightroomSim(path.join(tmp, "previews"));
    lr.renderModel = "tonal";
    if (pipeline === "rendered") lr.useRendered();
    lr.install(plugin);
    client = new BridgeClient({ commandPort: plugin.commandPort, eventPort: plugin.eventPort, connectGapMs: 5, reconnectMs: 30, readToken: () => plugin.token });
    client.start();
    await client.waitConnected(2000);
    intent("test_plain", { allow_probe: true });
    intent("test_prior", { profile: { raw: "Adobe Color", rendered: "Color" }, priors: { exposure: 0.2, "lens.ca_remove": 0 } });
    // Variants mode: B adds to the intent's exposure prior, C's exposure clips the highlights (tonal model).
    intent("test_variants", {
      allow_probe: true,
      priors: { exposure: 0.1, "lens.ca_remove": 1 },
      variants: {
        A: { label: "natural", priors: {} },
        B: { label: "dramatic", priors: { exposure: 0.1, contrast: 20 } },
        C: { label: "bright", priors: { exposure: 1.0, "lens.ca_remove": 0 } },
      },
    });
    manager = newManager();
  });

  afterEach(async () => {
    client.stop();
    await plugin.close();
    rmSync(tmp, { recursive: true, force: true });
  });
}

export const logFile = (): string => path.join(logDir, `${dayStamp(new Date())}-${SHORT}.json`);
export const readLog = () => sessionLogSchema.parse(JSON.parse(readFileSync(logFile(), "utf8")));
