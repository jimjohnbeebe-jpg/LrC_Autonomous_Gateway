// The session log as lr_begin_session opens it (moved out of begin.ts, Phase 10 row 8, module size).

import { lightroomNotices, updateNotices } from "../bridge/index.js";
import { SESSION_LOG_SCHEMA_ID, type SessionLogData } from "../log/index.js";
import type { PageRead, SessionSettings } from "../settings/index.js";
import type { Session, SessionContext } from "./types.js";

/** The log's record of the session's settings: the page's values used and where each came from. */
export function settingsEntry(settings: SessionSettings, page: PageRead): NonNullable<SessionLogData["settings"]> {
  return {
    approval: settings.approval,
    long_edge: settings.longEdge,
    measure_long_edge: settings.measureLongEdge,
    quality: settings.quality,
    from: settings.from,
    page: { read: page.read, note: page.note, problems: page.problems },
  };
}

/** The log of a session just opened, with no pass yet. */
export function newLog(ctx: SessionContext, s: Session, variantCount: number | null, notes: string | null): SessionLogData {
  const { intent, master } = s;
  const hello = ctx.deps.client.hello();
  return {
    schema: SESSION_LOG_SCHEMA_ID,
    session_id: s.id,
    short_id: s.short,
    engine_version: ctx.deps.engineVersion,
    ...(s.client ? { client: s.client } : {}),
    ...(s.model ? { model: s.model } : {}),
    ...(hello
      ? {
          lightroom: {
            lrc_version: hello.lrc_version,
            sdk_declared: hello.sdk_declared,
            notices: [...lightroomNotices(hello.lrc_version), ...updateNotices(hello.plugin_version, ctx.deps.engineVersion)],
          },
        }
      : {}),
    started: s.startedAt.toISOString(),
    ended: null,
    outcome: null,
    intent: { id: intent.intent.id, label: intent.intent.label, source: intent.source },
    mode: s.mode,
    variant_count: variantCount,
    max_passes: s.maxPasses,
    guardrails: { clip_high_pct: s.limits.clipHighPct, clip_low_pct: s.limits.clipLowPct },
    clip_baseline: s.clipBaseline,
    tone_mode: s.toneMode,
    decay: [...s.decay],
    notes,
    target: {
      uuid: master.uuid,
      local_id: master.local_id,
      filename: master.filename,
      copy_name: master.copy_name,
      process_version: master.process_version,
      pipeline: master.pipeline,
      camera_profile: master.camera_profile,
    },
    snapshot: s.snapshot,
    start: { settings: s.startSettings, masks: s.startMasks },
    variants: [],
    picked: null,
    regions: [],
    passes: [],
    probes: [],
    failures: [],
    final_settings: null,
    recipe_path: null,
    revert: null,
  };
}
