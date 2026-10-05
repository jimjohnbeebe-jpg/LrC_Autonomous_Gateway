// The HUD's events (PHASE5_PLAN row 5): the four hud_* events the plugin sends when the user clicks a
// HUD button or one of the menu items (bridge\hud-protocol.ts). Each is validated (parseHudEvent);
// a click already seen is dropped, so a repeat never acts twice [inference: the plugin sends each
// click once, plugin\LrC-AVG.lrplugin\Hud.lua]; the session manager acts on it
// (session\hud-actions.ts); and the HUD gets the answer at once (answered_click_id), since its
// buttons stay off until then, 10 s at most (PHASE5_PLAN "From row 4"). An event can arrive right
// after a reconnect [handle: vault PHASE5_PLAN.md "From row 4": probe 2, 14 ms after the reconnect]
// and is handled like any other.
// A click on a session the publisher has no line to (Claude Desktop restarted the engine while the
// HUD showed a session) is answered with one end update for it, its photo, snapshot and outcome read
// from the session's log: `accepted` or `aborted` when the log has that outcome, else `ended` with
// the way to undo the edit in the note; with no log found nothing is sent, and the HUD's own 10 s
// line says no answer came (fix/hud-p1, critique P1-3) [handle: tests\hud-unknown-session.test.ts].
// The Deck's clicks (Phase 7 row 3, hud\deck.ts) come here too, `via: "channel"`, and take the same
// path to the session manager; the seen click ids are shared, so a click that reached both HUDs acts
// once. The answer goes back to the HUD clicked: a Deck click's to the Deck (deck.ts answerClick),
// which shows the not-open edit itself (spec 3.2), so no `ended` update is sent for it
// [handle: tests\hud-channel-events.test.ts].

import { z } from "zod";
import { HUD_LIMITS, parseHudEvent, type BridgeClient, type EventEnvelope } from "../bridge/index.js";
import { toToolError } from "../mcp/errors.js";
import type { SessionOutput, UserAction } from "../session/index.js";
import type { EndedFrom, HudPublisher } from "./publisher.js";

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
  /** Which HUD sent it: the plugin's (over the bridge) or the Deck (over the HUD channel). */
  via: "bridge" | "channel";
};

/** What the events need from the session manager (manager.ts). */
type Manager = { userAction(action: UserAction): string; getLog(args: { session_id: string }): SessionOutput };
/** Where a Deck click's answer goes (hud\deck.ts). */
type DeckAnswer = { answerClick(sessionId: string, clickId: string, note: string): boolean };

/** How many click ids are remembered to drop repeats [inference: far more than a session's clicks]. */
const SEEN_CLICKS = 64;

/** The parts of a session log (log\session-log.ts, v2) an `ended` update names. */
const loggedSession = z.object({
  target: z.object({ uuid: z.string(), filename: z.string().nullable().optional(), copy_name: z.string().nullable().optional() }),
  snapshot: z.object({ name: z.string() }).optional(),
  variants: z.array(z.object({ uuid: z.string() })).optional(),
  outcome: z.string().nullable().optional(),
});

/** Added to the note of an edit left as it was when it stopped being open (no outcome in its log). */
const UNDO_HINT = "To undo it, use Develop > Snapshots.";

export class HudEvents {
  private readonly seen: string[] = [];
  private readonly manager: Manager;
  private readonly publisher: HudPublisher;
  private readonly record: (r: HudEventRecord) => void;
  private readonly now: () => Date;
  private readonly deck: DeckAnswer | null;

  constructor(
    client: BridgeClient,
    manager: Manager,
    publisher: HudPublisher,
    options: { record?: (r: HudEventRecord) => void; now?: () => Date; deck?: DeckAnswer } = {},
  ) {
    this.manager = manager;
    this.publisher = publisher;
    this.record = options.record ?? (() => {});
    this.now = options.now ?? (() => new Date());
    this.deck = options.deck ?? null;
    client.onEvent((event) => this.handle(event));
  }

  handle(envelope: Pick<EventEnvelope, "name" | "payload">, via: HudEventRecord["via"] = "bridge"): void {
    const parsed = parseHudEvent(envelope);
    if (parsed === null) return; // not a HUD event (e.g. selection_changed)
    if (!parsed.ok) {
      this.record({ ok: false, name: envelope.name, error: parsed.error, via });
      return;
    }
    const { event } = parsed;
    const p = event.payload;
    const ids = { name: event.name, session_id: p.session_id, click_id: p.click_id, source: p.source, via };
    if (this.seen.includes(p.click_id)) {
      this.record({ ok: false, ...ids, error: "a repeat of a click already handled" });
      return;
    }
    this.seen.push(p.click_id);
    if (this.seen.length > SEEN_CLICKS) this.seen.shift();
    let note: string;
    let error: string | null = null;
    try {
      note = this.manager.userAction({ ...event, received: this.now(), t0: performance.now() });
    } catch (err) {
      note = "LrC-AVG could not act on that click.";
      error = toToolError(err).code; // for the tool log; the HUD shows no codes
    }
    const answered =
      via === "channel"
        ? (this.deck?.answerClick(p.session_id, p.click_id, note) ?? false)
        : this.publisher.answerClick(p.session_id, p.click_id, note) || this.answerEnded(p, note);
    this.record({ ok: true, ...ids, note, answered, ...(error ? { error } : {}) });
  }

  /** One end update for a session without a line, from its log; false when no log is found. */
  private answerEnded(p: { session_id: string; seq_seen: number; click_id: string }, note: string): boolean {
    let log: z.infer<typeof loggedSession>;
    try {
      log = loggedSession.parse(this.manager.getLog({ session_id: p.session_id }).json["log"]);
    } catch {
      return false; // SESSION_NOT_FOUND, or a log without a photo
    }
    const t = log.target;
    // log\session-log.ts outcome: "accept", "revert", "aborted", or null while the edit was open.
    const stage = log.outcome === "accept" ? "accepted" : log.outcome ? "aborted" : "ended";
    const from: EndedFrom = {
      stage,
      target: { uuid: t.uuid, ...(t.filename ? { filename: t.filename } : {}), ...(t.copy_name ? { copy_name: t.copy_name } : {}) },
      session_photos: [t.uuid, ...(log.variants ?? []).map((v) => v.uuid)].slice(0, HUD_LIMITS.photos),
      ...(log.snapshot ? { snapshot: log.snapshot.name } : {}),
    };
    return this.publisher.answerEnded(p, from, stage === "ended" ? `${note} ${UNDO_HINT}` : note);
  }
}
