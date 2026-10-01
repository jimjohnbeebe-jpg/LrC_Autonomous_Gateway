// The Phase 5 check's fixed values, its dependencies and the run record its modules share
// (phase5-check.ts runs the check; PHASE5_PLAN row 7, plan approved by Jim 2026-09-30 [stated: "Go
// with recommendations"], decisions D1-D4 as recommended).

import type { BridgeClient } from "../bridge/index.js";
import type { BridgeGate, Tools } from "../mcp/index.js";
import type { ParamMap } from "../params/index.js";
import { APPROVAL_WAIT_MS } from "../session/index.js";
import type { PageSettings } from "../settings/index.js";
import type { Answer } from "./phase1-check.js";
import type { ChatLogs } from "./phase2-check.js";
import type { Json } from "./phase3-config.js";
import type { CopyRecord, Photo } from "./phase4-config.js";
import type { Known } from "./phase5-readback.js";
import type { StateStore } from "./phase5-state.js";
import type { HudTraceEntry, PluginLog } from "./phase5-trace.js";

export type { Answer, Json, Photo };

/**
 * Part 1's photo (decision D1 [stated: Jim, 2026-09-30, "Go with recommendations"]): its pass 0 needed
 * no baseline correction in Phase 3, where 20260907-_OZ80099.NEF needed three [handle:
 * docs\reports\phase3\P3\p3_check_2026-09-27T14-00-37-507Z.json, fixtures[4] and [5]
 * session_a.pass0.history_names], so its sessions begin sooner. The approve chat uses it too.
 */
export const PHOTO = "20260907-_OZ80093.NEF";
/** Plugin 0.6.1: the HUD, its menu items waiting for the engine, the selection line (PHASE5_PLAN row 4, PR #46). */
export const MIN_PLUGIN_VERSION = "0.6.1";
/** The intent of every session and chat: AC-1's (PRD section 10), whose variants A-C differ [handle: engine\intents\landscape_golden_hour.json]. */
export const INTENT = "landscape_golden_hour";
/** AC-1's words (PRD section 10), as in Phase 3's chat (phase3-config.ts CHAT_PROMPT). */
export const CHAT_PROMPT = "Tune the active photo for golden hour landscape.";
/** What Jim types after his Approve in the approve chat. */
export const GO_ON = "Approved, go on.";
/** AC-2: the photo back within 1 s of the click (PRD section 10). */
export const AC2_BUDGET_MS = 1000;
/**
 * Small scripted passes: colour and local contrast only, each moving a slider by more than its
 * minimum step, so no pass converges by metrics (session\plan.ts convergedByMetrics) and none nears
 * a clipping limit [inference: vibrance and clarity leave the tonal range alone]. Signs alternate so
 * the photo stays near its start.
 */
export const STEPS = [
  { settings: { vibrance: 6, clarity: 4 }, rationale: "Phase 5 check: scripted pass" },
  { settings: { vibrance: -4, clarity: -3 }, rationale: "Phase 5 check: scripted pass" },
  { settings: { vibrance: 5 }, rationale: "Phase 5 check: scripted pass" },
  { settings: { clarity: 4 }, rationale: "Phase 5 check: scripted pass" },
] as const;
/** How long the check waits for each of Jim's clicks or menu items before it moves on [inference]. */
export const CLICK_WAIT_MS = 180000;
/**
 * After a chat, how long the check waits for Claude Desktop's engine to give the bridge back: it does
 * so 60 s after its last tool call once no session is open [handle: engine\src\mcp\main.ts
 * IDLE_RELEASE_MS, bridge-gate.ts endUse/armIdle; with Claude Desktop [unverified] until this check].
 */
export const BRIDGE_WAIT_MS = 150000;
/**
 * The plugin counts as silent when a ping gets no answer within this long; it answered in 0.35 ms
 * (median) in Phase 1 [handle: docs\reports\phase1\PHASE1.md "Numbers"], and row 5's check used the
 * same 1.5 s [handle: vault PHASE5_PLAN.md row 5 "Plug-in Manager"].
 */
export const PING_TIMEOUT_MS = 1500;
/** Outside a session the bridge drops after 3 missed 2 s heartbeats [handle: vault PHASE5_PLAN.md "From row 3"]. */
export const HEARTBEAT_LIMIT_MS = 6000;
/** Tries for a step Jim must get right (a selection, a page setting, a removal). */
export const ROUNDS = 3;

export type Phase5Deps = {
  client: BridgeClient;
  gate: BridgeGate;
  tools: Tools;
  map: ParamMap;
  /** The settings page as the check's engine reads it (the same PageSettings the MCP server uses). */
  settings: PageSettings;
  ask: (question: string) => Promise<Answer>;
  /** Show the prompt and return the line typed (trimmed), or null if input ended. */
  prompt: (text: string) => Promise<string | null>;
  say: (line: string) => void;
  /** Claude Desktop's logs from `since` on; `tag` names the saved files; `desktop_errors`: its error and time-out lines. */
  collectChat: (since: Date, tag: string) => ChatLogs & { desktop_errors?: string[] };
  /** The plugin's log (%TEMP%\LrC-AVG\bridge.log), from the check's start on. */
  pluginLog: PluginLog;
  /** Every hud_update the check's engine sent (phase5-trace.ts traceHudUpdates). */
  hudTrace: readonly HudTraceEntry[];
  /** The resumable state (decision 8). */
  state: StateStore;
  stamp: string;
  connectTimeoutMs?: number;
  clickWaitMs?: number;
  bridgeWaitMs?: number;
  /** Polling step for the waits (tests shorten it). */
  pollMs?: number;
  /** The approval wait the engines run with: APPROVAL_WAIT_MS (60 s) unless a test gave the Tools a shorter one (ToolsDeps.approvalWaitMs). */
  approvalWaitMs?: number;
  now?: () => Date;
};

/** The run's record: the results, its errors, the photos it reads back, and the copies the cleanup removes. */
export type Run = {
  results: Json;
  errors: string[];
  fail: (message: string) => void;
  known: Known;
  copies: CopyRecord[];
  unconfirmedCopies: string[];
  /** Every session the check's engine began, for AC-4 (clip-check.ts reads each one's log). */
  sessions: Array<{ name: string; session_id: string }>;
};

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll `check` until it holds or `timeoutMs` pass; whether it held. */
export async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs: number, stepMs = 250): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return true;
    if (Date.now() >= end) return false;
    await sleep(stepMs);
  }
}

export const clickWait = (deps: Pick<Phase5Deps, "clickWaitMs">): number => deps.clickWaitMs ?? CLICK_WAIT_MS;
export const approvalWait = (deps: Pick<Phase5Deps, "approvalWaitMs">): number => deps.approvalWaitMs ?? APPROVAL_WAIT_MS;
export const pollOf = (deps: Pick<Phase5Deps, "pollMs">): number => deps.pollMs ?? 250;

/** The open session's id, or null. */
export const openSessionId = (deps: Pick<Phase5Deps, "tools">): string | null => deps.tools.sessionManager()?.current()?.id ?? null;

/** Wait until session `sid` is no longer open (Jim's Abort or Accept ended it); whether it ended in time. */
export function waitSessionEnded(deps: Pick<Phase5Deps, "tools" | "clickWaitMs" | "pollMs">, sid: string): Promise<boolean> {
  return waitFor(() => openSessionId(deps) !== sid, clickWait(deps), pollOf(deps));
}

/** The menu items' paths, as Jim sees them (plugin\LrC-AVG.lrplugin\Info.lua LrExportMenuItems). */
export const MENU = {
  hud: "File > Plug-in Extras > LrC-AVG - Show Vision Gateway HUD",
  abort: "File > Plug-in Extras > LrC-AVG - Abort Session",
  accept: "File > Plug-in Extras > LrC-AVG - Accept Session",
} as const;
