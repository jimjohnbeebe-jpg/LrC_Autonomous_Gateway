// The values a session runs on, and where each came from (PHASE5_PLAN row 3; AVG-006: per-session
// arguments do not persist). For each value, the first that is given wins:
//   max passes, variant count, preview long edge:  the lr_begin_session argument, the page, the default
//   clip limits:        the argument, the intent's guardrail_overrides, the page, the default
//                       (decision 1A of the row 3 plan [stated: Jim, 2026-09-28, "Go with
//                       recommendations"]: the page takes the place the built-in default had)
//   quality, decay, approval mode:  the page, the default (no argument sets them)
// The defaults are session\rules.ts SESSION_DEFAULTS. The approval mode is recorded here; the engine
// acts on approve_each_pass from PHASE5_PLAN row 6.

import { SESSION_DEFAULTS } from "../session/rules.js";
import type { PageValues } from "./page.js";

export type SettingFrom = "argument" | "intent" | "page" | "default";
export type Approval = PageValues["mode"];

export type SessionSettingsArgs = {
  max_passes?: number | undefined;
  variant_count?: number | undefined;
  long_edge?: number | undefined;
  guardrails?: { clip_high_pct?: number | undefined; clip_low_pct?: number | undefined } | undefined;
};
export type IntentOverrides = { clip_high_pct?: number | undefined; clip_low_pct?: number | undefined };

export type SessionSettings = {
  approval: Approval;
  maxPasses: number;
  variantCount: number;
  longEdge: number;
  quality: number;
  clipHighPct: number;
  clipLowPct: number;
  decay: number[];
  from: {
    approval: SettingFrom;
    max_passes: SettingFrom;
    variant_count: SettingFrom;
    long_edge: SettingFrom;
    quality: SettingFrom;
    clip_high_pct: SettingFrom;
    clip_low_pct: SettingFrom;
    decay: SettingFrom;
  };
};

/** The first of `candidates` that is given, with its source; else the default. */
function pick<T>(fallback: T, ...candidates: Array<[SettingFrom, T | undefined]>): [T, SettingFrom] {
  for (const [from, value] of candidates) if (value !== undefined) return [value, from];
  return [fallback, "default"];
}

export function resolveSessionSettings(args: SessionSettingsArgs, intent: IntentOverrides, page: Partial<PageValues>): SessionSettings {
  const d = SESSION_DEFAULTS;
  const [approval, approvalFrom] = pick<Approval>(d.approval, ["page", page.mode]);
  const [maxPasses, maxPassesFrom] = pick(d.maxPasses, ["argument", args.max_passes], ["page", page.max_passes]);
  const [variantCount, variantFrom] = pick(d.variantCount, ["argument", args.variant_count], ["page", page.variant_count]);
  const [longEdge, longEdgeFrom] = pick(d.longEdge, ["argument", args.long_edge], ["page", page.long_edge]);
  const [quality, qualityFrom] = pick(d.quality, ["page", page.quality]);
  const [clipHighPct, highFrom] = pick(d.clipHighPct, ["argument", args.guardrails?.clip_high_pct], ["intent", intent.clip_high_pct], ["page", page.clip_high_pct]);
  const [clipLowPct, lowFrom] = pick(d.clipLowPct, ["argument", args.guardrails?.clip_low_pct], ["intent", intent.clip_low_pct], ["page", page.clip_low_pct]);
  const [decay, decayFrom] = pick<readonly number[]>(d.decay, ["page", page.decay]);
  return {
    approval,
    maxPasses,
    variantCount,
    longEdge,
    quality,
    clipHighPct,
    clipLowPct,
    decay: [...decay],
    from: {
      approval: approvalFrom,
      max_passes: maxPassesFrom,
      variant_count: variantFrom,
      long_edge: longEdgeFrom,
      quality: qualityFrom,
      clip_high_pct: highFrom,
      clip_low_pct: lowFrom,
      decay: decayFrom,
    },
  };
}
