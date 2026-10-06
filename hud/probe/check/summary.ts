// The Phase 7 check's lines and verdict (row 6, `npm run phase7:check`; plan in the vault PHASE7_PLAN.md
// row 6, approved [stated: Jim, 2026-10-06, "go"]). Pure: the catalogue of checks, the saved state's
// schema, and acceptance(state) -> per line YES / NO / NOT RUN, the spec 9 budgets, and the headline.
// Spec docs\hud\lrc-avg-hud-spec-v2.md 11.1 as 2.7 amends it (A20 dropped while E5 is deferred), and
// section 9's six budgets as PHASE7_PLAN "Acceptance" lists them. Each line passes only when every one
// of its checks is YES: Jim's answers, and where the logs can show it, the log checks beside them. The
// budgets must be measured (PHASES.md Phase 7: "the section 9 budgets are measured"); one over its
// target is named in the headline, and the verdict on it is Jim's.
import { z } from "zod";

export const STEPS = [
  { id: "E1", title: "Edit 1: the Deck opens, your turn, Accept" },
  { id: "E2", title: "Edit 2: Lightroom's window and screen modes, the spot, Abort" },
  { id: "E3", title: "Edit 3: Approve each pass, the keys" },
  { id: "E4", title: "Edit 4: copies, the pick, another photo selected" },
  { id: "E5", title: "Edit 5: a remembered spot on no monitor" },
  { id: "C1", title: "Chat 1: Claude Desktop" },
  { id: "C2", title: "Chat 2: Claude Desktop quits mid-edit" },
  { id: "F1", title: "No Deck: the classic window" },
  { id: "F2", title: "Lightroom quits" },
] as const;
export type StepId = (typeof STEPS)[number]["id"];

/** One check: `line` is the 11.1 line it counts for ("cleanup" for the put-backs and the copies). */
export type Check = { id: string; line: string; step: StepId; by: "jim" | "log"; what: string };
const c = (id: string, step: StepId, by: "jim" | "log", what: string): Check => ({ id, line: id.split(".")[0] ?? id, step, by, what });

export const CHECKS: readonly Check[] = [
  c("A1.e1.shown", "E1", "log", "the Deck showed within 2 s of the edit's first state"),
  c("A1.e1.classic", "E1", "log", "the classic window did not open (plugin log)"),
  c("A1.e1.jim", "E1", "jim", "the Deck appeared by itself; no classic window"),
  c("A2.jim", "E1", "jim", "\\ still switches Before/After"),
  c("A2.log", "E1", "log", "the Deck never took the foreground"),
  c("A4.log", "E1", "log", "the edit converged (your turn)"),
  c("A4.jim", "E1", "jim", "\"Your turn: …\" with the amber dot; keyboard stayed with Lightroom"),
  c("A19.jim", "E1", "jim", "slider names, Basic panel order, marks where the sliders sit"),
  c("A22.jim", "E1", "jim", "readable; nothing smaller than the key hints; not colour alone"),
  c("A23.jim", "E1", "jim", "the Deck looks at home next to Lightroom's panels"),
  c("A12.jim", "E1", "jim", "Accept the only filled button; Done: the edit is kept"),
  c("A12.ended", "E1", "log", "Accept ended the edit as accepted, from the Deck"),
  c("A12.hid", "E1", "log", "the Deck hid itself 10 s after the end (±3 s)"),
  c("A12.hid.jim", "E1", "jim", "the Deck hid itself about 10 s later"),
  c("A7.move.jim", "E2", "jim", "moving and resizing Lightroom leaves the Deck where it is"),
  c("A7.min.jim", "E2", "jim", "minimising Lightroom hides the Deck; restoring brings it back"),
  c("A7.min.log", "E2", "log", "a hide, then a show, around the minimise"),
  c("A9.modes.jim", "E2", "jim", "visible over Lightroom in each screen mode"),
  c("A9.f.jim", "E2", "jim", "in F's full-screen preview the Deck is not over the image"),
  c("A9.f2.jim", "E2", "jim", "F with the Deck on another monitor: the Deck stays visible there"),
  c("A5.drag.log", "E2", "log", "the dragged and widened spot was saved (window.json)"),
  c("A16.jim", "E2", "jim", "after the click the buttons went quiet and the line said what was sent"),
  c("A16.log", "E2", "log", "the click's answer came back to the Deck"),
  c("A13.jim", "E2", "jim", "one click: Done, the photo is back"),
  c("A13.back", "E2", "log", "the photo's settings are back as before the edit"),
  c("A13.snapshot.jim", "E2", "jim", "Develop > Snapshots has the named pre-session snapshot"),
  c("A5.there.log", "E3", "log", "the next edit opened at the saved spot and width"),
  c("A5.there.jim", "E3", "jim", "the Deck opened where you left it, at that width"),
  c("A11.jim", "E3", "jim", "\"Approve pass 1\" the only filled button; its line says what it does"),
  c("A11.enter.log", "E3", "log", "Enter with the Deck focused approved pass 1"),
  c("A14.arm.jim", "E3", "jim", "Ctrl+Backspace once arms (\"Press again to abort\"); Esc cancels"),
  c("A15.jim", "E3", "jim", "Esc never aborts; it hands the keyboard back to Lightroom"),
  c("A15.open.log", "E3", "log", "the edit was still open after Esc"),
  c("A14.abort.jim", "E3", "jim", "Ctrl+Backspace twice aborts"),
  c("A14.abort.log", "E3", "log", "the edit ended as aborted, from the Deck"),
  c("A18.jim", "E4", "jim", "before a pick, Accept is not offered"),
  c("A17.cards.jim", "E4", "jim", "the copy cards show each copy's look and name"),
  c("A21.jim", "E4", "jim", "another photo selected: the \"Target changed\" line within about 2 s"),
  c("A21.log", "E4", "log", "the Deck got the target-changed state"),
  c("A17.click.jim", "E4", "jim", "a card click shows that copy in Lightroom"),
  c("A17.click.log", "E4", "log", "after the card click Lightroom selected that copy"),
  c("A17.keys.log", "E4", "log", "a number then Enter sent the pick"),
  c("A17.picked.jim", "E4", "jim", "Lightroom shows the picked copy; the Deck says Picked"),
  c("A17.picked.log", "E4", "log", "Lightroom's selection is the picked copy"),
  c("copies.removed", "E4", "log", "the copies are removed from the catalog"),
  c("A5.fallback.log", "E5", "log", "a spot on no monitor fell back to the bottom centre"),
  c("A5.fallback.jim", "E5", "jim", "the Deck opened at the bottom centre of Lightroom's monitor"),
  c("A1.chat.log", "C1", "log", "the Deck showed within 2 s of Claude's edit's first state; no classic window"),
  c("A1.chat.jim", "C1", "jim", "at Claude's begin the Deck appeared; no classic window"),
  c("A3.jim", "C1", "jim", "while Claude worked, the Deck never took the keyboard or came over Claude Desktop"),
  c("A3.log", "C1", "log", "the Deck never took the foreground during the chat"),
  c("A8.jim", "C1", "jim", "Claude Desktop in front: the Deck is not on top; back in Lightroom it is"),
  c("A8.log", "C1", "log", "not topmost while Claude Desktop was in front; topmost again with Lightroom"),
  c("A6.jim", "C2", "jim", "Claude Desktop quit: \"Claude is not connected …\" and the undo line"),
  c("A6.log", "C2", "log", "Claude Desktop's engine was gone and the Deck kept running"),
  c("A24.log", "F1", "log", "with the Deck renamed the classic window opened by itself"),
  c("A24.jim", "F1", "jim", "the classic window opened; its Abort worked"),
  c("A24.abort.log", "F1", "log", "the classic window's Abort ended the edit as aborted"),
  c("deck.restored", "F1", "log", "the Deck's executable has its name back"),
  c("A10.log", "F2", "log", "the Deck closed within 5 s of Lightroom quitting"),
  c("A10.jim", "F2", "jim", "the Deck closed when Lightroom quit"),
  ...(["E1", "E2", "E3", "E4", "E5", "C1", "C2", "F1", "F2"] as const).map((s) => c(`back.${s}`, s, "log", "the photo is as it was before the check")),
].map((x) => (x.id.startsWith("back.") || x.id.startsWith("copies.") || x.id.startsWith("deck.") ? { ...x, line: "cleanup" } : x));

export const LINES = ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10", "A11", "A12", "A13", "A14", "A15", "A16", "A17", "A18", "A19", "A21", "A22", "A23", "A24"] as const;

// --- The saved state (%TEMP%\LrC-AVG\P7\p7_state.json) ---------------------------------------------
const answerSchema = z.strictObject({
  ok: z.boolean().nullable(),
  at: z.string(),
  detail: z.unknown().optional(),
  /** Not applicable on this machine (one monitor): the check does not count. */
  skipped: z.string().optional(),
});
export type Answer = z.infer<typeof answerSchema>;
const sampleSchema = z.strictObject({ window_ms: z.number(), private_mib: z.number(), cpu_pct: z.number(), complete: z.boolean(), procs: z.number() });
export type Sample = z.infer<typeof sampleSchema>;

export const stateSchema = z.strictObject({
  version: z.literal(1),
  run: z.string(),
  /** Epoch ms of the first run: the Deck logs from here on are this check's. */
  started: z.number(),
  photo: z.strictObject({ uuid: z.string(), filename: z.string(), snapshot_id: z.string(), start: z.record(z.string(), z.unknown()) }).nullable(),
  done: z.array(z.string()),
  answers: z.record(z.string(), answerSchema),
  /** Variants copies not yet seen removed. */
  copies: z.array(z.string()),
  /** The Deck's executable is renamed (F1): the next start renames it back first. */
  renamed: z.boolean(),
  /** window.json before E5 wrote a spot on no monitor (null: nothing to put back). */
  spot_backup: z.string().nullable(),
  /** Deck processes started from a stopped Deck: their creation time, for the cold start. */
  cold: z.array(z.strictObject({ pid: z.number(), created: z.number() })),
  samples: z.strictObject({ hidden: sampleSchema.nullable(), visible: sampleSchema.nullable() }),
  /** The error that stopped a step, by step; cleared when the step finishes on a later run. */
  errors: z.record(z.string(), z.string()),
});
export type State = z.infer<typeof stateSchema>;

export function freshState(run: string, now: number): State {
  return { version: 1, run, started: now, photo: null, done: [], answers: {}, copies: [], renamed: false, spot_backup: null, cold: [], samples: { hidden: null, visible: null }, errors: {} };
}

// --- The budgets (spec 9) --------------------------------------------------------------------------
/** The timings the logs give (budgets.ts), in ms. */
export type Timings = { cold_start: number[]; warm_show: number[]; update_paint: number[]; click_action: number[] };
type Budget = { id: string; what: string; target: number; unit: string; value: number | null; n: number; complete: boolean; ok: boolean | null };

/** Nearest-rank percentile; null for no samples. */
export function pct(xs: readonly number[], p: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] ?? null;
}

export function budgets(t: Timings, samples: State["samples"]): Budget[] {
  const b = (id: string, what: string, target: number, unit: string, value: number | null, n: number, complete = true): Budget => ({
    id, what, target, unit, value, n, complete, ok: value === null ? null : complete && value <= target,
  });
  const { hidden, visible } = samples;
  return [
    b("cold_start", "cold start, Deck process created to first paint (max)", 1500, "ms", t.cold_start.length ? Math.max(...t.cold_start) : null, t.cold_start.length),
    b("warm_show", "warm show, an edit's first state to shown (p95)", 150, "ms", pct(t.warm_show, 95), t.warm_show.length),
    b("update_paint", "state update to paint, while shown (p95)", 100, "ms", pct(t.update_paint, 95), t.update_paint.length),
    b("click_action", "click to userAction in the engine (p95)", 50, "ms", pct(t.click_action, 95), t.click_action.length),
    b("memory", "idle memory, the Deck's process tree, hidden", 150, "MiB", hidden?.private_mib ?? null, hidden ? 1 : 0, hidden?.complete ?? false),
    b("cpu_hidden", "CPU hidden, one core", 0.5, "%", hidden?.cpu_pct ?? null, hidden ? 1 : 0, hidden?.complete ?? false),
    b("cpu_visible", "CPU visible, one core", 2, "%", visible?.cpu_pct ?? null, visible ? 1 : 0, visible?.complete ?? false),
  ];
}

// --- The verdict -------------------------------------------------------------------------------------
export type LineResult = { line: string; result: "YES" | "NO" | "NOT RUN"; failed: string[]; missing: string[] };

export function lineResults(state: State): LineResult[] {
  return [...LINES, "cleanup"].map((line) => {
    const checks = CHECKS.filter((x) => x.line === line);
    const failed = checks.filter((x) => state.answers[x.id]?.ok === false).map((x) => x.id);
    const missing = checks.filter((x) => {
      const a = state.answers[x.id];
      return a === undefined || (a.ok === null && a.skipped === undefined);
    }).map((x) => x.id);
    return { line, result: failed.length ? "NO" : missing.length ? "NOT RUN" : "YES", failed, missing };
  });
}

export type Acceptance = { worked: boolean; lines: LineResult[]; budgets: Budget[]; headline: string };

export function acceptance(state: State, t: Timings): Acceptance {
  const lines = lineResults(state);
  const bs = budgets(t, state.samples);
  const badLines = lines.filter((l) => l.result !== "YES").map((l) => `${l.line} ${l.result}`);
  // PHASES.md Phase 7 asks that the budgets are measured; a number over its target is listed for Jim's verdict.
  const unmeasured = bs.filter((x) => x.ok === null || !x.complete).map((x) => `${x.id} ${x.ok === null ? "NOT MEASURED" : "INCOMPLETE"}`);
  const over = bs.filter((x) => x.ok === false && x.complete).map((x) => x.id);
  const bad = [...badLines, ...unmeasured, ...Object.keys(state.errors).map((s) => `${s} error`)];
  const also = over.length ? `; over budget: ${over.join(", ")}` : "";
  return { worked: bad.length === 0, lines, budgets: bs, headline: `Phase 7 acceptance: ${bad.length === 0 ? "WORKED" : `FAILED (${bad.join(", ")})`}${also}` };
}
