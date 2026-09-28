// The Phase 4 check's cleanup (src/devtools/phase4-cleanup.ts) on the paths Greptile raised on
// PR #37, against the simulated plugin (tests\helpers\phase4-harness.ts): copies the check knows no
// uuid for, copies of a second Variants session in the chat, and a bridge Claude Desktop keeps.

import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { h, runCheck, usePhase4Harness, YES } from "./helpers/phase4-harness.js";

usePhase4Harness();

type J = Record<string, unknown>;
const summaryOf = (results: J) => results["summary"] as J;

describe("devtools: Phase 4 check, the cleanup's hard cases", () => {
  it("names the copies of a create_virtual_copies that got no answer, for Jim to remove, as not confirmable", { timeout: 120000 }, async () => {
    const create = h.plugin.handlers.get("create_virtual_copies") as NonNullable<ReturnType<typeof h.plugin.handlers.get>>;
    let calls = 0;
    h.plugin.handlers.set("create_virtual_copies", async (p, id) => {
      const reply = await create(p, id); // Lightroom makes the copies ...
      return ++calls === 1 ? "silent" : reply; // ... but the check's own call gets no answer
    });
    const { accepted, results } = await runCheck(YES, { copiesTimeoutMs: 300 });
    expect(accepted).toBe(false);
    expect(results["copies"]).toMatchObject({ error: { code: "BRIDGE_TIMEOUT" } });
    const names = ["AVG P4check sync 1", "AVG P4check sync 2", "AVG P4check sync 3", "AVG P4check replay"];
    expect(summaryOf(results)).toMatchObject({ cleanup: { unconfirmed: names, verified: true } });
    expect(h.said.join("\n")).toMatch(/Also remove any copies named "AVG P4check sync 1", .*: the check asked Lightroom for them but got no answer/);
    expect(h.said.join("\n")).toMatch(/Cleanup: copies removed \d+ of \d+; copies the check could not confirm: AVG P4check sync 1, /);
    expect(h.lr.copies.size).toBe(0);
  });

  it("has the copies of every Variants session in the chat removed, and judges the accepted one", { timeout: 120000 }, async () => {
    h.sim.chatTwice = true;
    const { accepted, results } = await runCheck(YES);
    expect(accepted).toBe(true);
    expect(summaryOf(results)).toMatchObject({ ac3_chat: true, cleanup: { copies: 13, copiesGone: 13 } });
    const made = (results["cleanup"] as { copies: Array<{ made_by: string }> }).copies.filter((c) => c.made_by === "chat");
    expect(made.length).toBe(6);
    expect(results["chat"]).toMatchObject({ session_ended: "accept", picked: "C" });
  });

  it("still cleans up the presets when Claude Desktop keeps the bridge, and says the copies were not checked", { timeout: 120000 }, async () => {
    h.sim.lockBusyAfterChat = true;
    const { results } = await runCheck(["y", "n", "y", "y", "y"]); // question 2: the preset is not listed
    expect(summaryOf(results)).toMatchObject({ preset_listed_after_restart: false, cleanup: { verified: false, copiesGone: 0, presets: 3, presetsGone: 3, masterAsBefore: null } });
    expect((results["cleanup"] as J)["bridge"]).toMatch(/could not be taken back/);
    expect(h.said.join("\n")).toMatch(/The check deleted its own preset file AVG P4check .*\.xmp/);
    expect(h.said.join("\n")).toMatch(/Cleanup: copies removed 0 of 10 \(not checked: the check could not reach Lightroom\)/);
    expect(readdirSync(h.presetDir)).toEqual([]);
  });
});
