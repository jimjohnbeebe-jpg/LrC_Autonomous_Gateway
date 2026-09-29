// Contract test of the Phase 4 check (src/devtools/phase4-check.ts) against the simulated plugin in
// its "tonal" model: the whole run when everything works, with Jim, the restart, the preset click,
// the chat and the cleanup simulated (tests\helpers\phase4-harness.ts). The failure cases are in
// phase4-check-faults.test.ts; the chat's tool-log reader in phase4-chat.test.ts.

import { existsSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLUGIN_VERSION } from "../src/bridge/index.js";
import { h, map, runCheck, usePhase4Harness, YES, failures } from "./helpers/phase4-harness.js";

usePhase4Harness();

type J = Record<string, unknown>;

describe("devtools: Phase 4 check against a simulated plugin", () => {
  it("passes when every part works and Jim answers yes, and leaves the catalog and the preset folder clean", { timeout: 180000 }, async () => {
    const start = map.fromSdk(structuredClone(h.lr.settings)).settings;
    const { accepted, results } = await runCheck(YES);
    expect(failures()).toEqual([]);
    expect(results["summary"]).toMatchObject({
      acceptance_suggestion: "WORKED",
      ac3_variants_scripted: true,
      ac3_chat: true,
      sync_burst_within_2: true,
      ac5_log_and_sync_replay: true,
      ac4_clipping: true,
      ac4_sessions: ["A", "variants", "chat"],
      preset_listed_after_restart: true,
      preset_applies: true,
      unselected_original_write: true,
      photo_put_back: true,
      copies_start_as_master: true,
      contact_sheet_letters_readable: true,
      cleanup: { copies: 10, copiesGone: 10, presets: 3, presetsGone: 3, masterAsBefore: true },
    });
    expect(accepted).toBe(true);
    expect(h.said).toContain("Phase 4 acceptance: WORKED");
    // The photo is left as it was, the copies are gone, the preset folder is empty.
    expect(map.fromSdk(h.lr.settings).settings).toEqual(start);
    expect(h.lr.copies.size).toBe(0);
    expect(readdirSync(h.presetDir)).toEqual([]);
  });

  it("records what row 10 answers of rows 7-9's [unverified] items", { timeout: 180000 }, async () => {
    const { results } = await runCheck(YES);
    const burst = results["sync_burst"] as { targets: Array<{ luma: { met: boolean; renders: number; tries: unknown[] } }>; measured: { copies: Array<{ difference: number }> }; selection_kept: boolean };
    expect(burst.targets.map((t) => t.luma.met)).toEqual([true, true, true]);
    expect(burst.targets.every((t) => t.luma.renders <= 4 && t.luma.tries.length > 0)).toBe(true);
    expect(burst.measured.copies.every((c) => Math.abs(c.difference) <= 2)).toBe(true);
    expect(burst.selection_kept).toBe(true);
    expect(results["ac5_sync"]).toMatchObject({ ok: true, applied: 1, differing: [] });
    expect(results["unselected_original"]).toMatchObject({ ok: true, written: true, selection_kept: true, undo_differing: [] });
    const variants = results["variants"] as J;
    expect(variants).toMatchObject({ ok: true, picked: { id: "B" }, jim: { visibly_different: "y", pick: "B" }, verified: { ok: true, log_picked: "B", last_step_on_pick: true, master_differing: [] } });
    expect(((variants["begin"] as J)["variants"] as J[]).map((v) => v["id"])).toEqual(["A", "B", "C"]);
    expect(typeof (variants["begin"] as J)["total_ms"]).toBe("number");
    const preset = results["preset"] as J;
    expect(preset).toMatchObject({ ok: true, name: "AVG P4check 2026-09-28T10-00-00-000Z", group: "LrC-AVG", camera_profile_written: true, temperature_written: true, listed_after_restart: "y" });
    expect(preset["apply"]).toMatchObject({ ok: true, profile_moved: { to: "Camera Landscape", preset: "Camera Neutral" }, differing: [] });
    const prepared = preset["source_prepared"] as { camera_profile: J; temperature: { from: number; to: number }; white_balance_after: unknown };
    expect(prepared).toMatchObject({ camera_profile: { from: "Adobe Landscape", to: "Camera Neutral" }, white_balance_after: "Custom" });
    expect(prepared.temperature.to).toBe(prepared.temperature.from + 300);
    expect(results["restart"]).toMatchObject({ ok: true, plugin_version: PLUGIN_VERSION });
    expect(results["chat"]).toMatchObject({ session_begun: true, mode: "variants", target_filename: "20260907-_OZ80099.NEF", picked: "C", steps_after_pick: 1, session_ended: "accept", refined_before_pick: ["A", "B", "C"] });
    const made = (results["cleanup"] as { copies: Array<{ made_by: string; state: string }> }).copies;
    expect(made.map((c) => c.made_by)).toEqual(["check", "check", "check", "check", "variants", "variants", "variants", "chat", "chat", "chat"]);
    expect(made.every((c) => c.state === "gone")).toBe(true);
  });

  it("stops at once when another engine holds the bridge", async () => {
    const { accepted, results } = await runCheck([], { busy: true });
    expect(accepted).toBe(false);
    expect(results["summary"]).toMatchObject({ lock: "busy" });
    expect(existsSync(h.presetDir)).toBe(true);
  });
});
