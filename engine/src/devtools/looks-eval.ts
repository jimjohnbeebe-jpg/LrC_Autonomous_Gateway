// `npm run looks:eval` (Phase 10 row 6; vault PHASE10_PLAN.md "Third re-plan", R2 and R6): the pure parts of the
// blind evaluation of two editing arms (A: by default no intent; B: a look or intent, optionally with a tone mode)
// on the same photos. Each photo gets two virtual copies, P and Q, with neutral names; which arm edits which copy is
// drawn at random per photo and kept in the run file only. Jim judges side-by-side pairs, left and right drawn at
// random again, and only then are the arms revealed and counted with an exact two-sided sign test, ties dropped.
// The Lightroom side is looks-eval-run.ts and looks-eval-judge.ts; the command is looks-eval-cli.ts.
// Report: docs\reports\phase10\LOOKS-EVAL.md.

import { randomInt } from "node:crypto";
import { z } from "zod";
import { MODEL_LINE, NO_QUESTIONS } from "./clients-run.js";

export const RUN_SCHEMA_ID = "lrc-avg/looks-eval-run/v1";
export const MIN_PHOTOS = 4;
export const MAX_PHOTOS = 24;
/** R6: 16 photos; with fewer non-tie pairs a run is never conclusive [stated: Jim, 2026-10-29, "Go with recommendations"]. */
export const CONCLUSIVE_PAIRS = 16;
export const ALPHA = 0.05;
export const DEFAULT_TIMEOUT_MIN = 20;
export const SLOTS = ["P", "Q"] as const;
export type Slot = (typeof SLOTS)[number];
export type ArmId = "A" | "B";
export type Choice = "L" | "R" | "T";

const arm = z.object({ intent: z.string().min(1).nullable(), tone_mode: z.string().min(1).nullable() });
export type Arm = z.infer<typeof arm>;

/** One headless edit of one copy, from the client's exit, its stream-json result line and the engine's tool log. */
const edit = z.object({
  at: z.string(),
  exit: z.number().nullable(),
  timed_out: z.boolean(),
  error: z.string().nullable(),
  begun: z.boolean(),
  session_id: z.string().nullable(),
  passes: z.number(),
  ended: z.string().nullable(),
  client_error: z.boolean().nullable(),
  turns: z.number().nullable(),
  minutes: z.number(),
  stdout: z.string(),
});
export type Edit = z.infer<typeof edit>;

const judgement = z.object({ at: z.string(), left: z.enum(SLOTS), answer: z.enum(["L", "R", "T"]), file: z.string() });
export type Judgement = z.infer<typeof judgement>;

const photo = z.object({
  nn: z.string(),
  uuid: z.string(),
  filename: z.string(),
  /** The master's canonical Develop settings when the run began. */
  start: z.record(z.string(), z.unknown()),
  /** The arm that edits copy P; Q gets the other. */
  p_arm: z.enum(["A", "B"]),
  copies: z.object({ P: z.string().nullable(), Q: z.string().nullable() }),
  edits: z.object({ P: edit.nullable(), Q: edit.nullable() }),
  judged: judgement.nullable(),
});
export type EvalPhoto = z.infer<typeof photo>;

export const runSchema = z.object({
  schema: z.literal(RUN_SCHEMA_ID),
  run: z.string(),
  created_at: z.string(),
  arms: z.object({ A: arm, B: arm }),
  timeout_min: z.number().positive(),
  /** LRC_AVG_LOG_DIR of every headless engine of this run. */
  log_dir: z.string(),
  photos: z.array(photo),
  /** The last read of the masters: the settings that differ from `start`, by uuid (empty lists: untouched). */
  masters: z.object({ at: z.string(), differing: z.record(z.string(), z.array(z.string())) }).nullable(),
  /** Copies removed by --cleanup. */
  removed: z.array(z.string()),
  /** When the arms were first shown; no pair is judged after it, since it would not be blind. */
  revealed_at: z.string().nullable(),
});
export type EvalRun = z.infer<typeof runSchema>;

/** A run id from the local time, e.g. 20261029-1530 (seconds added so two runs a minute apart differ). */
export function runId(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

/** The copy's name: neutral, so nothing in Lightroom tells the arms apart. */
export const copyName = (run: string, nn: string, slot: Slot): string => `AVG eval ${run} ${nn} ${slot}`;
export const nnOf = (i: number): string => String(i + 1).padStart(2, "0");
const other = (a: ArmId): ArmId => (a === "A" ? "B" : "A");
export const armOf = (p: Pick<EvalPhoto, "p_arm">, slot: Slot): ArmId => (slot === "P" ? p.p_arm : other(p.p_arm));

/** A fair coin per photo for the arm of copy P (node:crypto randomInt). */
export function assignArms(n: number, coin: () => number = () => randomInt(2)): ArmId[] {
  return Array.from({ length: n }, () => (coin() === 0 ? "A" : "B"));
}
/** Which copy is shown on the left, drawn independently of the arms. */
export const pickLeft = (coin: () => number = () => randomInt(2)): Slot => (coin() === 0 ? "P" : "Q");

export function newRun(o: { run: string; createdAt: string; arms: { A: Arm; B: Arm }; timeoutMin: number; logDir: string; photos: Array<{ uuid: string; filename: string; start: Record<string, unknown> }>; coin?: () => number }): EvalRun {
  const arms = assignArms(o.photos.length, o.coin);
  return {
    schema: RUN_SCHEMA_ID,
    run: o.run,
    created_at: o.createdAt,
    arms: o.arms,
    timeout_min: o.timeoutMin,
    log_dir: o.logDir,
    photos: o.photos.map((p, i) => ({ nn: nnOf(i), ...p, p_arm: arms[i] ?? "A", copies: { P: null, Q: null }, edits: { P: null, Q: null }, judged: null })),
    masters: null,
    removed: [],
    revealed_at: null,
  };
}

/** The arm in words, for the reveal: "no intent", or "intent <id>" with its tone mode. */
export const armText = (a: Arm): string => `${a.intent ? `intent ${a.intent}` : "no intent"}${a.tone_mode ? `, tone_mode ${a.tone_mode}` : ""}`;

/**
 * The headless client's prompt for one copy. The harness selects the copy first (there is no MCP tool that selects
 * a photo); the prompt has the client check the uuid. `tone_mode` is a begin argument of a later PR (row 9+10), so
 * it is asked for as text and left out when lr_begin_session has none.
 */
export function editPrompt(copyUuid: string, a: Arm): string {
  const intent = a.intent ? `intent_id "${a.intent}"` : "no intent_id (no intent)";
  const tone = a.tone_mode ? ` If lr_begin_session has a "tone_mode" argument, set it to "${a.tone_mode}"; if it has none, leave it out.` : "";
  return [
    "Use the lrc-avg MCP tools to edit one photo.",
    `First call lr_get_active_photo_context: the photo selected in Lightroom must have uuid "${copyUuid}". If its uuid is different, stop at once and reply only "WRONG PHOTO".`,
    `Then call lr_begin_session with mode "converge" and ${intent}.${tone} ${MODEL_LINE}`,
    "Look at every preview it returns, and make passes with lr_step until the photo looks its best or the session's pass limit is reached.",
    `Then call lr_end_session with outcome "accept". ${NO_QUESTIONS}`,
    "Finally, reply with one sentence that says what you changed.",
  ].join(" ");
}

/**
 * Claude Code's stream-json result line: `{"type":"result","subtype":...,"is_error":...,"num_turns":...}` [handle:
 * docs\reports\phase0\S3\s3_cli_run_redacted.jsonl line 9]. The last one counts; null when there is none.
 */
export function streamResult(text: string): { is_error: boolean | null; turns: number | null; subtype: string | null } | null {
  let found: Record<string, unknown> | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes('"result"')) continue;
    try {
      const v = JSON.parse(line) as unknown;
      if (v && typeof v === "object" && (v as Record<string, unknown>)["type"] === "result") found = v as Record<string, unknown>;
    } catch {
      // a line cut off when the client was ended
    }
  }
  if (!found) return null;
  const is = found["is_error"];
  const turns = found["num_turns"];
  return { is_error: typeof is === "boolean" ? is : null, turns: typeof turns === "number" ? turns : null, subtype: typeof found["subtype"] === "string" ? found["subtype"] : null };
}

/** An edit counts when its session began and ended "accept" before the timeout. */
export const editOk = (e: Edit | null): boolean => e !== null && !e.timed_out && e.begun && e.ended === "accept";
export const pairEdited = (p: EvalPhoto): boolean => editOk(p.edits.P) && editOk(p.edits.Q);
/**
 * The arms are shown once every pair was edited, on --judge (Jim ends the run without the failed pairs), or again
 * after a reveal. Never earlier: a pair edited on a later --resume would be judged knowing the arms.
 */
export const mayReveal = (r: EvalRun, mode: Cli["mode"]): boolean => r.revealed_at !== null || mode === "judge" || r.photos.every(pairEdited);

/** The arm Jim preferred in a judged pair, or "tie". */
export function winner(p: EvalPhoto): ArmId | "tie" | null {
  if (!p.judged) return null;
  if (p.judged.answer === "T") return "tie";
  const slot: Slot = p.judged.answer === "L" ? p.judged.left : p.judged.left === "P" ? "Q" : "P";
  return armOf(p, slot);
}

/** log C(n, k), exact enough for n <= 1000. */
function logChoose(n: number, k: number): number {
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}

/** The exact two-sided binomial sign test (p = 1/2) for `wins` of `n` non-tie pairs: 13 of 16 gives 0.0213. */
export function signTest(wins: number, n: number): number {
  if (!Number.isInteger(wins) || !Number.isInteger(n) || n < 0 || wins < 0 || wins > n) throw new RangeError(`sign test: ${wins} of ${n}`);
  if (n === 0) return 1;
  const k = Math.max(wins, n - wins);
  let tail = 0;
  for (let i = k; i <= n; i++) tail += Math.exp(logChoose(n, i) - n * Math.LN2);
  return Math.min(1, 2 * tail);
}

export type Tally = { photos: number; judged: number; b_wins: number; a_wins: number; ties: number; n: number; p: number; conclusive: boolean; failed_edits: string[]; unjudged: string[] };

export function tally(r: EvalRun): Tally {
  const w = r.photos.map(winner);
  const b = w.filter((x) => x === "B").length;
  const a = w.filter((x) => x === "A").length;
  const n = a + b;
  const p = signTest(b, n);
  const failed = r.photos.flatMap((ph) => SLOTS.filter((s) => !editOk(ph.edits[s])).map((s) => `${ph.nn} ${s}`));
  return { photos: r.photos.length, judged: w.filter((x) => x !== null).length, b_wins: b, a_wins: a, ties: w.filter((x) => x === "tie").length, n, p, conclusive: n >= CONCLUSIVE_PAIRS && p < ALPHA, failed_edits: failed, unjudged: r.photos.filter((ph) => !ph.judged).map((ph) => ph.nn) };
}

/** True when every master read the same as at the start; null when not read yet. */
export function mastersUntouched(r: EvalRun): boolean | null {
  return r.masters === null ? null : Object.values(r.masters.differing).every((d) => d.length === 0) && Object.keys(r.masters.differing).length === r.photos.length;
}

const yesNo = (b: boolean | null): string => (b === null ? "NOT CHECKED" : b ? "YES" : "NO");
export const fmtP = (p: number): string => (p < 0.001 ? p.toExponential(1) : p.toFixed(3));

/** The headline lines: WORKED when every edit was accepted, every pair judged and the masters are untouched. */
export function headlines(r: EvalRun, t: Tally = tally(r)): string[] {
  const masters = mastersUntouched(r);
  const worked = t.failed_edits.length === 0 && t.unjudged.length === 0 && masters === true;
  const why = [
    ...(t.failed_edits.length ? [`edits not accepted: ${t.failed_edits.join(", ")}`] : []),
    ...(t.unjudged.length ? [`pairs not judged: ${t.unjudged.join(", ")}`] : []),
    ...(masters !== true ? [`masters untouched: ${yesNo(masters)}`] : []),
  ];
  return [
    `Looks eval: ${worked ? "WORKED" : "FAILED"}${why.length ? ` (${why.join("; ")})` : ""}`,
    `B won ${t.b_wins} of ${t.n} (ties ${t.ties}), p = ${fmtP(t.p)}`,
    `conclusive: ${t.conclusive ? "YES" : "NO"}${t.n < CONCLUSIVE_PAIRS ? ` (${t.n} non-tie pairs, ${CONCLUSIVE_PAIRS} needed)` : ""}`,
    `masters untouched: ${yesNo(masters)}`,
  ];
}

export type Cli =
  | { mode: "new"; armA: Arm; armB: Arm; timeoutMin: number }
  | { mode: "resume" | "judge" | "cleanup"; run: string; timeoutMin: number | null }
  | { mode: "look"; uuid: string; id: string };

export const RUN_ID = /^\d{8}-\d{6}$/;
/** `last` names the newest run (ids sort by time), so Jim never copies an id. */
export const LAST_RUN = "last";
export const lastRun = (folders: readonly string[]): string | null => folders.filter((f) => RUN_ID.test(f)).sort().at(-1) ?? null;

/**
 * The command's arguments (after `--`): a new run takes `--b-intent <id>` (and `--a-intent`, `--a-tone`, `--b-tone`,
 * `--timeout-min`); `--resume <run>`, `--judge <run>`, `--cleanup <run>`; `--look-from <uuid> --look-id <id>`.
 */
export function parseCli(argv: readonly string[]): Cli {
  const val = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    if (i < 0) return null;
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${flag} needs a value`);
    return v;
  };
  const t = val("--timeout-min");
  const timeout = t === null ? null : Number(t);
  if (timeout !== null && !(timeout > 0 && timeout <= 120)) throw new Error("--timeout-min takes 1 to 120");
  const look = val("--look-from");
  if (look !== null) {
    const id = val("--look-id");
    if (id === null) throw new Error("--look-from needs --look-id <id>");
    return { mode: "look", uuid: look, id };
  }
  for (const mode of ["resume", "judge", "cleanup"] as const) {
    const run = val(`--${mode}`);
    if (run === null) continue;
    if (run !== LAST_RUN && !RUN_ID.test(run)) throw new Error(`--${mode} takes "last" or a run id such as 20261029-153000 (the folder name under %TEMP%\\LrC-AVG\\looks-eval)`);
    return { mode, run, timeoutMin: timeout };
  }
  const b = val("--b-intent");
  if (b === null) throw new Error("a new run needs --b-intent <intent id> (arm B); arm A is no intent unless --a-intent names one");
  const noneOr = (v: string | null): string | null => (v === null || v === "none" ? null : v);
  return {
    mode: "new",
    armA: { intent: noneOr(val("--a-intent")), tone_mode: val("--a-tone") },
    armB: { intent: noneOr(b), tone_mode: val("--b-tone") },
    timeoutMin: timeout ?? DEFAULT_TIMEOUT_MIN,
  };
}
