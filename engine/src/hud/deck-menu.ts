// The menu items and the Deck (Phase 7 row 5; spec docs\hud\lrc-avg-hud-spec-v2.md D1, "Known conflict";
// Q4 [stated: Jim, 2026-10-05, "Show Deck, keep keys (Recommended)"]). Two jobs:
//   - tell the plugin whether a Deck is connected (bridge command hud_deck, plugin 0.18.0), so its
//     File > Plug-in Extras items leave the classic window closed while one is. Sent at every Deck
//     connect and loss, and again at every bridge (re)connection, since a restarted plugin starts with
//     "no Deck" (Hud.markUnknown). One command in flight at a time; when the Deck changed meanwhile, the
//     newest value follows. A failed one is tried again RETRY_MS later, up to MAX_RETRIES in a row.
//   - "Show Vision Gateway HUD" sends hud_show { session_id }: for the open edit, the Deck gets `reveal`
//     and shows itself opened, without the keyboard (hud\ui\visibility.ts onReveal). A Deck older than
//     REVEAL_HUD, or another edit than the open one, gets nothing; the tool log says why.
// [handle: tests\hud-deck-menu.test.ts]

import { HUD_DECK_PLUGIN, HUD_SHOW_EVENT, hudShowSchema, pluginVersionAtLeast, type BridgeClient, type EventEnvelope } from "../bridge/index.js";
import { toToolError } from "../mcp/errors.js";
import { REVEAL_HUD } from "./channel-protocol.js";
import type { Deck } from "./deck.js";

/** What this records for the tool log. */
export type DeckMenuRecord = { ok: boolean; what: "hud_deck" | "hud_show"; connected?: boolean; session_id?: string; error?: string };

/** hud_deck's answer, as hud_update's [inference: the same non-yielding handler, publisher.ts UPDATE_TIMEOUT_MS]. */
const TIMEOUT_MS = 5000;
/** As publisher.ts: one heartbeat between tries, 3 in a row [inference]. */
const RETRY_MS = 2000;
const MAX_RETRIES = 3;

export class DeckMenu {
  private readonly client: BridgeClient;
  private readonly deck: Deck;
  private readonly record: (r: DeckMenuRecord) => void;
  private readonly retryMs: number;
  /** The value the plugin last answered with; null when unknown (a new bridge connection). */
  private told: boolean | null = null;
  private inFlight = false;
  private failures = 0;
  private retryTimer: NodeJS.Timeout | null = null;

  constructor(client: BridgeClient, deck: Deck, options: { record?: (r: DeckMenuRecord) => void; retryMs?: number } = {}) {
    this.client = client;
    this.deck = deck;
    this.record = options.record ?? (() => {});
    this.retryMs = options.retryMs ?? RETRY_MS;
    deck.onClient(() => {
      this.failures = 0;
      this.tell();
    });
    client.onStateChange((state) => {
      if (state !== "connected") return;
      this.told = null;
      this.failures = 0;
      this.tell();
    });
    client.onEvent((e) => this.event(e));
  }

  private ready(): boolean {
    return this.client.getState() === "connected" && pluginVersionAtLeast(this.client.hello()?.plugin_version, HUD_DECK_PLUGIN);
  }

  private tell(): void {
    if (this.inFlight || this.retryTimer || !this.ready()) return;
    const connected = this.deck.connected();
    if (connected === this.told) return;
    this.inFlight = true;
    this.client.request("hud_deck", { connected }, { timeoutMs: TIMEOUT_MS }).then(
      (result) => {
        this.inFlight = false;
        this.failures = 0;
        // What was sent counts as told, so a plugin answering otherwise (a bug) is recorded, not sent to again and again.
        this.told = connected;
        this.record({ ok: result.connected === connected, what: "hud_deck", connected, ...(result.connected === connected ? {} : { error: `the plugin holds ${String(result.connected)}` }) });
        this.tell(); // the Deck may have changed meanwhile
      },
      (err: unknown) => {
        this.inFlight = false;
        this.told = null;
        this.record({ ok: false, what: "hud_deck", connected, error: toToolError(err).code });
        if (++this.failures > MAX_RETRIES) return; // the next Deck change or bridge connection tries again
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          this.tell();
        }, this.retryMs);
        this.retryTimer.unref();
      },
    );
  }

  private event(e: EventEnvelope): void {
    if (e.name !== HUD_SHOW_EVENT) return;
    const parsed = hudShowSchema.safeParse(e.payload);
    if (!parsed.success) return this.record({ ok: false, what: "hud_show", error: parsed.error.message });
    const sid = parsed.data.session_id;
    const no = (error: string): void => this.record({ ok: false, what: "hud_show", session_id: sid, error });
    if (this.deck.openEdit() !== sid) return no("not the open edit");
    if (!pluginVersionAtLeast(this.deck.channel.clientVersion(), REVEAL_HUD)) return no(`no Deck that knows reveal (${this.deck.channel.clientVersion() ?? "none"})`);
    if (!this.deck.channel.send({ type: "reveal", session_id: sid })) return no("the Deck is gone");
    this.record({ ok: true, what: "hud_show", session_id: sid });
  }
}
