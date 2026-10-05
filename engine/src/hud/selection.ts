// The selection for the Deck (Phase 7 row 3, E7; spec docs\hud\lrc-avg-hud-spec-v2.md 3.5): the classic
// HUD checks the selection itself, but only while its window is open (plugin\LrC-AVG.lrplugin\Hud.lua),
// so for the Deck the engine asks Lightroom, `get_selection { max: 1 }`, at each channel ping (2 s), and
// only while an edit is open, a Deck is connected and the edit's queue is idle: Variants mode selects
// each copy itself (session\targets.ts), so a read during the engine's own work would see the engine's
// selection, not the user's. One request at a time; one refused with no_target_photo means nothing is
// selected. The Deck builds the "Target changed" sentence from the result (row 3 decision 3).
// The request's round trip in Lightroom is [unverified] (spec 13.2 item 9).
// [handle: tests\hud-selection-poll.test.ts]

import { BridgeError, type BridgeClient } from "../bridge/index.js";

/** The selected photo, or null when none is selected. */
export type Selected = { uuid: string; name: string | null } | null;

/** [inference: a get_selection answer is one short catalog read] */
const SELECTION_TIMEOUT_MS = 5000;

export class SelectionPoll {
  private readonly client: Pick<BridgeClient, "request">;
  private readonly mayPoll: () => boolean;
  private readonly edit: () => string | null;
  private readonly onResult: (selected: Selected) => void;
  private inFlight = false;
  /** How many requests were sent (tests). */
  polls = 0;

  /** `edit`: the id of the edit polled for; an answer is dropped once it changed. */
  constructor(client: Pick<BridgeClient, "request">, mayPoll: () => boolean, edit: () => string | null, onResult: (selected: Selected) => void) {
    this.client = client;
    this.mayPoll = mayPoll;
    this.edit = edit;
    this.onResult = onResult;
  }

  /** Ask once, unless a request is still out or polling is not allowed now. */
  tick(): void {
    if (this.inFlight || !this.mayPoll()) return;
    // An answer counts only for the edit that asked (Greptile, PR #85: a late answer must not reach the next edit).
    const edit = this.edit();
    const current = (): boolean => this.mayPoll() && this.edit() === edit;
    this.inFlight = true;
    this.polls++;
    this.client.request("get_selection", { max: 1 }, { timeoutMs: SELECTION_TIMEOUT_MS }).then(
      (r) => {
        const p = r.photos[0];
        // The engine's own work may have started meanwhile: then the answer may show its selection.
        if (current()) this.onResult(p?.uuid ? { uuid: p.uuid, name: p.copy_name ?? p.filename ?? null } : null);
      },
      (err: unknown) => {
        if (err instanceof BridgeError && err.code === "no_target_photo" && current()) this.onResult(null);
      },
    ).finally(() => {
      this.inFlight = false;
    });
  }
}
