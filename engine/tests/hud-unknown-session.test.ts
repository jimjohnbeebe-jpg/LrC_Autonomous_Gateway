// A click on a session the engine does not know (fix/hud-p1, critique P1-3): Claude Desktop restarted
// the engine while the HUD showed a session, so the new engine has no line to it. The click is
// answered with one `ended` update for that session, its photo and snapshot read from the session's
// log (src/hud/events.ts, publisher.ts answerEnded); with no log, nothing is sent and the HUD's own
// 10 s line says no answer came. Against the simulated Lightroom and its HUD.

import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "../src/bridge/index.js";
import { HudEvents, HudPublisher, type HudEventRecord, type HudRecord } from "../src/hud/index.js";
import { waitUntil } from "./helpers/fake-plugin.js";
import { hudAt, hudRig } from "./helpers/hud-harness.js";
import { ID, clean, client, lr, newManager, plugin, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

const NOTE = "This edit is no longer open in Claude, so nothing was done.";

/** A new engine on the same bridge: a manager without a session, and its own publisher and events. */
function restartedEngine(): { events: HudEvents; eventRecords: HudEventRecord[]; records: HudRecord[] } {
  const eventRecords: HudEventRecord[] = [];
  const records: HudRecord[] = [];
  const hud = new HudPublisher(client, { record: (r) => records.push(r) });
  const events = new HudEvents(client, newManager(), hud, { record: (r) => eventRecords.push(r) });
  return { events, eventRecords, records };
}

const abort = (sessionId: string, seqSeen: number, clickId: string): EventEnvelope => ({
  id: `evt-${clickId}`,
  type: "evt",
  name: "hud_abort",
  payload: { session_id: sessionId, seq_seen: seqSeen, click_id: clickId, source: "hud" },
});

describe("A click on a session the engine does not know", () => {
  it("gets one ended update for it, with the photo and snapshot from its log; nothing is done", async () => {
    clean();
    const before = hudRig(); // the engine before the restart: its session is in the HUD
    await before.manager.begin({ intent_id: "test_plain" });
    const shown = await hudAt("awaiting_claude");
    const exposure = lr.settings["Exposure2012"];
    const engine = restartedEngine();
    // Delivered to the new engine only (the old one's HudEvents stays on the shared client).
    engine.events.handle(abort(ID, shown.seq, "CLICK-AFTER-RESTART"));
    const ended = await hudAt("ended");
    expect(ended).toEqual({
      session_id: ID,
      seq: shown.seq + 1,
      stage: "ended",
      target: { uuid: "SIM-UUID", filename: "20260907-_OZ80093.NEF" },
      session_photos: ["SIM-UUID"],
      snapshot: shown.snapshot,
      answered_click_id: "CLICK-AFTER-RESTART",
      note: `${NOTE} To undo it, use Develop > Snapshots.`,
    });
    expect(shown.snapshot).toMatch(/^AVG pre-session /);
    expect(engine.eventRecords).toEqual([expect.objectContaining({ ok: true, session_id: ID, note: NOTE, answered: true })]);
    await waitUntil(() => engine.records.length === 1);
    expect(engine.records[0]).toMatchObject({ ok: true, stage: "ended", result: { applied: true } });
    expect(plugin.received.some((r) => r.name === "apply_snapshot")).toBe(false);
    expect(lr.settings["Exposure2012"]).toBe(exposure);
  });

  it("answers with the log's outcome when the edit had ended, without the undo hint", async () => {
    clean();
    const before = hudRig();
    await before.manager.begin({ intent_id: "test_plain" });
    const shown = await hudAt("awaiting_claude");
    await before.manager.end({ session_id: ID, outcome: "accept" });
    const accepted = await hudAt("accepted");
    const engine = restartedEngine();
    engine.events.handle(abort(ID, accepted.seq, "CLICK-AFTER-ACCEPT"));
    await waitUntil(() => engine.records.length === 1);
    expect(engine.records[0]).toMatchObject({ ok: true, seq: accepted.seq + 1, stage: "accepted" });
    const answer = plugin.received.filter((r) => r.name === "hud_update").at(-1)?.payload;
    expect(answer).toMatchObject({ stage: "accepted", answered_click_id: "CLICK-AFTER-ACCEPT", snapshot: shown.snapshot });
    expect(String((answer as { note?: unknown }).note)).not.toContain("To undo it");
  });

  it("sends nothing when no log of it is found, so the HUD's 10 s line answers", async () => {
    const engine = restartedEngine();
    engine.events.handle(abort("20990101-nolog-of-this-one", 3, "CLICK-NO-LOG"));
    await new Promise((r) => setTimeout(r, 100));
    expect(plugin.received.filter((r) => r.name === "hud_update")).toEqual([]);
    expect(engine.eventRecords).toEqual([expect.objectContaining({ ok: true, note: NOTE, answered: false })]);
    expect(engine.records).toEqual([]);
  });
});
