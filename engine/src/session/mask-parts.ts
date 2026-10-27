// An AI part added to a mask (GitHub issue #131, params\mask-combine.ts), made by Lightroom as a new AI mask
// is (ai-update.ts updateAndWait: the plugin's guard over every AI part, the wait, the dialog and stuck
// verdicts), by the table route only: LrDevelopController's createNewMask makes a mask of its own, not a part
// [inference: capture 2's calls each made a new mask, ai-masks.ts], and one person's kinds are not offered as
// a part (mask-combine.ts). When Lightroom gives no result, the mask is put back as it was before the pass, from
// a fresh read (the other masks, the user's changes included, stay), not taken out as a new mask is
// (ai-masks.ts takeOut). Written only once params\mask-combine.ts VERIFIED_FORMS lists an AI part's form.
// [handle: tests\session-masks-combine.test.ts, against the Lightroom sim; in Lightroom [unverified] until
// `npm run masks:combine` (docs\reports\phase8.5\mask-combine.md).]

import { pluginVersionAtLeast } from "../bridge/index.js";
import { ToolError, featureUnavailable, toToolError } from "../mcp/errors.js";
import { KIND_LABELS, correctionIds, readTable } from "../params/index.js";
import type { AiJob, AiResult } from "./ai-masks.js";
import { autoRevert, stuckError } from "./ai-revert.js";
import { updateAndWait } from "./ai-update.js";
import { historyName, readSdk, writeTable } from "./io.js";
import type { Session, SessionContext } from "./types.js";

/**
 * The plugin whose guard waits for an AI part wherever it is (Pending.lua, plugin 0.21.0). An older one reads the
 * first part only, and a radial there never shows a digest, so it would refuse every write to the photo until
 * Lightroom restarts [inference: Pending.lua 0.20.0 computing()]. Checked before the table is written.
 */
export const AI_PART_PLUGIN = "0.21.0";

export function checkAiPartPlugin(ctx: SessionContext): void {
  const version = ctx.deps.client.hello()?.plugin_version;
  if (version === undefined || pluginVersionAtLeast(version, AI_PART_PLUGIN)) return;
  throw new ToolError("PLUGIN_TOO_OLD", `An AI part needs the LrC-AVG plugin ${AI_PART_PLUGIN} or later; Lightroom runs ${version}. Nothing was written and the pass is not used. Restart Lightroom so it loads the current plugin.`, false);
}

const STOPS = ["BRIDGE_DISCONNECTED", "BRIDGE_TIMEOUT", "TARGET_CHANGED", "SESSION_ENDED"];

const GONE = "the mask is no longer in the table, so nothing was put back";

/** The mask `job.id` as it was before the pass, written into the table as it is now; null when done, GONE when the mask is gone, else why it may not be. */
export async function putBackPart(ctx: SessionContext, s: Session, job: AiJob): Promise<string | null> {
  try {
    const now = readTable((await readSdk(ctx, s, job.t)).sdk);
    const i = correctionIds(now).indexOf(job.id);
    const was = job.before[correctionIds(job.before).indexOf(job.id)];
    if (i < 0) return GONE;
    if (!was) return null;
    now[i] = was;
    const name = historyName(s, job.t, job.n, "mask ai revert");
    await writeTable(ctx, s, job.t, now, name, true);
    job.historyNames.push(name);
    return null;
  } catch (err) {
    if (STOPS.includes(toToolError(err).code)) throw err;
    return `putting the mask back failed: ${toToolError(err).message}`;
  }
}

/** Make the AI part of mask `job.id`, whose table the pass has just written; MASK_NOTHING_FOUND, LIGHTROOM_DIALOG, LIGHTROOM_STUCK or FEATURE_UNAVAILABLE when Lightroom gives none. */
export async function makeAiPart(ctx: SessionContext, s: Session, job: AiJob): Promise<AiResult> {
  const u = await updateAndWait(ctx, s, job);
  if (u.kind === "computed") return { sdk: u.sdk, id: job.id, route: "table", update_ms: u.update_ms, computed_ms: u.computed_ms, ...(u.dialog_ms !== undefined ? { dialog_ms: u.dialog_ms } : {}) };
  if (u.kind === "dialog") return autoRevert(ctx, s, job, u.why, "dialog", (j) => putBackPart(ctx, s, j));
  if (u.kind === "stuck") throw stuckError(s, job, u.why, u.failed);
  const left = await putBackPart(ctx, s, job);
  const back = left === GONE ? GONE : left ? `the mask may still hold the part (${left}): lr_list_masks shows it` : "the mask was put back as it was before this pass";
  if (u.kind === "not_found") {
    throw new ToolError("MASK_NOTHING_FOUND", `Lightroom found no ${KIND_LABELS[job.kind]} in this photo (its ErrorReason ${u.reason}), so ${back}; the pass is not used. Try another kind of part.`, true, {
      session_id: s.id, kind: job.kind, error_reason: u.reason, history_names: job.historyNames, ...(left ? { left } : {}),
    });
  }
  throw featureUnavailable(`An AI ${job.kind} part`, ctx.deps.client.hello(), `the mask table route did not make it (${u.why}), and a part has no LrDevelopController route; ${back}; the pass is not used.`, { routes_tried: [{ route: "table", why: u.why }] });
}
