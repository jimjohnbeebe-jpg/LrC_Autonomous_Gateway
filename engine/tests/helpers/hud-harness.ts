// The HUD's side of the session tests (hud-*.test.ts): a HudPublisher and HudEvents on the session
// harness's client, a SessionManager that reports to them, and the stages it reported, in order (the
// publisher may send fewer: a newer stage replaces one still waiting). Call after useSessionHarness(),
// inside a test or a beforeEach.

import type { HudUpdatePayload } from "../../src/bridge/index.js";
import { HudEvents, HudPublisher, type HudEventRecord, type HudRecord } from "../../src/hud/index.js";
import type { HudSink, SessionDeps, SessionManager } from "../../src/session/index.js";
import { waitUntil } from "./fake-plugin.js";
import { client, lr, newManager } from "./session-harness.js";

export type HudRig = {
  hud: HudPublisher;
  manager: SessionManager;
  /** Every stage the session loop reported, with its note. */
  reported: Array<{ stage: string; note?: string }>;
  /** What HudEvents recorded for each event. */
  events: HudEventRecord[];
  /** What the publisher recorded (refused, failed and first-taken updates). */
  records: HudRecord[];
};

export function hudRig(extra: Partial<SessionDeps> = {}, publisher: { retryMs?: number } = {}): HudRig {
  const records: HudRecord[] = [];
  const events: HudEventRecord[] = [];
  const reported: HudRig["reported"] = [];
  const hud = new HudPublisher(client, { record: (r) => records.push(r), ...publisher });
  const sink: HudSink = {
    stage: (s, stage, options) => {
      reported.push({ stage, ...(options?.note ? { note: options.note } : {}) });
      hud.stage(s, stage, options);
    },
    settle: (s) => hud.settle(s),
  };
  const manager = newManager({ hud: sink, ...extra });
  new HudEvents(client, manager, hud, { record: (r) => events.push(r) });
  return { hud, manager, reported, events, records };
}

/** Wait until the HUD's state is at `stage`; returns that state. */
export async function hudAt(stage: string, timeoutMs = 3000): Promise<HudUpdatePayload> {
  await waitUntil(() => lr.hud.last()?.stage === stage, timeoutMs);
  return lr.hud.last() as HudUpdatePayload;
}

/** The stages reported, without repeats in a row. */
export function stagesOf(rig: HudRig): string[] {
  return rig.reported.map((r) => r.stage).filter((stage, i, all) => stage !== all[i - 1]);
}
