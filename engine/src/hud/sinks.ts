// One state, two HUDs (Phase 7 row 3, E2 and E8; spec docs\hud\lrc-avg-hud-spec-v2.md 3.2, 3.4, 2.7):
// every stage the session loop reports goes to the classic HUD (publisher.ts, the plugin's window) and
// to the Deck (deck.ts). The classic HUD gets every state as before, but opens by itself (`open: true`,
// decision 6) only when no Deck is there:
//   - at begin, with a Deck connected: the classic HUD gets the update without `open`;
//   - at begin, with none: the Deck is started (launch.ts); if none connects within WAIT_MS, the
//     classic HUD opens;
//   - no Deck to start (not installed, or started twice already this edit): the classic HUD opens at
//     once, as before Phase 7 (row 3 decision 1);
//   - the Deck lost while an edit is open (it crashed): started once more, else the classic HUD opens,
//     so the user is never left without the buttons.
// After the listener closes (the engine gave the bridge back, or exits) nothing is started.
// [handle: tests\hud-fallback.test.ts, tests\hud-launch.test.ts]

import type { HudStage } from "../bridge/index.js";
import type { HudSink, Session } from "../session/index.js";
import type { Deck } from "./deck.js";
import type { HudLauncher, HudLauncherOptions } from "./launch.js";
import type { HudPublisher } from "./publisher.js";

/** What the engine's tools take for the Deck (mcp\tools-shared.ts ToolsDeps.deck); tests shorten the times and start a simulated Deck. */
export type DeckDeps = {
  endpointPath?: string;
  pingMs?: number;
  log?: (message: string) => void;
  launcher?: HudLauncherOptions;
  waitMs?: number;
};

/** How long a started Deck has to connect [inference, spec 3.2: "waits up to 3 s"; S9-1's median cold start was 537 ms, docs\reports\phase7\S9.md "Numbers, S9b"]. */
export const WAIT_MS = 3000;

export class HudFanOut implements HudSink {
  private readonly classic: HudPublisher;
  private readonly deck: Deck;
  private readonly launcher: HudLauncher;
  private readonly waitMs: number;
  private waitTimer: NodeJS.Timeout | null = null;

  constructor(classic: HudPublisher, deck: Deck, launcher: HudLauncher, options: { waitMs?: number } = {}) {
    this.classic = classic;
    this.deck = deck;
    this.launcher = launcher;
    this.waitMs = options.waitMs ?? WAIT_MS;
    deck.onClient((connected) => {
      if (!connected) this.deckLost();
    });
  }

  stage(s: Session, stage: HudStage, options: { note?: string; open?: boolean; closeAfter?: number } = {}): void {
    const { open, ...rest } = options;
    this.deck.stage(s, stage, rest);
    if (open && !this.deck.connected() && !this.startDeck(s.id)) return this.classic.stage(s, stage, options);
    this.classic.stage(s, stage, rest);
  }

  settle(s: Session): Promise<void> {
    return this.classic.settle(s);
  }

  /** Start the Deck for this edit and open the classic HUD if it does not connect in time; false when it cannot be started. */
  private startDeck(sessionId: string): boolean {
    if (!this.deck.channel.listening() || !this.launcher.start(sessionId)) return false;
    if (this.waitTimer) clearTimeout(this.waitTimer);
    this.waitTimer = setTimeout(() => {
      this.waitTimer = null;
      if (!this.deck.connected()) this.classic.open(sessionId);
    }, this.waitMs);
    this.waitTimer.unref();
    return true;
  }

  private deckLost(): void {
    const id = this.deck.openEdit();
    if (!id || !this.deck.channel.listening()) return;
    if (!this.startDeck(id)) this.classic.open(id);
  }
}
