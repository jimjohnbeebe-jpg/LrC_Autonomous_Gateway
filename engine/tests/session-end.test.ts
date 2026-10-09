// lr_end_session and lr_get_session_log (src/session/end.ts) against the simulated Lightroom in its
// "tonal" model (tests/helpers/session-harness.ts): accept (log, recipe, AC-5 replay), revert, and
// the log while open, after the end and from the file.

import { existsSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { PIPELINES } from "../src/params/index.js";
import { recipeSchema } from "../src/log/index.js";
import { ID, clean, client, logFile, lr, manager, map, newManager, readLog, useSessionHarness } from "./helpers/session-harness.js";
import { luaize } from "./helpers/lightroom-sim.js";

describe.each(PIPELINES)("%s pipeline", (pipeline) => {
  useSessionHarness(pipeline);

  describe("lr_end_session and the log", () => {
    beforeEach(() => clean());

    it("accept: finalises the log and writes a recipe that reproduces the final settings (AC-5, same photo)", async () => {
      await manager.begin({ intent_id: "test_prior" });
      await manager.step({ session_id: ID, settings: { shadows: 30, vibrance: 10 }, rationale: "r" });
      const final = map.fromSdk(lr.settings).settings;
      const out = await manager.end({ session_id: ID, outcome: "accept" });
      expect(manager.current()).toBeNull();
      expect(out.json).toMatchObject({ outcome: "accept", passes: "1/4", final_settings: final });
      const recipe = recipeSchema.parse(JSON.parse(readFileSync(String(out.json["recipe_path"]), "utf8")));
      expect(recipe.settings).toEqual(final);
      const log = readLog();
      expect(log).toMatchObject({ outcome: "accept", recipe_path: out.json["recipe_path"], final_settings: final });

      // Replay: back to the pre-session snapshot, then the recipe as one write.
      lr.settings = structuredClone(lr.snapshots.get("SNAP-1") as Record<string, unknown>);
      expect(map.fromSdk(lr.settings).settings).not.toEqual(final);
      const sdk = map.toSdk(recipe.settings, { processVersion: recipe.process_version, pipeline: recipe.pipeline ?? "raw" });
      const res = (await client.request("apply_settings", { target_uuid: lr.uuid, settings: sdk, history_name: "AVG replay" })).read_back;
      expect(map.verifyReadback(sdk, luaize(res) as Record<string, unknown>)).toEqual([]);
      expect(map.fromSdk(res).settings).toEqual(final);
    });

    it("revert: applies the pre-session snapshot and lists no differing setting", async () => {
      const start = map.fromSdk(lr.settings).settings;
      await manager.begin({ intent_id: "test_prior" });
      await manager.step({ session_id: ID, settings: { shadows: 30 }, rationale: "r" });
      const out = await manager.end({ session_id: ID, outcome: "revert" });
      expect(out.json).toMatchObject({ outcome: "revert", recipe_path: null, revert: { ms: expect.any(Number), differing: [] }, final_settings: start });
      expect(map.fromSdk(lr.settings).settings).toEqual(start);
      expect(readLog()).toMatchObject({ outcome: "revert", revert: { differing: [] } });
    });

    it("returns the log while open, after the end, and from the file to a new engine", async () => {
      await manager.begin({ intent_id: "test_plain" });
      expect(manager.getLog({ session_id: ID }).json).toMatchObject({ open: true, log: { session_id: ID } });
      await manager.end({ session_id: ID, outcome: "accept" });
      expect(manager.getLog({ session_id: ID }).json).toMatchObject({ open: false, log: { outcome: "accept" } });
      expect(newManager().getLog({ session_id: ID }).json).toMatchObject({ open: false, log_path: logFile() });
      expect(() => manager.getLog({ session_id: "00000000-0000" })).toThrow(/No session log/);
      expect(existsSync(logFile())).toBe(true);
    });
  });
});
