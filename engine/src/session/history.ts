// What this engine run remembers of the sessions that ended on each photo, by the master's uuid: their regions
// (issue #163, lr_begin_session keep_regions) and how many were accepted (issue #167, the begin result's advisory).
// ponytail: in memory only, so an engine restart forgets it; the session logs hold both (regions, outcome) if it
// must survive one.

import { ToolError } from "../mcp/errors.js";
import { setRegions } from "./regions.js";
import type { RegionArgs, Session, SessionOutput } from "./types.js";

type Ended = { accepted: number; regions: RegionArgs["regions"] };

/** The advisory from the third session on a photo, after two accepted ones: Argon's sessions 3 to 8 each re-locked the same numbers (issue #167). */
const ADVISORY_AFTER = 2;

/** SESSION_ALREADY_ACTIVE: lr_begin_session and the tools that run only between sessions (manager.ts whenIdle). */
export function activeError(s: Session, what: string): ToolError {
  return new ToolError("SESSION_ALREADY_ACTIVE", `A session is already open on "${s.master.filename ?? s.master.uuid}" (${s.id}). ${what}`, false, { session_id: s.id });
}

export class PhotoHistory {
  private readonly byPhoto = new Map<string, Ended>();

  /** A session closed (manager.ts close): its outcome and its regions, the last set it had (none after `[]`). */
  ended(s: Session): void {
    const e = this.byPhoto.get(s.master.uuid) ?? { accepted: 0, regions: [] };
    if (s.log.outcome === "accept") e.accepted++;
    e.regions = s.regions.map(({ kind, label, box, preserve }) => ({ kind, label, box, preserve }));
    this.byPhoto.set(s.master.uuid, e);
  }

  /** Issue #167: a warning, never a refusal, once this photo had ADVISORY_AFTER accepted sessions in this engine run. */
  advisory(uuid: string): string | null {
    const n = this.byPhoto.get(uuid)?.accepted ?? 0;
    if (n < ADVISORY_AFTER) return null;
    return (
      `This photo already had ${n} accepted sessions in this engine run. Another session that only re-tunes numbers already within ` +
      "the guardrails (p99, clipping) rarely changes how the photo looks: judge the preview, and ask the user what they want changed before more passes."
    );
  }

  /** The begin result's `advisory`, and with keep_regions the last session's regions on this photo set again on pass 0's preview (regions.ts). */
  async onBegin(s: Session, keepRegions: boolean, out: SessionOutput): Promise<SessionOutput> {
    const advisory = this.advisory(s.master.uuid);
    const kept = keepRegions ? await this.keepRegions(s) : null;
    if (!advisory && !kept) return out;
    return { ...out, json: { ...out.json, ...(advisory ? { advisory } : {}), ...(kept ? { regions_kept: kept } : {}) } };
  }

  private async keepRegions(s: Session): Promise<Record<string, unknown>> {
    const regions = this.byPhoto.get(s.master.uuid)?.regions ?? [];
    if (regions.length === 0) return { regions: [], note: "No earlier session on this photo in this engine run ended with regions: none kept." };
    try {
      const r = (await setRegions(s, { session_id: s.id, regions })).json;
      return { regions: r["regions"], preserved: r["preserved"], note: `${String(r["note"])} The boxes are the last session's, in the preview's frame: set them again after a crop change.` };
    } catch (err) {
      return { regions: [], note: `The last session's regions were not kept: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}
