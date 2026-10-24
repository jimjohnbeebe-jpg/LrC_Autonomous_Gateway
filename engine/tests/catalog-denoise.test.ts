// lr_apply_denoise (issue #190, tools-denoise.ts) against a fake plugin's apply_denoise: one command per photo,
// the snapshot name passed down, the budget, refusals, and a command Lightroom never answers.

import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HelloResult } from "../src/bridge/index.js";
import { IntentLibrary } from "../src/intents/index.js";
import { FILE_DEFS } from "../src/mcp/defs-files.js";
import { Tools, toToolError, type ToolError } from "../src/mcp/index.js";
import type { ToolOutput } from "../src/mcp/tools-shared.js";
import { PreviewService } from "../src/preview/index.js";
import { client, logDir, map, plugin, tmp, useSessionHarness, userDir } from "./helpers/session-harness.js";

useSessionHarness();
afterEach(() => vi.restoreAllMocks());

let tools: Tools;
/** What the fake Lightroom answers per uuid: a status, else "applied". */
let answers: Record<string, Record<string, unknown>>;
beforeEach(() => {
  answers = {};
  plugin.handlers.set("apply_denoise", (p) => {
    const uuid = String(p["photo_uuid"]);
    if (uuid === "GONE") return { ok: false, error: { code: "unknown_photo", message: "no photo has that uuid", recoverable: false } };
    if (uuid === "OLD-LR") return { ok: false, error: { code: "feature_unavailable", message: "needs Lightroom Classic 15", recoverable: false } };
    const a = answers[uuid] ?? { status: "applied", snapshot: { id: "S1", name: String(p["snapshot_name"]) } };
    return { ok: true, payload: { uuid, ms: 10, ...a } };
  });
  tools = new Tools({
    client,
    map,
    previews: new PreviewService(client, { previewDir: path.join(tmp, "previews") }),
    intents: new IntentLibrary({ map, userDir }),
    sessionLogDir: logDir,
    engineVersion: "test",
    ensureBridge: () => client.waitConnected(2000).then(() => undefined),
  });
});

const fails = async (p: Promise<ToolOutput>): Promise<ToolError> => {
  try {
    await p;
  } catch (err) {
    return toToolError(err);
  }
  throw new Error("expected the call to fail");
};
const sent = () => plugin.received.filter((r) => r.name === "apply_denoise").map((r) => r.payload);
const ticking = (step: number, ms: number) => {
  let t = 0;
  return { now: () => (t += step), ms };
};

describe("lr_apply_denoise", () => {
  it("sends one command per photo with one AVG snapshot name, and counts the outcomes", async () => {
    answers["B"] = { status: "unchanged" };
    answers["C"] = { status: "amount_changed", previous_amount: 30, snapshot: { id: "S3", name: "x" } };
    const out = await tools.applyDenoise({ uuids: ["A", "B", "C", "OLD-LR"], amount: 50 });
    const names = new Set(sent().map((p) => p["snapshot_name"]));
    expect(names.size).toBe(1);
    expect([...names][0]).toMatch(/^AVG pre-denoise [0-9a-f]{6}$/);
    expect(sent().map((p) => [p["photo_uuid"], p["amount"]])).toEqual([["A", 50], ["B", 50], ["C", 50], ["OLD-LR", 50]]);
    expect(out.json["counts"]).toEqual({ applied: 1, amount_changed: 1, unchanged: 1, skipped: 0, failed: 1 });
    expect(out.json["failed"]).toEqual([{ uuid: "OLD-LR", code: "FEATURE_UNAVAILABLE", message: "needs Lightroom Classic 15" }]);
    expect(out.json["not_yet"]).toBeUndefined();
  });

  it("stops starting photos when the budget is spent and says how to go on", async () => {
    const out = await tools.applyDenoise({ uuids: ["A", "B", "C"], amount: 40 }, ticking(20_000, 30_000));
    expect(out.json["not_yet"]).toEqual(["C"]);
    expect(String(out.json["next"])).toMatch(/uuids = not_yet \(1 photos\) and the same amount/);
  });

  it("refuses while a session is open, before sending anything", async () => {
    await tools.beginSession({ intent_id: "test_plain", return_image: "none" });
    expect((await fails(tools.applyDenoise({ uuids: ["A"], amount: 50 }))).code).toBe("SESSION_ALREADY_ACTIVE");
    expect(sent()).toEqual([]);
  });

  it("refuses an older plugin before sending anything", async () => {
    const hello = client.hello() as HelloResult;
    vi.spyOn(client, "hello").mockReturnValue({ ...hello, plugin_version: "1.0.0" });
    expect((await fails(tools.applyDenoise({ uuids: ["A"], amount: 50 }))).code).toBe("PLUGIN_TOO_OLD");
    expect(sent()).toEqual([]);
  });

  it("takes 1-100 photos and a whole amount from 1 to 100", () => {
    const schema = FILE_DEFS.find((d) => d.name === "lr_apply_denoise")?.schema;
    expect(schema?.safeParse({ uuids: ["A"], amount: 50 }).success).toBe(true);
    for (const bad of [{ uuids: [], amount: 50 }, { uuids: ["A"], amount: 0 }, { uuids: ["A"], amount: 50.5 }, { uuids: ["A", "A"], amount: 50 }]) expect(schema?.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
});

describe("npm run denoise:check verdict", () => {
  const step = (status: string, expect: string[]) => ({ step: status, expect, answers: [{ uuid: "A", status, ms: 1 }] });
  const all = { steps: [step("applied", ["applied", "amount_changed"]), step("unchanged", ["unchanged"])], selection_back: true, filters_back: true, preview_ok: true, answers: ["y", "y"] };
  it("works only when every step, the put-back, the preview and both answers are as expected", async () => {
    const { verdict } = await import("../src/devtools/denoise-check.js");
    expect(verdict(all).worked).toBe(true);
    expect(verdict({ ...all, steps: [step("failed", ["unchanged"])] }).worked).toBe(false);
    expect(verdict({ ...all, filters_back: false }).worked).toBe(false);
    expect(verdict({ ...all, answers: ["y", "n"] }).lines.at(-1)).toBe("NO  Jim's answer 2: n");
  });
});
