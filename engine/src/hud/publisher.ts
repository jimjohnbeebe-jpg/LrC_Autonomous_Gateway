// The HUD's updates (PHASE5_PLAN row 5; the contract is bridge\hud-protocol.ts, the plugin side
// plugin\LrC-AVG.lrplugin\Hud.lua). The session loop reports each stage (session\types.ts HudSink),
// and this sends it as one hud_update carrying the whole state (payload.ts):
//   - each update is checked with hudUpdatePayloadSchema before it is sent; one that fails is a bug,
//     recorded and not sent;
//   - `seq` rises within a session in the order the updates are sent (the plugin takes only a newer
//     one, HudState.lua staleReason);
//   - one update is in flight at a time: a newer state replaces one still waiting, and a state equal
//     to the last one the HUD took is not sent again;
//   - `open: true` goes with a session's updates until the HUD takes one (decision 6: it opens by
//     itself once, at lr_begin_session);
//   - the answer to a click (`answered_click_id`, with its note) rides on the next update sent;
//   - after a reconnect the session's state is sent again (a session rides out a plugin pause, D1);
//   - a failed update is recorded and never fails a session call; it is tried again RETRY_MS later,
//     up to MAX_RETRIES times in a row (Greptile, PR #47: the HUD must not stay stale until the next
//     stage); a plugin before 0.6.0 gets none.
// [handle: tests\hud-publisher.test.ts, tests\hud-session.test.ts, against the Lightroom sim, whose
// hud_update check is the plugin's: docs\reports\phase5\hud-plugin-smoke\smoke.txt "Contract".]

import { HUD_END_STAGES, hudUpdatePayloadSchema, pluginVersionAtLeast, type BridgeClient, type HudStage, type HudUpdatePayload } from "../bridge/index.js";
import { toToolError } from "../mcp/errors.js";
import type { HudSink, Session } from "../session/index.js";
import { hudState, type HudState } from "./payload.js";

/** hud_update comes with plugin 0.6.0 (PHASE5_PLAN row 4) [handle: plugin\LrC-AVG.lrplugin\Dispatch.lua, Hud.update]. */
export const HUD_PLUGIN = "0.6.0";
/**
 * An update's answer took 2-7 ms in Lightroom [handle: vault PHASE5_PLAN.md "From row 4": "hud_update
 * round trips took 2-7 ms"]; 5 s is [inference]. While the plugin is paused the bridge client lets it
 * wait longer (silenceAllowanceMs).
 */
const UPDATE_TIMEOUT_MS = 5000;
/** How long settle() waits at most [inference: many round trips]. */
const SETTLE_MS = 2000;
/** A failed update is tried again after one heartbeat (bridge client, 2 s), at most 3 times in a row [inference]. */
const RETRY_MS = 2000;
const MAX_RETRIES = 3;

/** What the publisher records (tools-shared.ts writes it to the tool log): refused, failed and first-taken updates. */
export type HudRecord = { ok: boolean; session_id: string; seq: number; stage: HudStage; duration_ms: number; result?: unknown; error?: unknown };

/** One session's line to the HUD: its seq, whether the HUD still has to open, and the last update it took. */
type Channel = { sessionId: string; seq: number; open: boolean; taken: string | null };

export class HudPublisher implements HudSink {
  readonly stats = { sent: 0, taken: 0, not_taken: 0, failed: 0, invalid: 0 };
  private readonly client: BridgeClient;
  private readonly record: (r: HudRecord) => void;
  private channel: Channel | null = null;
  private state: HudState | null = null;
  private answer: { sessionId: string; clickId: string; note: string } | null = null;
  private inFlight = false;
  private again = false;
  private settlers: Array<() => void> = [];
  private failuresInRow = 0;
  private retryTimer: NodeJS.Timeout | null = null;

  constructor(client: BridgeClient, options: { record?: (r: HudRecord) => void } = {}) {
    this.client = client;
    this.record = options.record ?? (() => {});
    client.onStateChange((state) => {
      if (state !== "connected" || !this.channel || !this.state) return;
      // The plugin may have missed updates while the bridge was down, or restarted: send the state
      // again, unless the session has ended and the HUD took its end.
      if (!(HUD_END_STAGES as readonly string[]).includes(this.state.stage)) this.channel.taken = null;
      this.kick();
    });
  }

  stage(s: Session, stage: HudStage, options: { note?: string; open?: boolean } = {}): void {
    if (this.channel?.sessionId !== s.id) this.channel = { sessionId: s.id, seq: 0, open: false, taken: null };
    if (options.open) this.channel.open = true;
    this.state = hudState(s, stage, options.note);
    this.kick();
  }

  settle(_s: Session): Promise<void> {
    if (!this.inFlight && !this.again) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, SETTLE_MS);
      this.settlers.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /**
   * Answer a click of this session with the next update (its buttons stay off until then). False
   * when the HUD is not showing this session's updates, so no update can answer it.
   */
  answerClick(sessionId: string, clickId: string, note: string): boolean {
    if (this.channel?.sessionId !== sessionId) return false;
    this.answer = { sessionId, clickId, note };
    this.kick();
    return true;
  }

  private kick(): void {
    if (this.inFlight) {
      this.again = true;
      return;
    }
    void this.send();
  }

  private async send(): Promise<void> {
    const ch = this.channel;
    const state = this.state;
    const ready = ch && state && this.client.getState() === "connected" && pluginVersionAtLeast(this.client.hello()?.plugin_version, HUD_PLUGIN);
    const payload = ready ? this.payload(ch, state) : null;
    if (!ch || !payload) return this.settleAll();
    this.inFlight = true;
    const answer = this.answer;
    const started = performance.now();
    const base = { session_id: payload.session_id, seq: payload.seq, stage: payload.stage };
    const took = (): number => Math.round((performance.now() - started) * 10) / 10;
    try {
      this.stats.sent++;
      const result = await this.client.request("hud_update", payload, { timeoutMs: UPDATE_TIMEOUT_MS });
      this.failuresInRow = 0;
      if (result.applied) {
        this.stats.taken++;
        if (ch.taken === null && payload.open) this.record({ ok: true, ...base, duration_ms: took(), result });
        ch.taken = key(payload);
        if (payload.open) ch.open = false;
        if (answer && this.answer === answer) this.answer = null;
      } else {
        this.stats.not_taken++;
        this.record({ ok: false, ...base, duration_ms: took(), result });
      }
    } catch (err) {
      this.stats.failed++;
      this.record({ ok: false, ...base, duration_ms: took(), error: toToolError(err).body() });
      this.retryLater();
    } finally {
      this.inFlight = false;
      if (this.again) {
        this.again = false;
        void this.send();
      } else {
        this.settleAll();
      }
    }
  }

  /** The next update of the channel, or null when there is nothing new or it fails the contract. */
  private payload(ch: Channel, state: HudState): HudUpdatePayload | null {
    const answer = this.answer?.sessionId === ch.sessionId ? this.answer : null;
    const body = {
      ...state,
      ...(ch.open ? { open: true } : {}),
      ...(answer ? { answered_click_id: answer.clickId, note: answer.note } : {}),
    };
    if (key(body) === ch.taken) return null;
    const parsed = hudUpdatePayloadSchema.safeParse({ ...body, seq: ch.seq + 1 });
    if (!parsed.success) {
      this.stats.invalid++;
      this.record({ ok: false, session_id: ch.sessionId, seq: ch.seq + 1, stage: state.stage, duration_ms: 0, error: `not sent: ${parsed.error.message}` });
      return null;
    }
    ch.seq++;
    return parsed.data;
  }

  /** Try the state again after a failed update; a newer stage or a reconnect sends it sooner. */
  private retryLater(): void {
    if (this.retryTimer || ++this.failuresInRow > MAX_RETRIES) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.kick();
    }, RETRY_MS);
    this.retryTimer.unref();
  }

  private settleAll(): void {
    const waiting = this.settlers.splice(0);
    for (const settle of waiting) settle();
  }
}

/** An update's content without its seq, to tell whether the HUD has it already. */
function key(update: Record<string, unknown>): string {
  const { seq: _seq, ...rest } = update;
  return JSON.stringify(rest);
}
