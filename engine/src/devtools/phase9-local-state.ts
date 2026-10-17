// The Phase 9 local-install check's state across runs (`npm run phase9:local`; report
// docs\reports\phase9\local-install.md). After every step the check saves what it found; run again after
// a stop, it skips the steps that are recorded and goes on with the first one that is not, or that
// stopped the run. A finished state, or `--new`, starts a new run. The file is checked with zod when read
// (rule 01); an unreadable one is set aside by jsonStateStore (phase5-state.ts).

import { z } from "zod";

export const STATE_SCHEMA_ID = "lrc-avg/phase9-local-state/v1";

/** In run order. The builds come first, so the long wait happens before Jim's development setup is moved aside. */
export const STEP_IDS = ["build", "park", "install", "lightroom", "chat", "upgrade", "uninstall_keep", "reinstall_clear", "restore"] as const;
export type StepId = (typeof STEP_IDS)[number];

const check = z.object({ check: z.string(), ok: z.boolean(), detail: z.string() });
const answer = z.object({ question: z.string(), answer: z.enum(["y", "n", "no answer"]), expected: z.enum(["y", "n"]).nullable() });

export const stepRecordSchema = z.object({
  id: z.enum(STEP_IDS),
  at: z.string(),
  /** Every check of the step passed. */
  ok: z.boolean(),
  /** The step ended the run (a later step cannot mean anything); the next run does it again. */
  stopped: z.boolean(),
  checks: z.array(check),
  answers: z.array(answer),
  notes: z.array(z.string()),
});
export type StepRecord = z.infer<typeof stepRecordSchema>;

export const localStateSchema = z.object({
  schema: z.literal(STATE_SCHEMA_ID),
  started_at: z.string(),
  /** The runs that worked on this state, by their time stamps (each has its own results file). */
  runs: z.array(z.string()),
  steps: z.array(stepRecordSchema),
  finished: z.boolean(),
});
export type LocalState = z.infer<typeof localStateSchema>;

export function newState(startedAt: string): LocalState {
  return { schema: STATE_SCHEMA_ID, started_at: startedAt, runs: [], steps: [], finished: false };
}

/** The saved state unless it is finished, absent, or `fresh` is asked for. */
export function stateToContinue(saved: LocalState | null, startedAt: string, fresh: boolean): { state: LocalState; resumed: boolean } {
  if (saved && !saved.finished && !fresh) return { state: saved, resumed: true };
  return { state: newState(startedAt), resumed: false };
}

/** The first step with no record, or whose record stopped the run; null when every step is recorded. */
export function nextStep(state: LocalState): StepId | null {
  return STEP_IDS.find((id) => !state.steps.some((s) => s.id === id && !s.stopped)) ?? null;
}

/** Puts the record in the state, replacing an earlier record of the same step. */
export function recordStep(state: LocalState, record: StepRecord): void {
  const i = state.steps.findIndex((s) => s.id === record.id);
  if (i >= 0) state.steps[i] = record;
  else state.steps.push(record);
}

export const recordOf = (state: LocalState, id: StepId): StepRecord | undefined => state.steps.find((s) => s.id === id);

/** WORKED, FAILED or NOT FINISHED, and "put back": the development setup is back (or was never moved). */
export function headlineOf(state: LocalState, parkFileExists: boolean): { headline: "WORKED" | "FAILED" | "NOT FINISHED"; putBack: boolean } {
  const restore = recordOf(state, "restore");
  const putBack = !parkFileExists && (restore ? restore.ok : true);
  if (nextStep(state) !== null) return { headline: "NOT FINISHED", putBack };
  return { headline: state.steps.every((s) => s.ok) ? "WORKED" : "FAILED", putBack };
}
