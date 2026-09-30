// The HUD's state built from the session (PRD 6.3; the fields are bridge\hud-protocol.ts's, and its
// header says how the plugin shows each): the photo the session works on with its EXIF, the session's
// photos, the deltas and guardrail status of that photo's last pass, and the session's settings
// (PHASE5_PLAN decision 4). The plugin replaces its whole state with each update [handle:
// plugin\LrC-AVG.lrplugin\Hud.lua update(), `H.state = s`], so every update carries all of it.
// get_context's shutter and aperture are formatted when they are numbers ("1/250 s", "f/8"); which
// form Lightroom gives them in is [unverified] (the sim gives numbers, tests\helpers\lightroom-sim.ts).

import { HUD_LIMITS, type HudStage, type HudUpdatePayload } from "../bridge/index.js";
import type { PassEntry } from "../log/index.js";
import type { CanonicalValue } from "../params/index.js";
import type { Session, Target, VariantId } from "../session/index.js";

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
  return {
    session_id: s.id,
    stage,
    mode: s.mode,
    pass: clamp(pass, 0, HUD_LIMITS.pass),
    max_passes: clamp(s.maxPasses, 1, HUD_LIMITS.pass),
    target: target(s, t),
    session_photos: [s.master, ...s.variants].map((x) => x.uuid).slice(0, HUD_LIMITS.photos),
    ...(stage === "awaiting_pick" ? { variants: s.variants.map((v) => v.id as VariantId) } : {}),
    ...(last ? { deltas: last.changes.slice(0, HUD_LIMITS.rows).map(delta), guardrail: guardrail(last) } : {}),
    ...(text ? { note: text } : {}),
    settings: settings(s),
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
    slider: c.name,
    ...(c.before !== null ? { before: shown(c.before) } : {}),
    after: shown(c.after),
    ...(c.delta !== null ? { delta: c.delta > 0 ? `+${c.delta}` : String(c.delta) } : {}),
  };
}

/** The pass's guardrail status: the strongest action taken, else what was refused or clamped, else green. */
function guardrail(p: PassEntry): HudGuardrail {
  const action = (kind: PassEntry["guardrail_actions"][number]["kind"]) => p.guardrail_actions.find((a) => a.kind === kind);
  const reverted = action("reverted");
  if (reverted) return { status: "undone", reason: reverted.reason };
  const unmet = action("unmet");
  if (unmet) return { status: "unmet", reason: unmet.reason };
  const corrected = action("corrected");
  if (corrected) return { status: "corrected", reason: corrected.reason };
  const refused = p.refused[0];
  if (refused) return { status: "refused", reason: `${refused.name}: ${refused.reason}` };
  const clamped = p.clamped[0];
  if (clamped) return { status: "clamped", reason: `${clamped.name}: ${clamped.reason}` };
  return { status: "green" };
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
