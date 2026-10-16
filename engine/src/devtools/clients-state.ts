// The clients check's state across runs (issue #155 R6: "The harness saves to %TEMP%\LrC-AVG\clients\
// and resumes after a stop"). After each test of each client the check saves what it found; run again,
// it puts back what a stopped run left (a registration in a client's config, the photo mid-edit, the
// settings page's Mode) and skips what it has recorded. A finished state, or `--new`, starts a new run.
// The file is checked with zod when read (rule 01); one that fails is set aside (phase5-state.ts
// jsonStateStore).

import { z } from "zod";

export const STATE_SCHEMA_ID = "lrc-avg/clients-check-state/v1";

/** The CLI clients the check runs, in order; Codex is not one (vault ISSUE155_PLAN.md D4). */
export const CHECK_CLIENTS = ["claude-code", "opencode", "hermes", "antigravity"] as const;
export type CheckClient = (typeof CHECK_CLIENTS)[number];
export const TESTS = ["T2", "T3", "T4", "T6", "T7"] as const;
export type TestId = (typeof TESTS)[number];

const summary = z.record(z.string(), z.unknown());
export const testSchema = z.object({ at: z.string(), ok: z.boolean(), summary });
export type TestResult = z.infer<typeof testSchema>;

const clientRow = z.object({
  /** Why the client was not run ("not installed"); a client not run is never a failure (R5). */
  not_run: z.string().nullable(),
  T2: testSchema.nullable(),
  T3: testSchema.nullable(),
  T4: testSchema.nullable(),
  T6: testSchema.nullable(),
  T7: testSchema.nullable(),
});
export type ClientRow = z.infer<typeof clientRow>;

/** clients-config.ts Registration, checked again here because it is read back from the file. */
const registration = z.object({
  client: z.enum(["claude-code", "opencode", "hermes", "antigravity", "codex"]),
  method: z.enum(["append", "refused", "workspace", "global"]),
  file: z.string(),
  backup: z.string(),
  sha256: z.string(),
});

/** A photo the check wrote to (through a client) and has not yet put back, with the check's own snapshot (phase8-state.ts). */
const pending = z.object({ uuid: z.string(), label: z.string(), snapshot_id: z.string(), snapshot_name: z.string(), start: z.record(z.string(), z.unknown()) });
export type Pending = z.infer<typeof pending>;

export const clientsStateSchema = z.object({
  schema: z.literal(STATE_SCHEMA_ID),
  started_at: z.string(),
  runs: z.array(z.string()),
  /** The engine's log folder for every client of this state (LRC_AVG_LOG_DIR), kept across resumes: T7's second run finds the first run's session there. */
  log_dir: z.string(),
  /** The photo selected in Lightroom when the state began; every client edits it. */
  photo: z.object({ uuid: z.string(), filename: z.string() }).nullable(),
  clients: z.record(z.string(), clientRow),
  /** The Claude Desktop regression chat. */
  desktop: testSchema.nullable(),
  /** Client configs the check edited and has not yet restored. */
  registrations: z.array(registration),
  pending: z.array(pending),
  /** The settings page's Mode was set to "Approve each pass" for T6 and is not yet back to Autonomous. */
  mode_changed: z.boolean(),
  finished: z.boolean(),
});
export type ClientsState = z.infer<typeof clientsStateSchema>;

export const emptyRow = (): ClientRow => ({ not_run: null, T2: null, T3: null, T4: null, T6: null, T7: null });

export function newState(startedAt: string, logDir: string): ClientsState {
  return { schema: STATE_SCHEMA_ID, started_at: startedAt, runs: [], log_dir: logDir, photo: null, clients: {}, desktop: null, registrations: [], pending: [], mode_changed: false, finished: false };
}

/**
 * The state this run continues: the saved one unless it is finished or `fresh` is asked for. A new
 * state keeps what is still to put back (registrations, photos, the Mode), as phase8-state.ts does.
 */
export function stateToContinue(saved: ClientsState | null, startedAt: string, logDir: string, fresh: boolean): { state: ClientsState; resumed: boolean } {
  if (saved && !saved.finished && !fresh) return { state: saved, resumed: true };
  const keep = { registrations: saved?.registrations ?? [], pending: saved?.pending ?? [], mode_changed: saved?.mode_changed ?? false };
  return { state: { ...newState(startedAt, logDir), ...keep }, resumed: false };
}

/** The row of `id`, made when missing. */
export function rowOf(state: ClientsState, id: CheckClient): ClientRow {
  return (state.clients[id] ??= emptyRow());
}

export const testOf = (ok: boolean, s: Record<string, unknown>): TestResult => ({ at: new Date().toISOString(), ok, summary: s });

/** A client is done with a test group when its row records it or the client was not run. */
export const done = (row: ClientRow, test: TestId): boolean => row.not_run !== null || row[test] !== null;
