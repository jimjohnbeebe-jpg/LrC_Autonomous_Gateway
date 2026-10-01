// The Phase 5 check (src/devtools/phase5-check.ts) against the simulated plugin and simulated Jim
// (tests\helpers\phase5-harness.ts, phase5-sim-jim.ts): a clean run passes every acceptance line, and
// a run that stops continues where it stopped (PHASE5_PLAN decision 8).

import { describe, expect, it } from "vitest";
import { FIXTURES } from "../src/devtools/phase3-config.js";
import type { CheckState } from "../src/devtools/phase5-state.js";
import { failures, h, runCheck, usePhase5Harness } from "./helpers/phase5-harness.js";

usePhase5Harness();

type J = Record<string, unknown>;
const summaryOf = (results: J) => results["summary"] as J;

describe("devtools: Phase 5 check", () => {
  it("passes every acceptance line on a clean run, and puts every photo back", { timeout: 120000 }, async () => {
    const { accepted, finished, results } = await runCheck();
    expect(failures()).toEqual([]);
    expect(finished).toBe(true);
    expect(accepted).toBe(true);
    expect(summaryOf(results)).toMatchObject({
      acceptance_suggestion: "WORKED",
      page_setting_reaches_engine: true,
      session_rides_out_plugin_manager: true,
      hud_tracks_stages: true,
      ac2_hud_abort: true,
      approve_blocks_until_pressed: true,
      ac3_hud_pick: true,
      menu_items: true,
      ac1_six_chats: true,
      ac4_clipping: true,
      no_unexpected_change: true,
      photos_put_back: true,
      approve_chat_ok: true,
    });
    const a = results["session_a"] as J;
    expect(a["stages"]).toEqual(expect.arrayContaining(["begin", "aborted"]));
    expect(a["pause"]).toMatchObject({ ok: true, seen: true, drops: 0, page_ok: true });
    expect((a["ac2"] as J)["click_to_end_ms"]).toBeLessThanOrEqual(1000);
    const b = results["session_b"] as J;
    expect(b["approve"]).toMatchObject({ ok: true, approval: { by: "hud", pass: 1 } });
    expect(b["wait_in_vain"]).toMatchObject({ ok: true, code: "AWAITING_APPROVAL", nothing_written: true });
    expect((b["abort_while_waiting"] as J)["interrupted_wait"]).toBe(true);
    expect(results["session_c"]).toMatchObject({ ok: true, picked: "B", after_pick: { ok: true, target: "B", approval: { by: "pick" } } });
    expect(results["menu"]).toMatchObject({ ok: true });
    const state = h.store.saved as CheckState;
    expect(state.chats.map((c) => c.fixture)).toEqual([...FIXTURES]);
    expect(state.finished).toBe(true);
    expect(h.lr.copies.size).toBe(0);
  });

  it("continues with the next chat when run again after a stop, without repeating Part 1", { timeout: 120000 }, async () => {
    h.sim.stopAtChat = 3;
    const first = await runCheck();
    expect(first.finished).toBe(false);
    expect(summaryOf(first.results)).toMatchObject({ acceptance_suggestion: "NOT FINISHED" });
    expect((h.store.saved as CheckState).chats).toHaveLength(2);
    expect(h.said.join("\n")).toMatch(/run the command again to continue/);
    expect((h.store.saved as CheckState).pending_chat).toMatchObject({ label: "chat 3 of 6", fixture: FIXTURES[2] });
    h.sim.stopAtChat = null;
    h.said.length = 0;
    const second = await runCheck();
    expect(second.results["resumed"]).toBe(true);
    // The stopped chat's photo was put back first, with the check's own snapshot.
    expect(second.results["pending_put_back"]).toMatchObject({ chat: "chat 3 of 6", differing: [] });
    expect((h.store.saved as CheckState).pending_chat).toBeNull();
    expect(second.results["session_a"]).toBeUndefined(); // Part 1 passed before: not run again
    expect(second.finished).toBe(true);
    expect(second.accepted).toBe(true);
    expect((h.store.saved as CheckState).chats.map((c) => c.fixture)).toEqual([...FIXTURES]);
    expect((h.store.saved as CheckState).runs).toHaveLength(2);
  });

  it("starts over with --new", { timeout: 120000 }, async () => {
    h.sim.stopAtChat = 1;
    await runCheck();
    h.sim.stopAtChat = 1;
    const again = await runCheck({ fresh: true });
    expect(again.results["resumed"]).toBe(false);
    expect(again.results["session_a"]).toBeDefined();
    // A new state still puts back the photo of the chat the last run stopped in.
    expect(again.results["pending_put_back"]).toMatchObject({ chat: "chat 1 of 6", differing: [] });
  });
});
