// The Phase 4 check (src/devtools/phase4-check.ts) when a part fails, against the simulated plugin
// (tests\helpers\phase4-harness.ts): each failure shows as FAILED on its own line, and the photo,
// the copies and the presets are still cleaned up. A cleanup that leaves something behind is
// recorded without failing the acceptance.

import { readdirSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ToolError } from "../src/mcp/index.js";
import { h, map, runCheck, usePhase4Harness, YES } from "./helpers/phase4-harness.js";

usePhase4Harness();

type J = Record<string, unknown>;
const summaryOf = (results: J) => results["summary"] as J;

describe("devtools: Phase 4 check, failures", () => {
  it("fails AC-3 when Jim says the copies do not look different, skips the chat, and still cleans up", { timeout: 120000 }, async () => {
    const { accepted, results } = await runCheck(["n", "y"]);
    expect(accepted).toBe(false);
    expect(summaryOf(results)).toMatchObject({ ac3_variants_scripted: false, ac3_chat: false, sync_burst_within_2: true, ac5_log_and_sync_replay: true, preset_applies: true, cleanup: { copies: 7, copiesGone: 7, presets: 3, presetsGone: 3 } });
    expect(results["chat"]).toBeUndefined();
    expect(h.said.join("\n")).toMatch(/Part 2 \(the chat\) was skipped/);
  });

  it("fails when the preset does not apply on Jim's click", { timeout: 120000 }, async () => {
    h.sim.presetClickIgnored = true;
    const { accepted, results } = await runCheck(YES);
    expect(accepted).toBe(false);
    expect(summaryOf(results)).toMatchObject({ preset_listed_after_restart: true, preset_applies: false });
    const apply = (results["preset"] as J)["apply"] as { ok: boolean; differing: string[]; differed_before: string[] };
    expect(apply.differing.length).toBeGreaterThan(0);
    expect(apply.differing).toEqual(apply.differed_before);
  });

  it("fails when Lightroom never connects again after the restart, and deletes its own unlisted preset", { timeout: 120000 }, async () => {
    h.sim.noRestart = true;
    const { accepted, results } = await runCheck(YES, { restartTimeoutMs: 500 });
    expect(accepted).toBe(false);
    expect(results["restart"]).toMatchObject({ ok: false });
    expect(summaryOf(results)).toMatchObject({ preset_listed_after_restart: false, preset_applies: false, cleanup: { presets: 3, presetsGone: 3 } });
    expect(h.said.join("\n")).toMatch(/The check deleted its own preset file AVG P4check .*\.xmp \(Lightroom did not list it\)/);
    expect(readdirSync(h.presetDir)).toEqual([]);
  });

  it("fails AC-3 in the chat when Claude accepted right after the pick", { timeout: 120000 }, async () => {
    h.sim.chatStepsAfterPick = 0;
    const { accepted, results } = await runCheck(YES);
    expect(accepted).toBe(false);
    expect(summaryOf(results)).toMatchObject({ ac3_chat: false, ac3_variants_scripted: true, preset_applies: true });
    expect(results["chat"]).toMatchObject({ picked: "C", steps_after_pick: 0, session_ended: "accept" });
  });

  it("fails AC-3 in the chat when Claude picked before refining every copy (Greptile, PR #37)", { timeout: 120000 }, async () => {
    h.sim.chatRefines = ["C"];
    const { accepted, results } = await runCheck(YES);
    expect(accepted).toBe(false);
    expect(summaryOf(results)).toMatchObject({ ac3_chat: false, ac3_variants_scripted: true });
    expect(results["chat"]).toMatchObject({ refined_before_pick: ["C"], picked: "C", steps_after_pick: 1, session_ended: "accept" });
  });

  it("does not count session A when every scripted pass was refused, and still puts the photo back (Greptile, PR #37)", { timeout: 120000 }, async () => {
    const start = map.fromSdk(structuredClone(h.lr.settings)).settings;
    const { accepted, results } = await runCheck(YES, {
      tamper: (tools) => {
        const step = tools.step.bind(tools);
        tools.step = async (args) => {
          if (args.rationale.startsWith("scripted pass: ")) throw new ToolError("GUARDRAIL_REFUSED", "refused (test)", false); // session A's SCRIPT only
          return step(args);
        };
      },
    });
    expect(accepted).toBe(false);
    expect(results["errors"]).toEqual(expect.arrayContaining([expect.stringMatching(/session A made 0 scripted passes, not 1-4/)]));
    expect(summaryOf(results)).toMatchObject({ ac4_clipping: false, ac5_log_and_sync_replay: false, sync_burst_within_2: false, photo_put_back: true, ac3_variants_scripted: true });
    expect(map.fromSdk(h.lr.settings).settings).toEqual(start);
  });

  it("fails the burst when a copy's luma cannot be matched, and still puts the photo back", { timeout: 120000 }, async () => {
    const start = map.fromSdk(structuredClone(h.lr.settings)).settings;
    const original = h.plugin.handlers.get("export_preview") as NonNullable<ReturnType<typeof h.plugin.handlers.get>>;
    h.plugin.handlers.set("export_preview", async (p, rid) => {
      const reply = await original(p, rid);
      if (reply === "silent" || !reply.ok || p["photo_uuid"] !== "SIM-COPY-1") return reply;
      await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 20, g: 20, b: 20 } } }).jpeg({ quality: 100 }).toFile((reply.payload as { path: string }).path);
      return reply;
    });
    const { accepted, results } = await runCheck(YES);
    expect(accepted).toBe(false);
    expect(summaryOf(results)).toMatchObject({ sync_burst_within_2: false, ac5_log_and_sync_replay: true, photo_put_back: true });
    const burst = results["sync_burst"] as { targets: Array<{ luma: { met: boolean } }> };
    expect(burst.targets.map((t) => t.luma.met)).toEqual([false, true, true]);
    expect(map.fromSdk(h.lr.settings).settings).toEqual(start);
  });

  it("puts the photo back when a write of the burst fails, and goes on with AC-5 and the rest", { timeout: 120000 }, async () => {
    const start = map.fromSdk(structuredClone(h.lr.settings)).settings;
    const apply = h.plugin.handlers.get("apply_settings");
    h.plugin.handlers.set("apply_settings", (p, id) =>
      p["history_name"] === "AVG P4check exposure start" ? { ok: false, error: { code: "write_failed", message: "no", recoverable: false } } : (apply?.(p, id) ?? "silent"),
    );
    const { accepted, results } = await runCheck(YES);
    expect(accepted).toBe(false);
    expect(results["sync_burst"]).toMatchObject({ ok: false, error: { code: "WRITE_FAILED" } });
    expect(summaryOf(results)).toMatchObject({ ac5_log_and_sync_replay: true, unselected_original_write: true, photo_put_back: true, ac3_variants_scripted: true });
    expect(map.fromSdk(h.lr.settings).settings).toEqual(start);
  });

  it('fails the syncs when Lightroom refuses WhiteBalance "Custom"; the preset step records As Shot and carries no temperature', { timeout: 120000 }, async () => {
    // Lightroom took "Custom" in the WB check (docs\reports\phase4\WB.md); this models a Lightroom that does not.
    h.sim.refuseCustomWhiteBalance = true;
    const { accepted, results } = await runCheck(YES);
    expect(accepted).toBe(false);
    // The sync writes the source's temperature, so the white balance is read back and not taken.
    expect(results["errors"]).toEqual([expect.stringContaining("the burst sync did not match"), expect.stringContaining("AC-5: the recipe synced onto the replay copy")]);
    expect(summaryOf(results)).toMatchObject({ sync_burst_within_2: false, ac5_log_and_sync_replay: false, photo_put_back: true });
    const preset = results["preset"] as J;
    expect(preset).toMatchObject({ temperature_written: false, camera_profile_written: true, source_prepared: { white_balance_after: "As Shot" } });
    expect(preset["left_out"]).toEqual(expect.arrayContaining([expect.objectContaining({ name: "temperature" })]));
  });
});

describe("devtools: Phase 4 check, a Variants begin that fails part-way", () => {
  it("ends the session with revert and has the copies it made removed too", { timeout: 120000 }, async () => {
    const create = h.plugin.handlers.get("create_virtual_copies") as NonNullable<ReturnType<typeof h.plugin.handlers.get>>;
    let calls = 0;
    h.plugin.handlers.set("create_virtual_copies", async (p, id) => {
      calls++;
      h.lr.copyFault = calls === 2 ? { kind: "partial", made: 2, code: "copy_failed" } : null; // the Variants begin's call, not the check's own
      return create(p, id);
    });
    const { accepted, results } = await runCheck(YES);
    expect(accepted).toBe(false);
    expect(results["variants"]).toMatchObject({ ok: false, error: { code: "VARIANTS_INCOMPLETE" }, closed_after_error: { revert: { differing: [] } } });
    expect(summaryOf(results)).toMatchObject({ ac3_variants_scripted: false, preset_listed_after_restart: false, cleanup: { copies: 6, copiesGone: 6, masterAsBefore: true } });
    const made = (results["cleanup"] as { copies: Array<{ made_by: string }> }).copies.map((c) => c.made_by);
    expect(made).toEqual(["check", "check", "check", "check", "variants", "variants"]);
  });
});

describe("devtools: Phase 4 check, recorded without failing", () => {
  it("asks again for a copy left in the catalog and reports it; the acceptance stands", { timeout: 120000 }, async () => {
    h.sim.keepCopy = "SIM-COPY-1";
    const { accepted, results } = await runCheck(YES);
    expect(accepted).toBe(true);
    expect(summaryOf(results)).toMatchObject({ cleanup: { copies: 10, copiesGone: 9 } });
    expect(h.said.filter((l) => l.includes("Copies removed: 9 of 10")).length).toBe(3);
    expect(h.said.join("\n")).toMatch(/Cleanup: copies removed 9 of 10/);
  });
});
