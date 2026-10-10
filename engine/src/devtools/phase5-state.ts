// The Phase 5 check's state across runs (PHASE5_PLAN decision 8: "run again after a stop, it continues
// with the next fixture"). After Part 1, the approve chat, the page set back to Autonomous and each
// fixture's chat, the check saves what it found; run again, it skips what passed or was recorded and
// goes on. A Part 1 that failed is run again in full (its sessions depend on each other). A finished
// state, or `--new`, starts a new run. The file is checked with zod when read (rule 01): one that
// fails is set aside, not trusted.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

export const STATE_SCHEMA_ID = "lrc-avg/phase5-check-state/v1";

const summary = z.record(z.string(), z.unknown());
const part = z.object({ at: z.string(), ok: z.boolean(), summary });

export const checkStateSchema = z.object({
  schema: z.literal(STATE_SCHEMA_ID),
  started_at: z.string(),
  /** The runs that worked on this state, by their time stamps (each has its own results file). */
  runs: z.array(z.string()),
  part1: part.nullable(),
  approve_chat: part.nullable(),
  /** The settings page back to Autonomous before the six chats (read back with get_prefs). */
  page_autonomous: z.boolean(),
  chats: z.array(part.extend({ fixture: z.string() })),
  /**
   * The chat under way, saved before the check gives the bridge to Claude Desktop: its photo, the
   * check's own snapshot of it and its settings then. A run that stops during the chat leaves it here,
   * and the next run puts the photo back with that snapshot before anything else (phase5-chat-flow.ts).
   */
  pending_chat: z.object({ label: z.string(), fixture: z.string(), uuid: z.string(), snapshot_id: z.string(), start: z.record(z.string(), z.unknown()) }).nullable(),
  /** Every photo the check knows, so a resumed run reads them back after each click too (phase5-readback.ts restoreKnown). */
  known_photos: z.array(z.object({ uuid: z.string(), label: z.string() })),
  finished: z.boolean(),
});
export type CheckState = z.infer<typeof checkStateSchema>;
export type PendingChat = NonNullable<CheckState["pending_chat"]>;

export type StateStore<T = CheckState> = {
  /** The saved state, or null for none (or one set aside as unreadable). */
  load(): T | null;
  save(state: T): void;
};

export function newState(startedAt: string): CheckState {
  return { schema: STATE_SCHEMA_ID, started_at: startedAt, runs: [], part1: null, approve_chat: null, page_autonomous: false, chats: [], pending_chat: null, known_photos: [], finished: false };
}

/**
 * The state this run continues: the saved one unless it is finished, unreadable, or `fresh` is asked
 * for. A new state keeps the saved one's chat under way, so its photo is still put back.
 */
export function stateToContinue(store: StateStore, startedAt: string, fresh: boolean): { state: CheckState; resumed: boolean } {
  const saved = store.load();
  if (saved && !saved.finished && !fresh) return { state: saved, resumed: true };
  return { state: { ...newState(startedAt), pending_chat: saved?.pending_chat ?? null }, resumed: false };
}

/** The state in a JSON file; an unreadable one is renamed `<file>.unreadable-<time>` and treated as none. */
export function fileStateStore(file: string): StateStore {
  return jsonStateStore(file, checkStateSchema);
}

/** A state of any schema in a JSON file, as fileStateStore (the Phase 8 check's too, phase8-state.ts). */
export function jsonStateStore<T>(file: string, schema: z.ZodType<T>): StateStore<T> {
  return {
    load() {
      if (!existsSync(file)) return null;
      try {
        return schema.parse(JSON.parse(readFileSync(file, "utf8")));
      } catch {
        renameSync(file, `${file}.unreadable-${new Date().toISOString().replace(/[:.]/g, "-")}`);
        return null;
      }
    },
    // Written to a temporary file, then renamed over the state: a write cut off midway leaves the
    // previous state, whose pending chat may be the only record of a photo to put back (Greptile,
    // PR #49). renameSync replaces an existing file on Windows [handle: Claude Code, 2026-09-30, node
    // v24.11.1 win32: writing "new" to a.json.writing and renaming it over a.json holding "old" printed
    // "after rename over an existing file: new ; temp left: false"; tests\phase5-check-units.test.ts
    // "saves the state by replacing it whole"].
    save(state) {
      mkdirSync(path.dirname(file), { recursive: true });
      const temp = `${file}.writing`;
      writeFileSync(temp, JSON.stringify(schema.parse(state), null, 2) + "\n");
      renameSync(temp, file);
    },
  };
}

/** The state in memory (the tests). */
export function memoryStateStore(initial: CheckState | null = null): StateStore & { saved: CheckState | null } {
  return memoryStore(checkStateSchema, initial);
}

/** A state of any schema in memory (the tests). */
export function memoryStore<T>(schema: z.ZodType<T>, initial: T | null = null): StateStore<T> & { saved: T | null } {
  const store = {
    saved: initial,
    load: () => (store.saved ? schema.parse(structuredClone(store.saved)) : null),
    save: (state: T) => {
      store.saved = schema.parse(structuredClone(state));
    },
  };
  return store;
}
