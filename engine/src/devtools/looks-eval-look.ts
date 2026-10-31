// `npm run looks:eval -- --look-from <uuid or "selected"> --look-id <id>` (Phase 10 row 6): the first look without a chat. The photo
// is selected by uuid, then lr_save_intent's own code runs twice, as a chat would call it (mcp\tools-intents.ts):
// `from_photo: true` with `dry_run: true` (from_photo works only with a dry run) captures the photo's whole global
// edit (mcp\look-capture.ts), Jim sees a summary and answers y/n here, and on y the returned intent is saved unchanged
// with `confirmed: true` into the user intents folder (intents\folder.ts defaultUserIntentsDir). An id that exists is
// refused, never replaced.

import { sleep } from "./phase5-config.js";
import { SELECT_SETTLE_MS } from "./phase8-config.js";
import type { EvalDeps } from "./looks-eval-run.js";

/** `--look-from selected`: the one photo selected in Lightroom, so Jim never copies a uuid. */
export const SELECTED = "selected";

/** The look's brief: what it is and where it came from; the same text for every look this helper saves. */
export const lookBrief = (filename: string): string =>
  `A look saved from the edit of ${filename} (npm run looks:eval -- --look-from). Pass 0 writes its settings; then refine from there for this photo.`;

/** The candidate lr_save_intent's from_photo fills (it adds schema_version, profile, set and set_by_pipeline). */
export const lookCandidate = (id: string, filename: string): Record<string, unknown> => ({ id, label: id, category: "look", brief: lookBrief(filename), priors: {} });

/** The lines Jim reads before the y/n. */
export function lookSummary(intent: Record<string, unknown>, info: Record<string, unknown>): string[] {
  const set = Object.keys((intent["set"] as Record<string, unknown> | undefined) ?? {}).sort();
  const profile = intent["profile"] as { raw?: string; rendered?: string } | undefined;
  return [
    `Photo: ${String(info["filename"] ?? info["uuid"])} (${String(info["pipeline"])}), ${String(info["captured"])} settings captured.`,
    `Profile: ${profile ? `raw "${profile.raw}", rendered "${profile.rendered}"` : "none (each photo keeps its own)"}.`,
    `Settings: ${set.slice(0, 16).join(", ")}${set.length > 16 ? ` and ${set.length - 16} more` : ""}.`,
    `Left out: ${String(info["left_out"])}.`,
    ...(info["note"] ? [`Note: ${String(info["note"])}.`] : []),
  ];
}

/** The exit code: 0 saved, 1 refused or failed, 2 not saved (Jim's n or no answer). */
export async function lookFrom(deps: EvalDeps, given: string, id: string): Promise<number> {
  let uuid = given;
  if (given === SELECTED) {
    const now = await deps.client.request("get_selection", { max: 2 });
    if (now.count !== 1 || typeof now.photos[0]?.uuid !== "string") {
      deps.say(`Stopped: select ONE photo in Lightroom's Library grid (${now.count} selected), then run this again. Nothing was written.`);
      return 1;
    }
    uuid = now.photos[0].uuid;
  }
  const sel = await deps.client.request("select_photo", { uuid });
  await sleep(SELECT_SETTLE_MS);
  const filename = sel.filename ?? uuid;
  const dry = (await deps.tools.saveIntent({ intent: lookCandidate(id, filename), confirmed: false, from_photo: true, dry_run: true })).json;
  const intent = dry["intent"] as Record<string, unknown> | undefined;
  const info = (dry["from_photo"] as Record<string, unknown> | undefined) ?? {};
  if (!intent || info["uuid"] !== uuid) {
    deps.say(`Stopped: the photo read was ${String(info["uuid"])}, not ${uuid}. Nothing was written.`);
    return 1;
  }
  deps.say("");
  for (const line of lookSummary(intent, info)) deps.say(line);
  const a = await deps.ask(`Save this edit as the user intent "${id}" (a look for arm B)?`);
  if (a !== "y") {
    deps.say("Not saved. Nothing was written.");
    return 2;
  }
  try {
    const saved = (await deps.tools.saveIntent({ intent, confirmed: true })).json;
    deps.say(`Saved: ${String(saved["path"] ?? id)}. Use it with: npm run looks:eval -- --b-intent ${id}`);
    return 0;
  } catch (err) {
    deps.say(`Not saved: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
