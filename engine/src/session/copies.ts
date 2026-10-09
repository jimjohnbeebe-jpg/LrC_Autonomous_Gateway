// Variants mode's copies (PRD 6.6 step 1, AVG-008): what lr_begin_session checks before it writes
// anything, and the create_virtual_copies call with its failures [handle:
// tests\session-variants-faults.test.ts "refused before anything is written", "create_virtual_copies
// fails", against the Lightroom sim; in Lightroom [unverified] until PHASE4_PLAN row 10].

import { pluginVersionAtLeast, type CommandResult } from "../bridge/index.js";
import type { LoadedIntent } from "../intents/index.js";
import type { VariantEntry } from "../log/index.js";
import { ToolError, toToolError } from "../mcp/errors.js";
import { saveLog } from "./io.js";
import { SESSION_DEFAULTS } from "./rules.js";
import { COPIES_TIMEOUT_MS, VARIANT_IDS, newTarget, type Session, type SessionContext, type Target, type VariantId } from "./types.js";

/** create_virtual_copies and select_photo come with plugin 0.3.0 [handle: engine\src\bridge\protocol.ts COMMANDS]. */
export const VARIANTS_PLUGIN = "0.3.0";
export const DEFAULT_VARIANT_COUNT = SESSION_DEFAULTS.variantCount;
/**
 * 2-3 copies: the intent file names three variants, A-C (engine\src\intents\schema.ts). PRD 6.2 allows
 * 2-4; a fourth needs a variant D in the intent schema [stated: Jim, 2026-09-27, "Go with A"].
 */
export const MAX_VARIANT_COUNT = 3;

/**
 * Before anything is written: a plugin that has the commands, an intent with variants, 2-3 copies,
 * and the master selected (the plugin copies the selected photo and refuses a virtual copy as the
 * master [handle: plugin\LrC-AVG.lrplugin\Catalog.lua createCopies "bad_target"]). Returns the count.
 */
export function checkVariants(ctx: SessionContext, loaded: LoadedIntent, photo: CommandResult<"get_context">, count: number | undefined): number {
  const version = ctx.deps.client.hello()?.plugin_version;
  if (!pluginVersionAtLeast(version, VARIANTS_PLUGIN)) {
    throw new ToolError(
      "PLUGIN_TOO_OLD",
      `Variants mode needs the LrC-AVG plugin ${VARIANTS_PLUGIN} or later (it makes and selects the copies); Lightroom runs ${String(version ?? "an unknown version")}. Restart Lightroom so it loads the current plugin.`,
      false,
    );
  }
  const n = count ?? DEFAULT_VARIANT_COUNT;
  if (!Number.isInteger(n) || n < 2 || n > MAX_VARIANT_COUNT) {
    throw new ToolError("INVALID_ARGUMENTS", `variant_count must be 2-${MAX_VARIANT_COUNT} (the intent file names variants A-C); got ${n}.`, false);
  }
  if (!loaded.intent.variants) {
    throw new ToolError("INVALID_ARGUMENTS", `The intent "${loaded.intent.id}" has no variants; use mode "converge", or an intent with variants (lr_get_intent shows them).`, false);
  }
  if (photo["is_virtual_copy"] === true) {
    throw new ToolError("VIRTUAL_COPY_SELECTED", "The selected photo is a virtual copy. Select the master photo in Lightroom; Variants mode makes its own copies of it.", true);
  }
  return n;
}

/** "AVG <intent id> A" (PHASE4_PLAN assumptions); the plugin requires the "AVG " prefix [handle: plugin\LrC-AVG.lrplugin\Catalog.lua validNames()]. */
export const copyName = (s: Session, id: VariantId): string => `AVG ${s.intent.intent.id} ${id}`;

export function variantEntry(t: Target, picked: boolean): VariantEntry {
  return { id: t.id as VariantId, label: t.label ?? "", uuid: t.uuid, local_id: t.local_id, copy_name: t.copy_name ?? "", picked };
}

/**
 * Make the copies and record them as the session's variants (log first, so a failure after this
 * still names them). Every copy must come back as a virtual copy of the master with its name
 * (identity_ok, Phase 0 P-18); otherwise VARIANTS_INCOMPLETE names what was made.
 */
export async function makeCopies(ctx: SessionContext, s: Session, count: number): Promise<void> {
  const ids = VARIANT_IDS.slice(0, count);
  const names = ids.map((id) => copyName(s, id));
  const timeoutMs = ctx.deps.copiesTimeoutMs ?? COPIES_TIMEOUT_MS;
  let res: CommandResult<"create_virtual_copies">;
  try {
    res = await ctx.deps.client.request("create_virtual_copies", { target_uuid: s.master.uuid, names }, { timeoutMs });
  } catch (err) {
    throw copiesError(err, names, timeoutMs);
  }
  const variants = s.intent.intent.variants;
  for (const [i, id] of ids.entries()) {
    const copy = res.copies.find((c) => c.identity_ok && c.copy_name === names[i] && typeof c.uuid === "string");
    if (!copy) break;
    s.variants.push(
      newTarget({
        id,
        label: variants?.[id].label ?? id,
        uuid: copy.uuid as string,
        local_id: copy.local_id,
        filename: s.master.filename,
        copy_name: names[i] as string,
        process_version: s.master.process_version,
        pipeline: s.master.pipeline,
        camera_profile: s.master.camera_profile,
      }),
    );
  }
  s.log.variants = s.variants.map((t) => variantEntry(t, false));
  saveLog(s);
  if (s.variants.length === count && res.copies.length === count && !res.failure) return;
  const made = res.copies.map((c) => `"${c.copy_name ?? "?"}" (${c.uuid ?? "no uuid"}${c.identity_ok ? "" : ", not a copy of the master with that name"})`);
  throw new ToolError(
    "VARIANTS_INCOMPLETE",
    `Lightroom made ${res.copies.length} of ${count} copies${made.length ? `: ${made.join(", ")}` : ""}` +
      `${res.failure ? `; it stopped because ${res.failure.message} (${res.failure.code})` : ""}. ` +
      "End the session with revert; the copies made stay in the catalog, remove them in Lightroom when you want.",
    false,
    { copies: res.copies, ...(res.failure ? { failure: res.failure } : {}), master_selected: res.master_selected },
  );
}

/**
 * A create_virtual_copies call that failed. An error answer means no copy was made: once a copy
 * exists the plugin answers ok [handle: plugin\LrC-AVG.lrplugin\Catalog.lua header]. A timeout does
 * not say: the plugin may still be making copies whose identities no answer will bring
 * (PHASE4_PLAN "For row 7, from PR #33").
 */
function copiesError(err: unknown, names: readonly string[], timeoutMs: number): ToolError {
  const error = toToolError(err);
  const list = names.map((n) => `"${n}"`).join(", ");
  if (error.code === "BRIDGE_TIMEOUT") {
    return new ToolError(
      "BRIDGE_TIMEOUT",
      `Lightroom did not answer create_virtual_copies within ${timeoutMs / 1000} s. It may still be making the copies named ${list}; ` +
        "this session does not use them. End the session with revert, then look for them next to the master in Lightroom and remove them when you want.",
      false,
      { names },
    );
  }
  const busy = error.code === "BUSY" ? " (another selection command held Lightroom's selection)" : "";
  return new ToolError(error.code, `create_virtual_copies failed${busy}: ${error.message}. No copy was made.`, error.recoverable, { names });
}
