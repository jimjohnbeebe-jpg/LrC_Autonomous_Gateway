// The Phase 5 check (src/devtools/phase5-check.ts) when something goes wrong, against the simulated
// plugin and simulated Jim (tests\helpers\phase5-harness.ts): each failure shows as FAILED on its
// own line, the photo is still put back, and a failed Part 1 stops the check before the chats.

import { describe, expect, it } from "vitest";
import type { CheckState } from "../src/devtools/phase5-state.js";
import { failures, h, runCheck, usePhase5Harness } from "./helpers/phase5-harness.js";

usePhase5Harness();

type J = Record<string, unknown>;
const summaryOf = (results: J) => results["summary"] as J;
const state = (): CheckState => h.store.saved as CheckState;

describe("devtools: Phase 5 check, failures", () => {
  it("fails AC-2 when no Abort comes from the HUD, puts the photo back, and stops before the chats", { timeout: 120000 }, async () => {
    h.sim.skip.add("abort-a");
    const { accepted, finished, results } = await runCheck();
    expect(accepted).toBe(false);
    expect(finished).toBe(false);
    expect(summaryOf(results)).toMatchObject({ acceptance_suggestion: "FAILED", ac2_hud_abort: false, ac1_six_chats: false });
    expect(failures().join("\n")).toMatch(/AC-2: no Abort arrived from the HUD in time/);
    expect((results["session_a"] as J)["ac2"]).toMatchObject({ ok: false, closed: { closed_after_error: { revert: expect.anything() } } });
    expect(state().part1?.ok).toBe(false);
    expect(state().chats).toEqual([]);
    expect(h.said.join("\n")).toMatch(/Part 1 did not pass, so the chats were not started/);
    expect(summaryOf(results)["photos_put_back"]).toBe(false); // no chat ran; Part 1's own put-back held:
    expect(((state().part1?.summary["lines"]) as J)["photo_put_back"]).toBe(true);
  });

  it("fails AC-2 when the photo is back more than 1 s after the click, though it is back exactly", { timeout: 120000 }, async () => {
    h.sim.clickLogEarlierMs = 1500;
    const { results } = await runCheck();
    const ac2 = (results["session_a"] as J)["ac2"] as J;
    expect(ac2).toMatchObject({ ok: false, photo_back: true, within_budget: false });
    expect(ac2["click_to_end_ms"]).toBeGreaterThan(1000);
    expect(summaryOf(results)).toMatchObject({ ac2_hud_abort: false });
    expect(failures().join("\n")).toMatch(/the HUD's Abort: the photo was back \d+ ms after the click, not within 1000 ms/);
  });

  it("skips session B when Jim leaves the page's Mode as it was", { timeout: 120000 }, async () => {
    h.sim.pageUnchanged = true;
    const { accepted, results } = await runCheck();
    expect(accepted).toBe(false);
    expect(summaryOf(results)).toMatchObject({ page_setting_reaches_engine: false, approve_blocks_until_pressed: false, ac3_hud_pick: true });
    expect(results["session_b"]).toBeUndefined();
    expect(h.said.join("\n")).toMatch(/Session B was skipped/);
    expect(failures().join("\n")).toMatch(/the settings page was not set to Mode "Approve each pass"/);
  });

  it("fails the Plug-in Manager line when Lightroom never pauses", { timeout: 120000 }, async () => {
    h.sim.noPause = true;
    const { results } = await runCheck();
    expect(summaryOf(results)).toMatchObject({ session_rides_out_plugin_manager: false, page_setting_reaches_engine: true });
    expect((results["session_a"] as J)["pause"]).toMatchObject({ ok: false, seen: false, page_ok: true });
  });

  it("fails approve_each_pass when no Approve comes, and puts the photo back", { timeout: 120000 }, async () => {
    h.sim.skip.add("approve");
    const { results } = await runCheck();
    expect(summaryOf(results)).toMatchObject({ approve_blocks_until_pressed: false, page_setting_reaches_engine: true, ac3_hud_pick: true, menu_items: true });
    expect((results["session_b"] as J)["error"]).toMatchObject({ code: "AWAITING_APPROVAL" });
    expect((results["photo_after_part1"] as J)["differing"]).toEqual([]);
  });

  it("ends session C itself when no Accept comes from the HUD, so the menu sessions still run", { timeout: 120000 }, async () => {
    h.sim.skip.add("accept-c");
    const { results } = await runCheck();
    expect(summaryOf(results)).toMatchObject({ ac3_hud_pick: false, menu_items: true, ac2_hud_abort: true });
    expect(failures().join("\n")).toMatch(/no Accept arrived from the HUD in time \(session C\); the check ended the session with revert/);
    expect((results["session_c"] as J)["closed_after_error"]).toMatchObject({ revert: expect.anything() });
  });

  it("names a photo a click changed although it should not have (the Phase 4 input)", { timeout: 120000 }, async () => {
    h.sim.tamperOnPick = true;
    const { accepted, results } = await runCheck();
    expect(accepted).toBe(false);
    expect(failures().join("\n")).toMatch(/read back after your Pick \(session C\): 20260907-_OZ80093\.NEF: .*Exposure.* changed|read back after your Pick \(session C\): 20260907-_OZ80093\.NEF: exposure changed/);
    expect(summaryOf(results)).toMatchObject({ no_unexpected_change: false });
  });

  it("asks Jim to quit Claude Desktop when it keeps the bridge after a chat, then goes on", { timeout: 120000 }, async () => {
    h.sim.lockBusyAfterChat = true;
    const { accepted, results } = await runCheck();
    expect(accepted).toBe(true);
    const back = results["bridge_back"] as J[];
    expect(back).toHaveLength(7);
    expect(back[0]).toMatchObject({ idle_release: false, quit_rounds: 1, ok: true });
  });

  it("stops before the next chat while a chat's photo is not back, and puts it back first on the next run", { timeout: 120000 }, async () => {
    h.sim.lockBusyAfterChat = true;
    h.sim.neverQuit = true;
    const first = await runCheck();
    expect(first.finished).toBe(false);
    expect(failures().join("\n")).toMatch(/after the approve chat, the check could not take the Lightroom bridge back/);
    expect(h.said.join("\n")).toMatch(/is not back as before the approve chat yet, so the check stops here/);
    expect(state().pending_chat).toMatchObject({ label: "the approve chat" });
    expect(state().chats).toEqual([]);
    h.sim.lockBusyAfterChat = false;
    h.sim.neverQuit = false;
    h.busy = false;
    const second = await runCheck();
    expect(second.results["pending_put_back"]).toMatchObject({ chat: "the approve chat", differing: [] });
    expect(state().pending_chat).toBeNull();
    expect(state().chats).toHaveLength(6);
  });

  it("reports a copy left in the catalog under Cleanup without failing the acceptance (as Phase 4)", { timeout: 120000 }, async () => {
    h.sim.keepCopy = true;
    const { accepted, results } = await runCheck();
    expect(accepted).toBe(true);
    expect(summaryOf(results)).toMatchObject({ copies_removed: "2 of 3" });
    expect(h.said.join("\n")).toMatch(/Cleanup: session C's copies removed: 2 of 3\./);
  });

  it("fails AC-1 when a chat makes no pass and Jim does not hold it again, and goes on with the next", { timeout: 120000 }, async () => {
    h.sim.chatPasses = 0;
    h.sim.answer = (q) => (/once more/.test(q) ? "n" : "y");
    const { accepted, finished, results } = await runCheck();
    expect(finished).toBe(true);
    expect(accepted).toBe(false);
    expect(summaryOf(results)).toMatchObject({ ac1_six_chats: false, acceptance_suggestion: "FAILED" });
    expect(state().chats).toHaveLength(6);
    expect(state().chats.every((c) => !c.ok)).toBe(true);
    expect(failures().join("\n")).toMatch(/AC-1: the chat on 20250413-_OZ81430\.NEF did not pass \(0 passes, not 1-4/);
  });

  it("holds a chat once more when Jim says so, and counts the second try", { timeout: 120000 }, async () => {
    let first = true;
    h.sim.answer = (q) => {
      if (first && /Does the result look like a sensible golden-hour/.test(q)) {
        first = false;
        return "n";
      }
      return "y";
    };
    const { accepted } = await runCheck();
    expect(accepted).toBe(true);
    const attempts = state().chats[0]?.summary["attempts"] as J[];
    expect(attempts.map((a) => a["ok"])).toEqual([false, true]);
  });

  it("records the approve chat without failing the acceptance when it does not go as planned", { timeout: 120000 }, async () => {
    h.sim.answer = (q) => (/rather than show an error/.test(q) ? "n" : "y");
    const { accepted, results } = await runCheck();
    expect(accepted).toBe(true);
    expect(summaryOf(results)).toMatchObject({ approve_chat_ok: false });
    expect(state().approve_chat?.ok).toBe(false);
  });
});
