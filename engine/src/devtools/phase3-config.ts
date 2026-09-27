// The Phase 3 check's fixed values, its dependencies and the helpers its modules share
// (phase3-check.ts runs the check; phase3-fixture.ts does one photo; phase3-chat.ts does Part 2).

import type { BridgeClient } from "../bridge/index.js";
import type { BridgeGate, Tools } from "../mcp/index.js";
import { ToolError } from "../mcp/index.js";
import type { ParamMap } from "../params/index.js";
import type { Answer } from "./phase1-check.js";
import { describeError } from "./phase1-check.js";
import type { ChatLogs } from "./phase2-check.js";

export type { Answer };

/**
 * The six fixtures (PHASES.md Phase 3 "on all six fixtures") [handle: the repo's fixtures\ folder,
 * listed by Claude Code on 2026-09-26; the files are gitignored].
 */
export const FIXTURES = [
  "20250413-_OZ81430.NEF",
  "20260110-_Z8A0138-DxO_DeepPRIME XD3.dng",
  "20260110-_Z8A0173.NEF",
  "20260906-_OZ80005.NEF",
  "20260907-_OZ80093.NEF",
  "20260907-_OZ80099.NEF",
] as const;
/** The chat's photo: the Phase 2 photo. */
export const CHAT_FIXTURE = "20260907-_OZ80093.NEF";
/** AC-1's words (PRD section 10). */
export const CHAT_PROMPT = "Tune the active photo for golden hour landscape.";
export const INTENT_A = "landscape_golden_hour";
export const INTENT_B = "neutral_technical_correction";
export const REPLAY_HISTORY_NAME = "AVG P3check replay";
/**
 * The oldest plugin Phase 3's check runs on: Phase 2's. Plugin 0.3.0 (Phase 4) only adds commands
 * (plugin\LrC-AVG.lrplugin\Catalog.lua), so the check also runs on it.
 */
export const MIN_PLUGIN_VERSION = "0.2.0";
/** AC-2: the snapshot restores within 1 s. */
export const REVERT_BUDGET_MS = 1000;
/** About 3.5 s per pass (Jim, 2026-09-26) [handle: docs\reports\phase2\PHASE2.md "Verdict"]. */
export const PASS_BUDGET_MS = 3500;
/** The region crop on the first fixture: the middle fifth, at 800 px. */
export const REGION = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 } as const;

/** Session A's scripted passes: ordinary moves, one that pushes the highlights, one too small to move the metrics. */
export const SCRIPT: ReadonlyArray<{ settings: Record<string, number>; rationale: string }> = [
  { settings: { exposure: 0.3, shadows: 15 }, rationale: "scripted pass: lift the midtones and open the shadows" },
  { settings: { whites: 40, exposure: 0.5 }, rationale: "scripted pass: push the highlights, to exercise the guardrails" },
  { settings: { vibrance: 10, clarity: 5 }, rationale: "scripted pass: a little colour and local contrast" },
  { settings: { exposure: 0.02 }, rationale: "scripted pass: a step too small to move the metrics (convergence by metrics)" },
];

export const WRITE_TIMEOUT_MS = 30000;

export type Phase3Deps = {
  client: BridgeClient;
  gate: BridgeGate;
  tools: Tools;
  map: ParamMap;
  ask: (question: string) => Promise<Answer>;
  /** Show the prompt and return the line typed (trimmed), or null if input ended. */
  prompt: (text: string) => Promise<string | null>;
  say: (line: string) => void;
  collectChat: (since: Date) => ChatLogs;
  /** Save a golden JPEG; returns the saved file's name. */
  saveGolden: (fixture: string, jpeg: Buffer) => string;
  connectTimeoutMs?: number;
  now?: () => Date;
};

export type Json = Record<string, unknown>;

export const errorBody = (err: unknown): Json => (err instanceof ToolError ? err.body() : { message: describeError(err) });

export const yn = (b: boolean): string => (b ? "YES" : "NO");

/** The History names a tool result reports. */
export const historyOf = (json: Json): string[] => (json["history_names"] as string[] | undefined) ?? [];

export function brief(metrics: unknown): Json {
  const m = (metrics ?? {}) as Json;
  return { luma_mean: m["luma_mean"], clip_high_pct: m["clip_high_pct"], clip_low_pct: m["clip_low_pct"] };
}

/** A pass in one line: luma, clipping, refusals, guardrail actions, convergence. */
export function summary(json: Json): string {
  const m = brief(json["metrics"]);
  const actions = (json["guardrail_actions"] as Array<{ kind: string }> | undefined) ?? [];
  const refused = (json["refused"] as unknown[] | undefined) ?? [];
  return `luma ${String(m["luma_mean"])}, clipping ${String(m["clip_high_pct"])} % / ${String(m["clip_low_pct"])} %` +
    `${refused.length ? `, ${refused.length} refused` : ""}${actions.length ? `, guardrail: ${actions.map((x) => x.kind).join(", ")}` : ""}` +
    `${json["converged_by_metrics"] === true ? ", converged" : ""}`;
}
