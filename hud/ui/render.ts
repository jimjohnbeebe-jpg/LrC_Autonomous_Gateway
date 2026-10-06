// The Deck's HTML (Phase 7 row 4c; Option C docs\hud\option-c\NOTES.md sections 1-2, 7; spec
// docs\hud\lrc-avg-hud-spec-v2.md 7, 8): the 44 px bar, or the opened deck's three columns (status and
// pass timeline; the pass's slider rows or the copy cards; the actions and the way back). Opened is the
// default at each new edit [stated: Jim, 2026-10-05, "Opened by default. It needs to be intuitive"].
// Clickable things carry data-act or data-card (deck.ts listens on the deck); everything else is a drag
// region, as row 4b's bar (style.css). The CSP's style-src 'self' (tauri.conf.json) leaves out
// 'unsafe-inline', which blocks inline style attributes [inference: the CSP rule, not tried here], so
// tracks and marks are SVG attributes. All text goes through esc().
import type { DeckRow } from "../../engine/src/hud/channel-protocol.ts";
import { CARET, CLOSE, DISC_OPEN, DISC_SHUT, guardGlyph, phaseGlyph, timelineSvg } from "./glyphs.ts";
import { shownDelta, shownValue, track } from "./rows.ts";
import * as T from "./text.ts";
import type { Action, Card, Guard, View } from "./view.ts";

/**
 * armed: Abort is armed, so the primary shows no Enter keycap (Enter does nothing then). Key hints are
 * drawn always and shown only while the Deck has the keyboard, by the body's `kbd` class (style.css):
 * focus changes never redraw, since a redraw between a click's mouse-down and mouse-up would lose it.
 */
export type Form = { open: boolean; armed: boolean; twoColumns: boolean; thumbs: ReadonlyMap<string, string> };

export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}
const attr = (name: string, v: string | null | undefined): string => (v ? ` ${name}="${esc(v)}"` : "");
const ARROW = '<svg width="14" height="8" aria-hidden="true" class="arrow"><path d="M1 4h11M9 1l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>';
/** A key hint, shown only while the Deck has the keyboard (Option C NOTES section 3). */
const key = (k: string): string => `<span class="key kf">${esc(k)}</span>`;

function toggle(open: boolean): string {
  return `<button class="disc" data-act="toggle" aria-expanded="${open}" aria-label="${open ? T.CLOSE_DECK : T.OPEN_DECK}">${open ? DISC_OPEN : DISC_SHUT}</button>`;
}
const hide = `<button class="hidebtn" data-act="hide" aria-label="${T.HIDE}">${CLOSE}</button>`;

function button(a: Action, f: Form, bar: boolean): string {
  const cls = a.id === "abort" ? `abort${a.label === T.LABEL.armed ? " armed" : ""}${a.kind === "compact" ? " compact" : ""}` : a.kind === "quiet" ? (bar ? "textonly" : "secondary") : a.kind;
  const hint = a.kind === "primary" && a.on && !f.armed ? key("Enter") : "";
  return `<button class="btn ${cls}" data-act="${a.id}"${a.on ? "" : " disabled"}${attr("title", a.tip)}>${esc(a.label)}${hint}</button>`;
}

function guardLine(g: Guard | null, cls: string): string {
  if (!g || g.text === null) return "";
  return `<div class="${cls}">${guardGlyph(g.status)}<span>${esc(g.text)}</span></div>`;
}

// --- The bar -------------------------------------------------------------------------------------
function bar(v: View, f: Form): string {
  const turn = v.phase === "turn" ? " turn15" : "";
  const primary = v.actions.find((a) => a.kind === "primary");
  const abort = v.actions.find((a) => a.id === "abort");
  const cq = v.offLine ?? primary?.line ?? abort?.line ?? "";
  const acts = v.actions.filter((a) => a.kind !== "compact" || a.id !== "accept").map((a) => button(a, f, true)).join("");
  return `<div class="deck k" data-tauri-drag-region>${toggle(false)}<span class="glyph">${phaseGlyph(v.phase)}</span>
<div class="words${turn}" data-tauri-drag-region><b>${esc(v.sentence)}</b> <span class="fid">· ${esc(v.line2)}</span></div>
<div class="cq" data-tauri-drag-region>${esc(cq)}</div><div class="acts">${acts}</div>${hide}</div>`;
}

// --- The opened deck: left column ----------------------------------------------------------------
function left(v: View, f: Form): string {
  // One block, wrapped to two lines; the column's tooltip has all of it.
  const band = v.band.length ? `<div class="band">${esc(v.band.join(" "))}</div>` : "";
  const tip = [v.identityTip, ...v.band].filter(Boolean).join("\n");
  const tl = v.timeline ? `<div class="tl">${timelineSvg(v.timeline)}<span class="lab">${esc(v.timeline.label)}</span></div>` : "";
  return `<div class="col l" data-tauri-drag-region${attr("title", tip)}>
<div class="turn">${toggle(f.open)}<span class="glyph">${phaseGlyph(v.phase)}</span><div class="sentence">${esc(v.sentence)}</div></div>
<div class="step">${esc(v.line2)}</div>${band}${tl}</div>`;
}

// --- Centre: rows, cards or the way back -----------------------------------------------------------
function rowHtml(r: DeckRow, undone: boolean): string {
  const before = shownValue(r.name, r.before, r.min);
  const after = shownValue(r.name, r.after, r.min);
  const t = track(r, undone);
  if (t === null) {
    const ba = r.before === undefined ? `<b>${esc(after)}</b>` : `${esc(before)} ${ARROW} <b>${esc(after)}</b>`;
    return `<div class="drow"><span class="dl">${esc(r.label)}</span><span class="prof">${ba}</span><span></span></div>`;
  }
  const x = (p: number): number => 5 + p * 90;
  const seg = undone ? "" : `<rect x="${x(t.from)}" y="8" width="${Math.max(2, x(t.to) - x(t.from))}" height="2" fill="var(--accent)" opacity=".6"/>`;
  const svg = `<svg width="100" height="18" aria-hidden="true"><rect x="5" y="8" width="90" height="2" fill="var(--line)"/>${seg}<path d="M${x(t.thumb)} 11l4.5 6h-9z" fill="${undone ? "var(--text3)" : "var(--text)"}"/></svg>`;
  const shownAfter = undone ? `<s>${esc(after)}</s>` : esc(after);
  const delta = undone ? T.NOT_KEPT : r.delta !== undefined ? shownDelta(r.name, r.delta) : "";
  return `<div class="drow${undone ? " undone" : ""}"><span class="dl">${esc(r.label)}</span>${svg}<span class="ba">${esc(before)} ${ARROW} ${shownAfter}</span><span class="dd">${esc(delta)}</span></div>`;
}

/** Five rows per column, two columns when the deck is wide enough; "+n more" in the last slot when they do not fit. */
function rowsBlock(v: View, f: Form): string {
  const slots = f.twoColumns ? 10 : 5;
  let rows = v.rows.map((r) => rowHtml(r, v.undone));
  let more = "";
  if (rows.length > slots) {
    const hidden = v.rows.slice(slots - 1).map((r) => r.label);
    more = `<div class="drow"><span class="dl m">${esc(T.moreRows(hidden.length))}</span><span class="more">${esc(hidden.join(", "))}</span></div>`;
    rows = rows.slice(0, slots - 1);
  }
  const all = [...rows, more].filter(Boolean);
  const subs = [all.slice(0, 5), all.slice(5)].filter((c) => c.length).map((c) => `<div class="subc">${c.join("")}</div>`).join("");
  const header = v.rowsHeader ? `<div class="blk-h"><b>${esc(v.rowsHeader)}</b></div>` : "";
  return `<div class="blk${v.undone ? " undone" : ""}">${header}<div class="subs">${subs}</div>${guardLine(v.guardrail, "gline")}</div>`;
}

function card(c: Card, f: Form): string {
  const src = c.thumb ? f.thumbs.get(c.thumb) : undefined;
  const img = src ? `<img src="${esc(src)}" alt="">` : "";
  const right = c.picked ? `<span class="picked">${T.PICK.picked}</span>` : c.on ? key({ A: "1", B: "2", C: "3" }[c.letter]) : "";
  const cls = `card${c.chosen || c.picked ? " chosen" : ""}`;
  const tip = [c.copyName, c.guard?.text].filter(Boolean).join("\n");
  const mark = c.guard ? `<span class="gmark">${guardGlyph(c.guard.status)}</span>` : "";
  return `<button class="${cls}" data-card="${c.letter}"${c.on ? "" : " disabled"}${attr("title", tip)} aria-pressed="${c.chosen}">
${c.chosen || c.picked ? `<span class="caret">${CARET}</span>` : ""}<span class="th">${img}</span>
<span class="tx"><span class="cname"><span>${esc(c.name)}</span>${mark}${right}</span>${guardLine(c.guard, "cguard")}</span></button>`;
}

function centre(v: View, f: Form): string {
  if (v.centre === "rows") return `<div class="col c" data-tauri-drag-region>${rowsBlock(v, f)}</div>`;
  if (v.centre === "cards") return `<div class="col c v" data-tauri-drag-region><div class="cards">${v.cards.map((c) => card(c, f)).join("")}</div></div>`;
  if (v.centre === "way") {
    const [a, b] = v.way.startsWith(T.UNDO) ? [T.UNDO.trim(), v.way.slice(T.UNDO.length)] : ["", v.way];
    const c = v.putBack ? `<div class="c">${esc(v.putBack)}</div>` : "";
    return `<div class="col c" data-tauri-drag-region><div class="way">${a ? `<div class="a">${esc(a)}</div>` : ""}<div class="b">${esc(b)}</div>${c}</div></div>`;
  }
  return `<div class="col c" data-tauri-drag-region></div>`;
}

// --- Right column: the actions -------------------------------------------------------------------
function right(v: View, f: Form): string {
  const parts: string[] = [];
  for (const a of v.actions.filter((x) => x.kind === "primary" || x.kind === "secondary" || x.kind === "quiet")) {
    parts.push(button(a, f, false) + (a.line ? `<div class="conseq">${esc(a.line)}</div>` : ""));
  }
  if (v.pickHint) parts.push(`<div class="hintbox"><div class="h1">${T.PICK.choose}</div><div class="h2"><span class="nf">${T.PICK.click}</span><span class="kf">${T.PICK.keys}</span></div></div>`);
  const compact = v.actions.filter((a) => a.kind === "compact");
  const abort = v.actions.find((a) => a.id === "abort" && a.kind === "abort");
  if (compact.length) parts.push(`<div class="pairrow">${compact.map((a) => button(a, f, false)).join("")}</div>`);
  else if (abort) parts.push(`<div class="abortrow">${button(abort, f, false)}<div class="${abort.label === T.LABEL.armed ? "hint" : "conseq"}">${esc(abort.line ?? "")}</div></div>`);
  if (v.offLine) parts.push(`<div class="off">${esc(v.offLine)}</div>`);
  if (v.centre !== "way" && v.way) parts.push(`<div class="undo">${esc(v.way)}</div>`);
  return `<div class="col r" data-tauri-drag-region>${parts.join("")}</div>`;
}

export function html(v: View | null, f: Form): string {
  if (v === null) return `<div class="deck k" data-tauri-drag-region>${toggle(false)}<div class="words" data-tauri-drag-region><b>${T.NO_EDIT}</b></div>${hide}</div>`;
  if (!f.open) return bar(v, f);
  return `<div class="deck open" data-tauri-drag-region>${left(v, f)}${centre(v, f)}${right(v, f)}${hide}</div>`;
}
