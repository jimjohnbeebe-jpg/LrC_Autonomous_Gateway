// The HUD's state built from the session (PRD 6.3; the fields are bridge\hud-protocol.ts's, and its
// header says how the plugin shows each): the photo the session works on with its EXIF, the session's
// photos, the deltas and guardrail status of that photo's last pass, the session's settings
// (PHASE5_PLAN decision 4) and its pre-session snapshot's name. The plugin replaces its whole state
// with each update [handle: plugin\LrC-AVG.lrplugin\Hud.lua update(), `H.state = s`], so every update
// carries all of it. Sliders go by Lightroom's labels (params\labels.ts), and the guardrail status
// comes with one sentence for the photographer (hudGuardrail); the session log keeps the engine's
// own words. get_context's shutter and aperture are formatted when they are numbers ("1/250 s",
// "f/8"); which form Lightroom gives them in is [unverified] (the sim gives numbers,
// tests\helpers\lightroom-sim.ts).

import { HUD_END_STAGES, HUD_LIMITS, type HudStage, type HudUpdatePayload } from "../bridge/index.js";
import type { PassEntry } from "../log/index.js";
import { lightroomLabel, type CanonicalValue } from "../params/index.js";
import { pendingApproval, type Limits, type Session, type Target, type VariantId } from "../session/index.js";

/** An update without what the publisher adds: seq, open and answered_click_id. */
export type HudState = Omit<HudUpdatePayload, "seq" | "open" | "answered_click_id">;
type HudTarget = HudUpdatePayload["target"];
type HudDelta = NonNullable<HudUpdatePayload["deltas"]>[number];
type HudGuardrail = NonNullable<HudUpdatePayload["guardrail"]>;
type HudSettings = NonNullable<HudUpdatePayload["settings"]>;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const round = (n: number, places: number): number => Math.round(n * 10 ** places) / 10 ** places;

/** The HUD's state for the session at `stage`: the photo the running operation works on, else the last one. */
export function hudState(s: Session, stage: HudStage, note?: string): HudState {
  const t = s.work?.target ?? s.active;
  const pass = s.work?.pass ?? t.passes;
  const last = lastPass(s, t);
  const text = note ?? s.work?.note;
  // approve_each_pass (PHASE5_PLAN row 6): Approve is on while a pass waits for the user's approval.
  const waiting = (HUD_END_STAGES as readonly string[]).includes(stage) ? null : pendingApproval(s);
  return {
    session_id: s.id,
    stage,
    mode: s.mode,
    pass: clamp(pass, 0, HUD_LIMITS.pass),
    max_passes: clamp(s.maxPasses, 1, HUD_LIMITS.pass),
    target: target(s, t),
    session_photos: [s.master, ...s.variants].map((x) => x.uuid).slice(0, HUD_LIMITS.photos),
    ...(stage === "awaiting_pick" ? { variants: s.variants.map((v) => v.id as VariantId) } : {}),
    ...(waiting ? { approve_pass: clamp(waiting.pass, 1, HUD_LIMITS.pass) } : {}),
    ...(last ? { deltas: (last.mask ? maskDeltas(last.mask, last.guardrail_actions.some((a) => a.kind === "reverted")) : last.changes.map(delta)).slice(0, HUD_LIMITS.rows), guardrail: hudGuardrail(last, s.limits) } : {}),
    ...(text ? { note: text } : {}),
    settings: settings(s),
    snapshot: s.snapshot.name,
  };
}

/** The last pass of photo `t` (pass 0 included), or null before its pass 0. */
function lastPass(s: Session, t: Target): PassEntry | null {
  for (let i = s.log.passes.length - 1; i >= 0; i--) {
    const p = s.log.passes[i];
    if (p?.target === t.id) return p;
  }
  return null;
}

function target(s: Session, t: Target): HudTarget {
  const settings = t.last?.settings ?? (t.id === "master" ? s.startSettings : null);
  const lensProfile = settings?.["lens.profile_enable"];
  const iso = s.exif.iso;
  return {
    uuid: t.uuid,
    ...(t.filename ? { filename: t.filename } : {}),
    ...(t.copy_name ? { copy_name: t.copy_name } : {}),
    ...(typeof iso === "number" || typeof iso === "string" ? { iso } : {}),
    ...optional("shutter", shutter(s.exif.shutter)),
    ...optional("aperture", aperture(s.exif.aperture)),
    ...(typeof s.exif.lens === "string" ? { lens: s.exif.lens } : {}),
    ...(lensProfile === 1 || lensProfile === 0 ? { lens_profile: lensProfile === 1 ? "on" : "off" } : {}),
  };
}

function optional<K extends string>(key: K, value: string | null): Partial<Record<K, string>> {
  return value === null ? {} : ({ [key]: value } as Record<K, string>);
}

/** Seconds as the HUD shows a shutter speed: "1/250 s", "2 s"; text as given. */
export function shutter(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v !== "number" || !(v > 0)) return null;
  return v >= 1 ? `${round(v, 1)} s` : `1/${Math.round(1 / v)} s`;
}

/** An f-number as the HUD shows it: "f/8", "f/5.6"; text as given. */
export function aperture(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v !== "number" || !(v > 0)) return null;
  return `f/${round(v, 1)}`;
}

function shown(v: CanonicalValue): string | number {
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "on" : "off";
  return "curve";
}

function delta(c: PassEntry["changes"][number]): HudDelta {
  return {
    slider: lightroomLabel(c.name),
    ...(c.before !== null ? { before: shown(c.before) } : {}),
    after: shown(c.after),
    ...(c.delta !== null ? { delta: c.delta > 0 ? `+${c.delta}` : String(c.delta) } : {}),
  };
}

/**
 * A mask pass's rows (session\masks.ts): "<mask> · <slider>" for each local slider it changed, in the
 * Masking panel's words (params\labels.ts), and what happened to the mask itself ("Sky 1 · Exposure");
 * a pass its guardrail undid is one row saying so.
 */
function maskDeltas(m: NonNullable<PassEntry["mask"]>, undone: boolean): HudDelta[] {
  const name = m.after?.name ?? m.before?.name ?? m.name;
  if (undone) return [{ slider: name, after: m.op === "create" ? "new mask undone" : "change undone" }];
  if (!m.after) return [{ slider: name, after: "deleted" }];
  const was = m.before?.sliders ?? {};
  const rows: HudDelta[] = [];
  if (!m.before) rows.push({ slider: name, after: "new mask" });
  else if (m.before.name !== m.after.name) rows.push({ slider: m.before.name, after: `renamed ${m.after.name}` });
  for (const k of new Set([...Object.keys(was), ...Object.keys(m.after.sliders)])) {
    const before = was[k] ?? 0;
    const after = m.after.sliders[k] ?? 0;
    const d = round(after - before, 2);
    if (d !== 0) rows.push({ slider: `${name} · ${lightroomLabel(k)}`, before, after, delta: d > 0 ? `+${d}` : String(d) });
  }
  if (m.before && m.before.active !== m.after.active) rows.push({ slider: name, after: m.after.active ? "shown" : "hidden" });
  if (m.before && m.before.inverted !== m.after.inverted) rows.push({ slider: name, after: m.after.inverted ? "inverted" : "not inverted" });
  return rows.length > 0 ? rows : [{ slider: name, after: "reshaped" }];
}

type GuardrailAction = PassEntry["guardrail_actions"][number];

/**
 * The pass's guardrail status, the strongest action taken, else what was refused or clamped, else
 * green, with one sentence for the photographer (green: none; plugin 0.9.0 prints "Clipping: within
 * limits.", bridge\hud-protocol.ts header). Each sentence stays well under HUD_LIMITS.text: the
 * longest label a clamp or refusal can name is 25 characters [handle: tests\hud-labels.test.ts "keeps
 * every guardrail sentence within the HUD's text limit, in the photographer's words"].
 */
export function hudGuardrail(p: Pick<PassEntry, "guardrail_actions" | "refused" | "clamped">, limits: Limits): HudGuardrail {
  const action = (kind: GuardrailAction["kind"]) => p.guardrail_actions.find((a) => a.kind === kind);
  const reverted = action("reverted");
  if (reverted) {
    const why = reverted.limit === "region" ? "a region changed more than allowed" : `${end(reverted).toLowerCase()} clipping went over the limit`;
    return { status: "undone", reason: `Pass undone: ${why}.` };
  }
  const unmet = action("unmet");
  if (unmet) return { status: "unmet", reason: `${end(unmet)} clipping is still ${clip(unmet, limits)} after corrections.` };
  const corrected = action("corrected");
  if (corrected) return { status: "corrected", reason: `${end(corrected)} clipping was ${clip(corrected, limits)}; corrected.` };
  const refused = p.refused[0];
  if (refused) return { status: "refused", reason: `${lightroomLabel(refused.name)}: ${refusedWhy(refused, p.clamped)}.` };
  const clamped = p.clamped[0];
  if (clamped) return { status: "clamped", reason: `${lightroomLabel(clamped.name)}: ${clampedWhy(clamped)}.` };
  return { status: "green" };
}

/** Corrections and "unmet" are about a clipping limit (session\guardrail.ts correct(), unmet()). */
const end = (a: GuardrailAction): string => (a.limit === "clip_low" ? "Shadow" : "Highlight");

/**
 * "<x> % (limit <y> %)". The clipping is the first percentage in the action's reason, which
 * session\guardrail.ts correct() and unmet() write as "clip_<end>_pct was|is still <x> %, over the
 * limit of <y> %"; the log keeps no other field with it for a correction (the reading before it).
 */
function clip(a: GuardrailAction, limits: Limits): string {
  const limit = a.limit === "clip_low" ? limits.clipLowPct : limits.clipHighPct;
  const x = /(\d+(?:\.\d+)?) %/.exec(a.reason)?.[1];
  return x === undefined ? `over the limit of ${pct(limit)} %` : `${pct(Number(x))} % (limit ${pct(limit)} %)`;
}

const pct = (n: number): string => String(round(n, 2));

/**
 * Why a slider was not changed, from session\plan.ts planStep and applyProjectedGuardrail. planStep's
 * "no change is left after the limits" follows a range clamp of the same slider when it is already at
 * the end of its range; otherwise the change rounded to nothing (session\plan.ts planStep).
 */
function refusedWhy(r: PassEntry["refused"][number], clamped: PassEntry["clamped"]): string {
  if (r.by === "guardrail") return "not changed, it would push clipping over the limit";
  if (r.reason.includes("not available")) return "not available on this photo, not changed";
  const atEnd = clamped.some((c) => c.name === r.name && c.reason.startsWith("the slider's range"));
  return atEnd ? "not changed, it is already at the end of its range" : "not changed, no room left within its limits";
}

/** Why a change was held, from the reasons session\plan.ts planStep and applyProjectedGuardrail write. */
function clampedWhy(c: PassEntry["clamped"][number]): string {
  if (c.reason.startsWith("pass ")) return `change held to ±${Math.abs(c.applied)} this pass`;
  if (c.reason.startsWith("the slider's range")) return "held at the end of its range";
  return "change held back to keep clipping within limits";
}

/** The session's own values, under get_prefs' names (decision 4: the HUD shows them, not the page's). */
function settings(s: Session): HudSettings {
  return {
    mode: s.log.settings?.approval ?? "autonomous",
    max_passes: s.maxPasses,
    ...(s.mode === "variants" && s.log.variant_count !== null ? { variant_count: s.log.variant_count } : {}),
    long_edge: s.longEdge,
    quality: s.quality,
    clip_high_pct: s.limits.clipHighPct,
    clip_low_pct: s.limits.clipLowPct,
    decay: s.decay.slice(0, HUD_LIMITS.decay),
  };
}
