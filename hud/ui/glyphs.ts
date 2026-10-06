// The Deck's glyphs, inline SVG on the spec 8.1 tokens (spec docs\hud\lrc-avg-hud-spec-v2.md 8.3: the
// bundled Inter subset has no ✓ ▲ ⚠, so states are never characters; 8.4 icons). Drawn as Option C's
// mockup draws them (docs\hud\option-c\option-c.html, `G`, `GM`, `timeline`); colours are CSS variables.
import type { Phase, Timeline } from "./view.ts";

const svg = (w: number, h: number, body: string, cls = ""): string => `<svg width="${w}" height="${h}" aria-hidden="true"${cls ? ` class="${cls}"` : ""}>${body}</svg>`;

export const DISC_OPEN = svg(12, 12, '<path d="M2 4h8L6 8.5z" fill="var(--text2)"/>');
export const DISC_SHUT = svg(12, 12, '<path d="M4 2v8l4.5-4z" fill="var(--text2)"/>');
export const CLOSE = svg(12, 12, '<path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="var(--text2)" stroke-width="1.5" stroke-linecap="round"/>');
export const CARET = svg(12, 7, '<path d="M0 7L6 0.5L12 7z" fill="var(--accent)"/>');

/** The phase's shape (spec 5.1): ring (pulsed by deck.ts through .halo), dot, check, triangle, info. */
export function phaseGlyph(p: Phase): string {
  switch (p) {
    case "working":
      return svg(16, 16, '<circle class="halo" cx="8" cy="8" r="7" fill="none" stroke="var(--working)" stroke-width="1.5" opacity=".35"/><circle cx="8" cy="8" r="4" fill="none" stroke="var(--working)" stroke-width="2"/>');
    case "turn":
      return svg(16, 16, '<circle cx="8" cy="8" r="5" fill="var(--accent)"/>');
    case "done":
      return svg(16, 16, '<path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="var(--ok)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>');
    case "problem":
      return svg(16, 16, '<path d="M8 2.2L14.6 13.6H1.4Z" fill="none" stroke="var(--danger)" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6.4v3.4" stroke="var(--danger)" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="11.7" r=".95" fill="var(--danger)"/>');
    case "info":
      return svg(16, 16, '<circle cx="8" cy="8" r="6.25" fill="none" stroke="var(--text2)" stroke-width="1.5"/><rect x="7.25" y="7" width="1.5" height="4.6" rx=".75" fill="var(--text2)"/><circle cx="8" cy="4.9" r=".95" fill="var(--text2)"/>');
  }
}

/** Guardrail marks, one shape per meaning (Option C NOTES section 2, "Guardrail marks"). */
const MARK: Record<string, string> = { green: "ok", corrected: "corr", clamped: "lim", refused: "lim", unmet: "prob", undone: "prob" };
export function guardGlyph(status: string): string {
  switch (MARK[status]) {
    case "ok":
      return svg(12, 12, '<path d="M2.2 6.4l2.5 2.5L9.8 3.6" fill="none" stroke="var(--ok)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>');
    case "corr":
      return svg(12, 12, '<circle cx="6" cy="6" r="4.4" fill="none" stroke="var(--text2)" stroke-width="1.2"/><path d="M6 1.6a4.4 4.4 0 0 0 0 8.8z" fill="var(--text2)"/>');
    case "lim":
      return svg(12, 12, '<path d="M1.5 3.5v5M10.5 3.5v5M1.5 6h9" stroke="var(--text2)" stroke-width="1.4" stroke-linecap="round"/>');
    case "prob":
      return svg(12, 12, '<path d="M6 1.3L11.2 10.6H.8Z" fill="none" stroke="var(--danger)" stroke-width="1.2" stroke-linejoin="round"/><path d="M6 4.6v2.8" stroke="var(--danger)" stroke-width="1.2" stroke-linecap="round"/><circle cx="6" cy="9" r=".7" fill="var(--danger)"/>');
    default:
      return "";
  }
}

const RING: Record<Phase, string> = { turn: "var(--accent)", working: "var(--working)", info: "var(--text2)", done: "var(--text2)", problem: "var(--text3)" };

/**
 * The pass timeline: one dot per pass 0..max, the current one ringed, a 9 px guardrail mark under each
 * done pass. Above 8 passes the dots would crowd the column, so only the words are shown
 * (ponytail: Option C's 160 px track form for long edits is not drawn; add it if long edits are common).
 */
export function timelineSvg(t: Timeline): string {
  if (t.max > 8) return "";
  const step = 20;
  const x = (i: number): number => 8 + i * step;
  const out: string[] = [];
  for (let i = 0; i < t.max; i++) out.push(`<path d="M${x(i) + 5} 7H${x(i + 1) - 5}" stroke="var(--line)" stroke-width="1"/>`);
  for (let i = 0; i <= t.max; i++) {
    out.push(i <= t.done ? `<circle cx="${x(i)}" cy="7" r="4" fill="var(--text2)"/>` : `<circle cx="${x(i)}" cy="7" r="3.5" fill="none" stroke="var(--text3)" stroke-width="1"/>`);
    if (i === t.current) out.push(`<circle cx="${x(i)}" cy="7" r="6.75" fill="none" stroke="${RING[t.ring]}" stroke-width="1.5"/>`);
    const m = t.marks[i];
    if (m !== undefined && i <= t.done) out.push(`<g transform="translate(${x(i) - 4.5} 15) scale(.75)">${guardGlyph(m).replace(/<\/?svg[^>]*>/g, "")}</g>`);
  }
  return svg(t.max * step + 16, 25, out.join(""));
}
