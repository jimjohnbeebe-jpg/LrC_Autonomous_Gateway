// The open session as the other tools see it (lr_get_preview, lr_get_metrics, get_context; manager.ts
// current() and viewOf()): its photos, and the one the last call worked on.

import type { Metrics } from "../metrics/index.js";
import { allTargets } from "./targets.js";
import type { Session, TargetId } from "./types.js";

export type SessionView = {
  id: string;
  mode: Session["mode"];
  /** The photo the last call worked on (Converge mode: the master; after a pick: the pick). */
  target: TargetId;
  uuid: string;
  filename: string | null;
  /** Every photo of the session, the master first, with its pass. */
  photos: Array<{ target: TargetId; uuid: string; pass: string }>;
  pass: string;
  last: { metrics: Metrics; hash: string; width: number; height: number } | null;
};

/** The session seen from its photo `id` (the active one when it has no such photo). */
export function sessionView(s: Session, id: TargetId): SessionView {
  const t = allTargets(s).find((x) => x.id === id) ?? s.active;
  return {
    id: s.id,
    mode: s.mode,
    target: t.id,
    uuid: t.uuid,
    filename: t.filename,
    photos: allTargets(s).map((x) => ({ target: x.id, uuid: x.uuid, pass: `${x.passes}/${s.maxPasses}` })),
    pass: `${t.passes}/${s.maxPasses}`,
    last: t.last ? { metrics: t.last.metrics, hash: t.last.hash, width: t.last.width, height: t.last.height } : null,
  };
}
