// The HUD's events (PHASE5_PLAN row 5): the four hud_* events the plugin sends when the user clicks a
// HUD button or one of the menu items (bridge\hud-protocol.ts). Each is validated (parseHudEvent);
// a click already seen is dropped, so a repeat never acts twice [inference: the plugin sends each
// click once, plugin\LrC-AVG.lrplugin\Hud.lua]; the session manager acts on it
// (session\hud-actions.ts); and the HUD gets the answer at once (answered_click_id), since its
// buttons stay off until then, 10 s at most (PHASE5_PLAN "From row 4"). An event can arrive right
// after a reconnect [handle: vault PHASE5_PLAN.md "From row 4": probe 2, 14 ms after the reconnect]
// and is handled like any other.

import { parseHudEvent, type BridgeClient, type EventEnvelope } from "../bridge/index.js";
import { toToolError } from "../mcp/errors.js";
import type { UserAction } from "../session/index.js";
import type { HudPublisher } from "./publisher.js";

/** What happened to an event (tools-shared.ts writes it to the tool log). */
export type HudEventRecord = {
  ok: boolean;
  name: string;
  session_id?: string;
  click_id?: string;
  source?: string;
  note?: string;
  answered?: boolean;
  error?: string;
};

/** How many click ids are remembered to drop repeats [inference: far more than a session's clicks]. */
const SEEN_CLICKS = 64;

export class HudEvents {
  private readonly seen: string[] = [];
  private readonly manager: { userAction(action: UserAction): string };
  private readonly publisher: HudPublisher;
  private readonly record: (r: HudEventRecord) => void;
  private readonly now: () => Date;

  constructor(
    client: BridgeClient,
    manager: { userAction(action: UserAction): string },
    publisher: HudPublisher,
    options: { record?: (r: HudEventRecord) => void; now?: () => Date } = {},
  ) {
    this.manager = manager;
    this.publisher = publisher;
    this.record = options.record ?? (() => {});
    this.now = options.now ?? (() => new Date());
    client.onEvent((event) => this.handle(event));
  }

  handle(envelope: EventEnvelope): void {
    const parsed = parseHudEvent(envelope);
    if (parsed === null) return; // not a HUD event (e.g. selection_changed)
    if (!parsed.ok) {
      this.record({ ok: false, name: envelope.name, error: parsed.error });
      return;
    }
    const { event } = parsed;
    const p = event.payload;
    const ids = { name: event.name, session_id: p.session_id, click_id: p.click_id, source: p.source };
    if (this.seen.includes(p.click_id)) {
      this.record({ ok: false, ...ids, error: "a repeat of a click already handled" });
      return;
    }
    this.seen.push(p.click_id);
    if (this.seen.length > SEEN_CLICKS) this.seen.shift();
    let note: string;
    try {
      note = this.manager.userAction({ ...event, received: this.now(), t0: performance.now() });
    } catch (err) {
      note = `The engine could not act on it (${toToolError(err).code}).`;
    }
    const answered = this.publisher.answerClick(p.session_id, p.click_id, note);
    this.record({ ok: true, ...ids, note, answered });
  }
}
