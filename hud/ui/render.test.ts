// The right column's line budget and the screen-reader wiring (render.ts; critique 2026-10-15, issues 1-3).
import { describe, expect, it } from "vitest";
import { hudChannelStateSchema, type HudChannelState } from "../../engine/src/hud/channel-protocol.ts";
import { arm, FRESH, onState, sent, type Local } from "./clicks.ts";
import { esc, html, type Form } from "./render.ts";
import * as T from "./text.ts";
import { fillAi, view, type Ctx } from "./view.ts";

const ctx: Ctx = { connected: true, gone: false, focus: false, open: true, now: 1000, marks: { 1: "corrected" } };
const form = (over: Partial<Form> = {}): Form => ({ open: true, armed: false, twoColumns: false, thumbs: new Map(), connected: true, ...over });
const st = (over: Record<string, unknown> = {}): HudChannelState =>
  hudChannelStateSchema.parse({ session_id: "s1", mode: "converge", pass: 2, max_passes: 6, target: { uuid: "P1", filename: "f.NEF" }, lightroom: "connected", snapshot: "AVG pre-session X", stage: "converged", ...over });
const draw = (s: HudChannelState, f: (l: Local) => Local = (l) => l, fo: Partial<Form> = {}): string => html(view(s, f(onState(FRESH, s)), ctx), form(fo));

describe("the right column", () => {
  it("a turn: each button points at its line", () => {
    const h = draw(st());
    expect(h).toContain(`aria-describedby="say-accept"`);
    expect(h).toContain(`id="say-accept">${T.LINE.accept}<`);
    expect(h).toContain(`id="say-abort">${T.LINE.abort}<`);
  });

  it("buttons off: the off line stands in for their lines", () => {
    const h = draw(st(), (l) => sent(l, "c1", "Accept", 1000));
    expect(h).toContain(fillAi(T.LINE.offAnswer, undefined));
    expect(h).not.toContain(T.LINE.accept);
    expect(h).not.toContain("aria-describedby");
  });

  it("Abort armed: its hint stands in for the primary's line", () => {
    const h = draw(st(), (l) => arm(l, 1000), { armed: true });
    expect(h).toContain(T.LINE.armed);
    expect(h).not.toContain(T.LINE.accept);
  });

  it("approve: Accept's line is shown, not only its tooltip", () => {
    expect(draw(st({ stage: "awaiting_approval", approve_pass: 2 }))).toContain(`id="say-accept">${T.LINE.acceptNow}<`);
  });

  it("the way back is one line, all of it in its tooltip", () => {
    expect(draw(st())).toContain(`<div class="undo" data-tauri-drag-region title="${esc(T.UNDO)}AVG pre-session X">`);
  });
});

describe("the AI's name (issue #155)", () => {
  it("'name · model' is visible text in the bar and the opened deck, not a title attribute", () => {
    const s = st({ ai_name: "OpenCode", ai_model: "openai/gpt-6-luna" });
    for (const open of [false, true]) {
      const h = draw(s, undefined, { open });
      const text = h.replace(/<[^>]*>/g, "");
      expect(text).toContain("OpenCode · openai/gpt-6-luna");
      expect(h).not.toMatch(/title="[^"]*OpenCode · openai/);
    }
    expect(draw(st())).not.toContain(`class="step ai"`);
  });
});

describe("words for a screen reader", () => {
  it("the timeline and the arrow", () => {
    const h = draw(st({ rows: [{ name: "exposure", label: "Exposure", group: "Basic", before: 0, after: 0.35, delta: 0.35, min: -5, max: 5, weight: 0.07 }] }));
    expect(h).toContain(`aria-label="pass 2 of 6; pass 1 corrected"`);
    expect(h).toContain(`<span class="sr">${T.TO}</span>`);
  });

  it("no edit: connected or not", () => {
    expect(html(null, form())).toContain(T.NO_EDIT_OPEN);
    expect(html(null, form({ connected: false }))).toContain(T.NO_EDIT);
  });
});
