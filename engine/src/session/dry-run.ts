// lr_begin_session dry_run (issue #161): the checks lr_begin_session makes and what pass 0 would write, with no
// snapshot, no write and no session (begin.ts checkBegin, pass0.ts planPass0). It renders nothing, so it cannot say
// what the clipping baseline (clip_baseline) would add after pass 0, nor give metrics.

import { lightroomNotices, updateNotices } from "../bridge/index.js";
import { startOffZero, type Checked } from "./begin.js";
import { VARIANT_IDS, type SessionContext, type SessionOutput } from "./types.js";
import { planPass0 } from "./pass0.js";

export function dryRun(ctx: SessionContext, c: Checked, advisory: string | null): SessionOutput {
  const { loaded, view, settings, photo } = c;
  const s = { intent: loaded, profile: c.args.profile ?? null };
  const plan = (variant: Parameters<typeof planPass0>[4]) => planPass0(ctx.deps.map, s, view.pipeline, view.settings, variant);
  const variants = loaded.intent.variants;
  const copies = c.variantCount === null ? null : VARIANT_IDS.slice(0, c.variantCount).map((id) => ({ id, label: variants?.[id].label ?? id, pass0: plan(variants?.[id] ?? null) }));
  const hello = ctx.deps.client.hello();
  const clipBaseline = c.args.clip_baseline ?? loaded.intent.clip_baseline ?? false;
  return {
    json: {
      ok: true,
      dry_run: true,
      mode: c.mode,
      target: { uuid: photo.uuid, filename: photo["filename"] ?? null, process_version: view.process_version, pipeline: view.pipeline, camera_profile: view.camera_profile.name },
      intent: { id: loaded.intent.id, label: loaded.intent.label, source: loaded.source },
      intent_brief: loaded.intent.brief,
      guardrails: { clip_high_pct: settings.clipHighPct, clip_low_pct: settings.clipLowPct },
      clip_baseline: clipBaseline,
      max_passes: settings.maxPasses,
      ...(copies ? { variants: copies } : { pass0: plan(null) }),
      start_off_zero: startOffZero(view.settings),
      notices: hello ? [...lightroomNotices(hello.lrc_version), ...updateNotices(hello.plugin_version, ctx.deps.engineVersion)] : [],
      ...(advisory ? { advisory } : {}),
      note:
        "Dry run: nothing was written, no snapshot was made and no session is open. `pass0.changes` is what pass 0 would write as one History step" +
        `${clipBaseline ? "; with clip_baseline it then pulls clipping in, which only a render shows" : ""}. Call lr_begin_session without dry_run to start.`,
    },
    log: { dry_run: true, intent_id: loaded.intent.id, target: { uuid: photo.uuid }, mode: c.mode },
  };
}
