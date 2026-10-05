// Showing a copy in Lightroom from the Deck (Phase 7 row 4a, spec docs\hud\lrc-avg-hud-spec-v2.md D5
// E12) [stated: Jim, 2026-10-05, Q11 "Choose, confirm + E12"]: choosing a copy's card on the Deck
// selects that copy in Lightroom, so the user can look at it there before the pick, which stays a
// separate click (hud_pick). Only while the edit waits for the pick (pick.ts awaitingPick). It runs in
// the session's queue, after the running operation, and checks again when its turn comes that the
// edit still waits for the pick; choices made while one waits replace it, so only the last is
// selected. It selects with the identity check every Variants call uses (targets.ts selectExpect) and
// leaves the photo the session works on (`s.active`) alone: each later call selects its own copy first
// (targets.ts focus). Nothing is answered to the Deck: its selection poll (hud\selection.ts) shows the
// result, and the copies count as in the edit.
// [handle: tests\hud-show-copy.test.ts, against the Lightroom sim; in Lightroom [unverified] until
// PHASE7_PLAN row 6.]

import { toToolError } from "../mcp/errors.js";
import type { ActionHost } from "./hud-actions.js";
import { awaitingPick } from "./pick.js";
import { selectExpect, variant } from "./targets.js";
import type { Session, VariantId } from "./types.js";

/** What happened to a choice, for the tool log: refused, queued, done or failed. */
export type ShowRecord = { ok: boolean; session_id: string; variant: VariantId; result: string; error?: string };

type ShowHost = Pick<ActionHost, "ctx" | "session" | "queue">;

/** The choice waiting in the queue, per session. */
const waiting = new WeakMap<Session, VariantId>();

/** Select copy `v` of the open edit in Lightroom; `report` gets the outcome now and, once it ran, again. */
export function showCopy(host: ShowHost, sessionId: string, v: VariantId, report: (r: ShowRecord) => void): void {
  const r = (ok: boolean, result: string, error?: string): void => report({ ok, session_id: sessionId, variant: v, result, ...(error ? { error } : {}) });
  const s = host.session();
  if (!s || s.id !== sessionId) return r(false, "refused: the edit is not open");
  if (!awaitingPick(s)) return r(false, "refused: the edit is not waiting for a pick");
  if (!variant(s, v)) return r(false, "refused: the edit has no such copy");
  const replaces = waiting.has(s);
  waiting.set(s, v);
  r(true, replaces ? "queued, replacing an earlier choice" : "queued");
  if (replaces) return;
  host.queue(async () => {
    const latest = waiting.get(s) ?? v;
    waiting.delete(s);
    const done = (ok: boolean, result: string, error?: string): void => report({ ok, session_id: sessionId, variant: latest, result, ...(error ? { error } : {}) });
    const t = variant(s, latest);
    if (host.session() !== s || !awaitingPick(s) || !t) return done(false, "dropped: the edit no longer waits for a pick");
    try {
      await host.ctx.deps.client.request("select_photo", { uuid: t.uuid, expect: selectExpect(s, t) });
      done(true, "selected");
    } catch (err) {
      done(false, "failed", toToolError(err).code);
    }
  });
}
