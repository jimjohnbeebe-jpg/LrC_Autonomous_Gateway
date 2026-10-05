// The Deck's side of the HUD (Phase 7 row 3; spec docs\hud\lrc-avg-hud-spec-v2.md 3.2-3.7, D5 E1-E4,
// E6, E7, E10): the state the session loop reports, sent to the Deck over the HUD channel
// (hud\channel.ts), and what the Deck sends back.
//   - The state is the Lua HUD's (payload.ts hudState), plus the copies, `picked` and rows
//     (extras.ts), Lightroom's state, and the selection (selection.ts) while the edit is open. It is
//     checked with hudChannelStateSchema before it is sent; one that fails is a bug, recorded and not sent.
//   - The whole state every time, only when it changed; `seq` rises by 1 within an edit and starts at 1
//     for each edit. A newly taken client gets it at once. Every end stage carries `close_after`
//     (the Deck hides 10 s later, spec 2.7 rule 5), as the classic HUD's does (publisher.ts).
//   - At each channel ping (2 s) the state is checked again (Lightroom's state may have changed) and
//     the selection polled.
//   - A click from the Deck goes to HudEvents (events.ts, `via: "channel"`), and its answer comes back
//     here: sent at once as `answer`, and folded into the next state as answered_click_id and note.
//   - `get_thumb` is answered with the copy's thumbnail (thumbs.ts), or null when the key is not a
//     current one; thumbnails are made only while the edit is open.
// The fan-out to both HUDs, and starting the Deck, are sinks.ts's.
// [handle: tests\hud-channel.test.ts, tests\hud-channel-events.test.ts, tests\hud-thumbs.test.ts,
// tests\hud-selection-poll.test.ts]

import { HUD_END_STAGES, type BridgeClient, type HudStage } from "../bridge/index.js";
import type { Session } from "../session/index.js";
import { HudChannel } from "./channel.js";
import { hudChannelStateSchema, type DeckMessage, type HudChannelState } from "./channel-protocol.js";
import { deckCopies, deckRows, fit, lightroomState } from "./extras.js";
import { hudState } from "./payload.js";
import { END_CLOSE_S } from "./publisher.js";
import { SelectionPoll, type Selected } from "./selection.js";
import { ThumbCache } from "./thumbs.js";

/** What the Deck records for the tool log: clients taken and lost, and states that failed the schema. */
export type DeckRecord = { ok: boolean; what: "client" | "state"; connected?: boolean; session_id?: string; seq?: number; error?: string };

export type DeckOptions = {
  client: BridgeClient;
  engineVersion: string;
  /** The open edit's id, or null (the welcome's `session_id`). */
  openSession: () => string | null;
  /** An operation of the edit's queue runs now (session\manager.ts busy). */
  busy: () => boolean;
  endpointPath?: string;
  pingMs?: number;
  log?: (message: string) => void;
  record?: (r: DeckRecord) => void;
};

type DeckEvent = Extract<DeckMessage, { type: "event" }>;
type Base = Omit<HudChannelState, "lightroom" | "selection" | "answered_click_id">;

const ended = (stage: string): boolean => (HUD_END_STAGES as readonly string[]).includes(stage);

export class Deck {
  readonly channel: HudChannel;
  readonly thumbs = new ThumbCache();
  readonly poll: SelectionPoll;
  readonly stats = { sent: 0, invalid: 0 };
  private readonly opts: DeckOptions;
  private readonly record: (r: DeckRecord) => void;
  private readonly clientListeners = new Set<(connected: boolean) => void>();
  private eventListener: (e: DeckEvent) => void = () => {};
  private session: Session | null = null;
  private base: Base | null = null;
  private seq = 0;
  private sent: string | null = null;
  private answer: { clickId: string; note: string } | null = null;
  /** undefined until the first poll of this edit answered. */
  private selected: Selected | undefined = undefined;

  constructor(options: DeckOptions) {
    this.opts = options;
    this.record = options.record ?? (() => {});
    const { client } = options;
    this.channel = new HudChannel({
      engineVersion: options.engineVersion,
      ...(options.endpointPath ? { endpointPath: options.endpointPath } : {}),
      ...(options.pingMs ? { pingMs: options.pingMs } : {}),
      ...(options.log ? { log: options.log } : {}),
      welcome: () => ({ session_id: options.openSession(), lightroom: lightroomState(client) }),
      onClient: (connected) => this.clientChanged(connected),
      onMessage: (m) => void this.message(m),
      onTick: () => {
        this.push();
        this.poll.tick();
      },
    });
    const polling = (): boolean => this.channel.connected() && this.editOpen() && !options.busy();
    this.poll = new SelectionPoll(client, polling, () => this.session?.id ?? null, (sel) => {
      this.selected = sel;
      this.push();
    });
    client.onStateChange(() => this.push());
  }

  open(): Promise<void> {
    return this.channel.open();
  }

  close(): void {
    this.channel.close();
  }

  connected(): boolean {
    return this.channel.connected();
  }

  /** The id of the edit the Deck shows while it is open, else null. */
  openEdit(): string | null {
    return this.editOpen() ? (this.session?.id ?? null) : null;
  }

  onClient(listener: (connected: boolean) => void): void {
    this.clientListeners.add(listener);
  }

  onEvent(listener: (e: DeckEvent) => void): void {
    this.eventListener = listener;
  }

  /** The session loop reported `stage` (sinks.ts passes every stage on). Never throws, never waits. */
  stage(s: Session, stage: HudStage, options: { note?: string; closeAfter?: number } = {}): void {
    if (this.session?.id !== s.id) {
      this.seq = 0;
      this.sent = null;
      this.answer = null;
      this.selected = undefined;
      this.thumbs.clear(s.id);
    }
    this.session = s;
    const closeAfter = options.closeAfter ?? (ended(stage) ? END_CLOSE_S : undefined);
    this.base = {
      ...hudState(s, stage, options.note, closeAfter),
      ...(s.mode === "variants" ? { copies: deckCopies(s), picked: s.picked } : {}),
      rows: deckRows(s),
    };
    if (ended(stage)) this.thumbs.clear();
    this.push();
  }

  /** Answer a click from the Deck: at once, and in the next state when it is of the edit shown. False without a client. */
  answerClick(sessionId: string, clickId: string, note: string): boolean {
    if (!this.channel.send({ type: "answer", click_id: clickId, note })) return false;
    if (this.session?.id === sessionId) {
      this.answer = { clickId, note };
      this.push();
    }
    return true;
  }

  private editOpen(): boolean {
    return this.base !== null && !ended(this.base.stage) && this.opts.openSession() === this.base.session_id;
  }

  private clientChanged(connected: boolean): void {
    this.record({ ok: true, what: "client", connected });
    if (connected) {
      this.sent = null;
      this.push();
    }
    for (const listener of this.clientListeners) listener(connected);
  }

  /** Send the state if a client is there and it changed since the last one sent. */
  private push(): void {
    const base = this.base;
    if (!base || !this.channel.connected()) return;
    const answer = this.answer;
    const body = {
      ...base,
      lightroom: lightroomState(this.opts.client),
      ...this.selection(base),
      ...(answer ? { answered_click_id: answer.clickId, note: answer.note } : {}),
    };
    const key = JSON.stringify(body);
    if (key === this.sent) return;
    const parsed = hudChannelStateSchema.safeParse(body);
    if (!parsed.success) {
      this.stats.invalid++;
      this.sent = key; // not again until the state changes
      this.record({ ok: false, what: "state", session_id: base.session_id, seq: this.seq + 1, error: `not sent: ${parsed.error.message}` });
      return;
    }
    this.seq++;
    this.channel.send({ type: "state", seq: this.seq, state: parsed.data });
    this.stats.sent++;
    this.sent = key;
    if (answer && this.answer === answer) this.answer = null;
  }

  /** The `selection` field while the edit is open and a poll has answered. */
  private selection(base: Base): Pick<HudChannelState, "selection"> {
    if (this.selected === undefined || !this.editOpen()) return {};
    const sel = this.selected;
    const photos = base.session_photos ?? [base.target.uuid];
    return { selection: { uuid: sel?.uuid ?? null, name: sel?.name ? fit(sel.name) : null, in_edit: sel !== null && photos.includes(sel.uuid) } };
  }

  private async message(m: Exclude<DeckMessage, { type: "hello" | "pong" }>): Promise<void> {
    if (m.type === "event") return this.eventListener(m);
    const jpeg = await this.thumbs.get(this.editOpen() ? this.session : null, m.key).catch(() => null);
    this.channel.send({ type: "thumb", key: m.key, jpeg_b64: jpeg ? jpeg.toString("base64") : null });
  }
}
