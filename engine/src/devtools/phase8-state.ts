// The Phase 8 check's state across runs (PHASE8_PLAN row 6: "Resumable, puts every photo back"). After
// each photo of Part 1, each intent of Part 2 and each later part, the check saves what it found; run
// again after a stop, it skips what it has recorded and goes on. Every photo the check writes to is
// listed under `pending` with the check's own snapshot until it is back, so a run that stops midway
// puts it back first. A finished state, or `--new`, starts a new run. The file is checked with zod when
// read (rule 01); one that fails is set aside (phase5-state.ts jsonStateStore).

import { z } from "zod";

export const STATE_SCHEMA_ID = "lrc-avg/phase8-check-state/v1";

const summary = z.record(z.string(), z.unknown());
const part = z.object({ at: z.string(), ok: z.boolean(), summary });
const pending = z.object({ uuid: z.string(), label: z.string(), snapshot_id: z.string(), snapshot_name: z.string(), start: z.record(z.string(), z.unknown()) });

export const checkStateSchema = z.object({
  schema: z.literal(STATE_SCHEMA_ID),
  started_at: z.string(),
  /** The runs that worked on this state, by their time stamps (each has its own results file). */
  runs: z.array(z.string()),
  /** Part 1, one entry per photo of the collection. */
  photos: z.array(part.extend({ uuid: z.string(), label: z.string() })),
  /** Part 2, one entry per bundled intent. */
  intents: z.array(part.extend({ intent: z.string() })),
  /** Part 3, the raw→rendered sync. */
  cross: part.nullable(),
  /** The preset Part 3 made from the JPEG, which Part 4 applies by Jim's click. */
  kept_preset: z.object({ name: z.string(), path: z.string(), uuid: z.string(), written: z.array(z.string()), source: z.record(z.string(), z.unknown()) }).nullable(),
  /** Part 4, the restart and the click. */
  preset: part.nullable(),
  /** Part 5, the Claude Desktop chat. */
  chat: part.nullable(),
  /** Photos the check has written to and not yet put back, each with its own snapshot. */
  pending: z.array(pending),
  finished: z.boolean(),
});
export type CheckState = z.infer<typeof checkStateSchema>;
export type Pending = z.infer<typeof pending>;
export type Part = z.infer<typeof part>;

export function newState(startedAt: string): CheckState {
  return { schema: STATE_SCHEMA_ID, started_at: startedAt, runs: [], photos: [], intents: [], cross: null, kept_preset: null, preset: null, chat: null, pending: [], finished: false };
}

/**
 * The state this run continues: the saved one unless it is finished or `fresh` is asked for. A new
 * state keeps the saved one's pending photos, so they are still put back.
 */
export function stateToContinue(saved: CheckState | null, startedAt: string, fresh: boolean): { state: CheckState; resumed: boolean } {
  if (saved && !saved.finished && !fresh) return { state: saved, resumed: true };
  return { state: { ...newState(startedAt), pending: saved?.pending ?? [] }, resumed: false };
}

export const partOf = (ok: boolean, s: Record<string, unknown>): Part => ({ at: new Date().toISOString(), ok, summary: s });
