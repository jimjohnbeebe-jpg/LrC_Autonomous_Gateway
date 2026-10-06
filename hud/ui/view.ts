// What the Deck shows for a state (Phase 7 row 4c; spec docs\hud\lrc-avg-hud-spec-v2.md 5.1-5.3, 6;
// Option C docs\hud\option-c\NOTES.md sections 2-3). The rows of spec 5.2 in its order: an end stage,
// then Lightroom down (1a/1b), Claude not connected (6), the edit gone (8), a click waiting for its
// answer (5.3), then the stage. The Deck's own readings, decided by Jim [stated: 2026-10-05]:
//   - Q6: `cap_reached` is the user's turn, Accept the primary;
//   - Q11: a card click chooses; "Continue on copy X" sends the pick;
//   - D5 "Put back": while Claude is away the Deck shows the way to the plugin's Put back.
// Exactly one filled primary per state, or none (spec 6 "Rules"). Pure: hud\ui\view.test.ts drives it.
import type { DeckCopy, DeckRow, HudChannelState } from "../../engine/src/hud/channel-protocol.ts";
import { armed, CLICK_WAIT_MS, type Letter, type Local } from "./clicks.ts";
import * as T from "./text.ts";

export type Phase = "working" | "turn" | "done" | "problem" | "info";
export type ActionId = "approve" | "accept" | "abort" | "continue" | "show_copies";
/** primary: filled; secondary: outlined; compact: P's small pair; quiet: Accept while Claude works. */
export type Kind = "primary" | "secondary" | "compact" | "quiet" | "abort";
export type Action = { id: ActionId; label: string; kind: Kind; on: boolean; line?: string; tip?: string };
export type Card = { letter: Letter; name: string; copyName: string | null; thumb: string | null; guard: Guard | null; chosen: boolean; picked: boolean; on: boolean };
export type Guard = { status: string; text: string | null };
export type Timeline = { max: number; current: number; done: number; ring: Phase; marks: Record<number, string>; label: string };
export type Ctx = { connected: boolean; gone: boolean; focus: boolean; open: boolean; now: number; marks: Record<number, string> };
export type View = {
  phase: Phase;
  sentence: string;
  /** Line 2: the step on Claude's turn, else the photo. */
  line2: string;
  /** Up to two lines under it: the target-changed line, the note, the no-answer line; else the photo on Claude's turn. */
  band: string[];
  identityTip: string | null;
  actions: Action[];
  /** One line under the actions when they are all off. */
  offLine: string | null;
  pickHint: string | null;
  centre: "rows" | "cards" | "way" | "none";
  rows: DeckRow[];
  rowsHeader: string | null;
  undone: boolean;
  guardrail: Guard | null;
  cards: Card[];
  /** The way back: the undo line (Converge) or the copies line (Variants); empty once Abort put the photo back. */
  way: string;
  /** While Claude is away, the plugin's Put back. */
  putBack: string | null;
  timeline: Timeline | null;
  closeOnly: boolean;
};

const END = ["accepted", "aborted", "ended"];
const WORKING = ["begin", "pass0", "applying", "acquiring_preview", "metrics", "awaiting_claude"];

function stepLine(s: HudChannelState): string {
  const label = T.STEP[s.stage] ?? s.stage;
  if (s.pass === undefined || s.max_passes === undefined) return label;
  if (s.stage === "applying") return `${label} ${s.pass} of ${s.max_passes}`;
  return s.pass >= 1 && s.stage !== "pass0" ? `${label} · ${T.passOf(s.pass, s.max_passes)}` : label;
}

function identity(s: HudChannelState): [string, string | null] {
  const t = s.target;
  const name = String(t.filename ?? t.uuid);
  const tip = [t.lens, t.lens_profile !== undefined ? `lens profile ${t.lens_profile}` : undefined].filter((x) => x !== undefined).join(" · ");
  if (t.copy_name !== undefined && s.stage !== "awaiting_pick") return [`${name} / ${t.copy_name}`, tip || null];
  const exif = [t.iso !== undefined ? `ISO ${t.iso}` : undefined, t.shutter, t.aperture].filter((x) => x !== undefined);
  return [[name, ...exif].join(" · "), tip || null];
}

function wayLine(s: HudChannelState): string {
  const names = (s.copies ?? []).map((c) => c.copy_name).filter((n): n is string => n !== undefined);
  const first = names[0];
  const last = s.copies?.at(-1)?.letter;
  if (s.mode === "variants" && first !== undefined && last !== undefined) return T.copiesLine(first, last);
  return T.UNDO + String(s.snapshot ?? T.UNDO_NO_SNAPSHOT);
}

/** The phase and sentence, in spec 5.2's order. */
function sentenceOf(s: HudChannelState, l: Local, c: Ctx): [Phase, string] {
  if (s.stage in T.HEADLINE && END.includes(s.stage)) return ["done", T.HEADLINE[s.stage as "accepted" | "aborted" | "ended"]];
  if (s.lightroom === "down") return ["problem", T.HEADLINE.not_running];
  if (!c.connected) return ["problem", T.HEADLINE.not_connected];
  if (c.gone) return ["problem", T.HEADLINE.gone];
  if (l.pending) return ["working", T.clickSent(l.pending.label)];
  if (s.approve_pass !== undefined) return ["turn", T.approveHeadline(s.approve_pass)];
  if (s.stage === "awaiting_pick" || s.stage === "converged" || s.stage === "target_changed") return ["turn", T.HEADLINE[s.stage]];
  if (s.cap_reached && s.max_passes !== undefined) return ["turn", T.capHeadline(s.max_passes)];
  if (s.stage === "awaiting_claude" && s.note !== undefined) return ["info", String(s.note)];
  return ["working", T.HEADLINE.working];
}

function abortAction(s: HudChannelState, l: Local, c: Ctx): Action {
  const isArmed = armed(l, c.now);
  const line = isArmed ? T.LINE.armed : s.mode === "variants" ? T.LINE.abortCopies : T.LINE.abort;
  return { id: "abort", label: isArmed ? T.LABEL.armed : T.LABEL.abort, kind: "abort", on: true, line, tip: "Ctrl+Backspace" };
}

function acceptLine(s: HudChannelState): string {
  return s.mode === "variants" && s.picked ? T.LINE.acceptCopy(s.picked) : T.LINE.accept;
}

/** The stage's actions, primary first, before the live rule turns them off. */
function stageActions(s: HudChannelState, l: Local, c: Ctx): Action[] {
  const abort = abortAction(s, l, c);
  if (s.approve_pass !== undefined) {
    const n = s.approve_pass;
    return [{ id: "approve", label: T.approveLabel(n), kind: "primary", on: true, line: T.LINE.approve(n) }, { id: "accept", label: T.LABEL.accept, kind: "compact", on: true, tip: T.LINE.acceptNow }, { ...abort, kind: "compact" }];
  }
  if (s.stage === "awaiting_pick") {
    if (!c.open) return [{ id: "show_copies", label: T.LABEL.showCopies, kind: "primary", on: true }, abort];
    const x = l.chosen !== null && (s.variants ?? []).includes(l.chosen) ? l.chosen : null;
    return x ? [{ id: "continue", label: T.continueLabel(x), kind: "primary", on: true, line: T.LINE.continue(x) }, abort] : [abort];
  }
  if (s.stage === "converged" || s.cap_reached) return [{ id: "accept", label: T.LABEL.accept, kind: "primary", on: true, line: acceptLine(s) }, abort];
  if (s.stage === "target_changed") return [{ id: "accept", label: T.LABEL.accept, kind: "secondary", on: true, line: acceptLine(s) }, abort];
  const noPick = s.mode === "variants" && !s.picked;
  return [{ id: "accept", label: T.LABEL.accept, kind: "quiet", on: !noPick, tip: noPick ? T.LINE.offPick : T.LINE.acceptWorking }, abort];
}

function actionsOf(s: HudChannelState, l: Local, c: Ctx, phase: Phase): [Action[], string | null] {
  if (phase === "done") return [[], null];
  const actions = stageActions(s, l, c);
  const off = s.lightroom === "down" || !c.connected || c.gone ? T.LINE.offConnected : l.pending ? T.LINE.offAnswer : null;
  if (off === null) return [actions, null];
  // "Show the copies" sends nothing, so it stays on.
  return [actions.map((a) => (a.id === "show_copies" ? a : { ...a, on: false })), off];
}

function guardOf(g: HudChannelState["guardrail"] | DeckCopy["guardrail"]): Guard | null {
  if (!g) return null;
  return { status: g.status, text: g.reason !== undefined ? String(g.reason) : g.status === "green" ? T.CLIPPING_OK : null };
}

function cardsOf(s: HudChannelState, l: Local, live: boolean): Card[] {
  return (s.copies ?? []).map((c) => ({
    letter: c.letter,
    name: [c.letter, c.label].filter((x) => x !== undefined).join(" "),
    copyName: c.copy_name ?? null,
    thumb: c.thumb ?? null,
    guard: guardOf(c.guardrail),
    chosen: l.chosen === c.letter && s.stage === "awaiting_pick",
    picked: s.picked === c.letter,
    on: live && s.stage === "awaiting_pick" && (s.variants ?? []).includes(c.letter),
  }));
}

function timelineOf(s: HudChannelState, phase: Phase, c: Ctx): Timeline | null {
  if (s.max_passes === undefined) return null;
  const current = s.pass ?? 0;
  const running = ["begin", "pass0", "applying"].includes(s.stage);
  const n = s.copies?.length ?? 0;
  const label =
    s.mode !== "variants" ? T.passOf(current, s.max_passes) : s.picked ? T.copyPass(s.picked, current) : T.passCopies(current, n);
  return { max: s.max_passes, current, done: running ? current - 1 : current, ring: phase, marks: s.mode === "variants" ? {} : c.marks, label };
}

/** HudState.targetName (plugin\LrC-AVG.lrplugin\HudState.lua:236-241). */
function targetName(s: HudChannelState): string {
  const t = s.target;
  return String(t.filename ?? t.uuid) + (t.copy_name !== undefined ? ` (${t.copy_name})` : "");
}

function bandOf(s: HudChannelState, l: Local, claudes: boolean, sentenceIsNote: boolean, id: string): string[] {
  const band: string[] = [];
  const sel = s.selection;
  if (sel && !sel.in_edit && !END.includes(s.stage)) band.push(T.targetChanged(sel.name, s.mode === "variants", targetName(s)));
  if (s.note !== undefined && !sentenceIsNote) band.push(String(s.note));
  if (l.noAnswer) band.push(T.clickNoAnswer(l.noAnswer, CLICK_WAIT_MS / 1000));
  if (band.length === 0 && claudes) band.push(id);
  return band.slice(0, 2);
}

export function view(s: HudChannelState, l: Local, c: Ctx): View {
  const [phase, sentence] = sentenceOf(s, l, c);
  const [actions, offLine] = actionsOf(s, l, c, phase);
  const [id, identityTip] = identity(s);
  const claudes = phase === "working" || phase === "info";
  const problem = phase === "problem";
  const live = !problem && phase !== "done" && !l.pending;
  const cards = cardsOf(s, l, live);
  const rows = s.rows ?? [];
  const undone = s.guardrail?.status === "undone";
  const pickHint = s.stage === "awaiting_pick" && c.open && live && !actions.some((a) => a.kind === "primary") ? (c.focus ? T.PICK.keys : T.PICK.click) : null;
  return {
    phase,
    sentence,
    line2: claudes && WORKING.includes(s.stage) ? stepLine(s) : id,
    band: bandOf(s, l, claudes && WORKING.includes(s.stage), phase === "info", id),
    identityTip,
    actions,
    offLine,
    pickHint,
    centre: problem ? "way" : cards.length > 0 ? "cards" : rows.length > 0 ? "rows" : "none",
    rows,
    rowsHeader: s.pass !== undefined ? T.blockHeader(s.pass, undone) : null,
    undone,
    guardrail: guardOf(s.guardrail),
    cards,
    way: s.stage === "aborted" ? "" : wayLine(s),
    putBack: problem && s.lightroom !== "down" ? T.PUT_BACK_PATH : null,
    timeline: timelineOf(s, phase, c),
    closeOnly: phase === "done",
  };
}

/** The action Enter presses: the turn's primary, when it is on and Abort is not armed (NOTES section 3). */
export function primary(v: View, isArmed: boolean): Action | null {
  if (isArmed) return null;
  return v.actions.find((a) => a.kind === "primary" && a.on) ?? null;
}
