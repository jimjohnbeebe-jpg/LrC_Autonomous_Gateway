// The simulated HUD (plugin\LrC-AVG.lrplugin\Hud.lua update(), HudState.lua): hud_update checked
// against the engine's schema, which the plugin's own check agrees with on the smoke's cases [handle:
// docs\reports\phase5\hud-plugin-smoke\smoke.txt, check C1], then HudState.staleReason: within a
// session only a newer seq is taken, and a session a newer one replaced is never taken again. The
// window opens for `open: true` when it is not open, as Hud.show does. And the events the HUD's
// buttons and menu items send (hudEvent), each with a new click_id, as Hud.lua's click does.

import { hudUpdatePayloadSchema, type HudEventName, type HudUpdatePayload } from "../../src/bridge/index.js";
import type { FakePlugin, FakeReply } from "./fake-plugin.js";

export class SimHud {
  /** Every update taken, in order (the last is the HUD's state). */
  readonly taken: HudUpdatePayload[] = [];
  readonly notTaken: Array<{ update: HudUpdatePayload; reason: string }> = [];
  /** Updates refused as bad_request (the engine checks them first, so none are expected). */
  readonly refused: unknown[] = [];
  shown = false;
  opened = 0;
  private readonly seen = new Set<string>();

  update(p: Record<string, unknown>): FakeReply {
    const parsed = hudUpdatePayloadSchema.safeParse(p);
    if (!parsed.success) {
      this.refused.push(p);
      return { ok: false, error: { code: "bad_request", message: parsed.error.message, recoverable: false } };
    }
    const s = parsed.data;
    const current = this.taken.at(-1);
    const stale =
      current && current.session_id === s.session_id
        ? s.seq <= current.seq
          ? `update ${s.seq} is not newer than ${current.seq}`
          : null
        : this.seen.has(s.session_id)
          ? `session ${s.session_id} was replaced by a newer one`
          : null;
    if (stale) {
      this.notTaken.push({ update: s, reason: stale });
      return { ok: true, payload: { applied: false, shown: this.shown, opened: false, reason: stale } };
    }
    this.seen.add(s.session_id);
    this.taken.push(s);
    const opened = s.open === true && !this.shown;
    if (opened) {
      this.shown = true;
      this.opened++;
    }
    return { ok: true, payload: { applied: true, shown: this.shown, opened } };
  }

  /** The HUD's state now. */
  last(): HudUpdatePayload | undefined {
    return this.taken.at(-1);
  }
}

let clicks = 0;

/** Send a HUD event as the plugin does after a click; returns its click_id (or the one given). */
export function hudEvent(plugin: FakePlugin, name: HudEventName, payload: Record<string, unknown>, clickId?: string): string {
  const click_id = clickId ?? `click-${++clicks}`;
  plugin.send({ id: `evt-${click_id}`, type: "evt", name, ts: new Date().toISOString(), payload: { seq_seen: 1, source: "hud", ...payload, click_id } });
  return click_id;
}
