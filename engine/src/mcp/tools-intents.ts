// The intent tools (Phase 3; ARCHITECTURE section 7): lr_list_intents, lr_get_intent,
// lr_save_intent. They read files only and never need Lightroom.

import { ToolError } from "./errors.js";
import { library, run, type ToolContext, type ToolOutput } from "./tools-shared.js";

export type SaveIntentArgs = { intent: unknown; confirmed: boolean; replace?: boolean | undefined };

export async function listIntents(ctx: ToolContext): Promise<ToolOutput> {
  return run(ctx, "lr_list_intents", {}, { usesBridge: false }, async () => {
    const lib = library(ctx);
    const { intents, warnings } = lib.list();
    const json: Record<string, unknown> = { ok: true, intents, folders: lib.directories(), ...(warnings.length ? { warnings } : {}) };
    return { json, log: { count: intents.length, warnings } };
  });
}

export async function getIntent(ctx: ToolContext, args: { id: string }): Promise<ToolOutput> {
  return run(ctx, "lr_get_intent", args, { usesBridge: false }, async () => {
    const found = library(ctx).get(args.id);
    const json = { ok: true, source: found.source, path: found.path, overrides_bundled: found.overrides_bundled, intent: found.intent };
    return { json, log: { id: args.id, source: found.source } };
  });
}

export async function saveIntent(ctx: ToolContext, args: SaveIntentArgs): Promise<ToolOutput> {
  return run(ctx, "lr_save_intent", args, { usesBridge: false }, async () => {
    // The tool's schema requires `confirmed` to be a boolean; false is refused here.
    if (args.confirmed !== true) {
      throw new ToolError("NOT_CONFIRMED", "Ask the user to approve this intent in the chat first, then call again with confirmed: true.", false);
    }
    const saved = library(ctx).save(args.intent, { replace: args.replace === true });
    const id = (args.intent as { id?: unknown }).id;
    return { json: { ok: true, id, ...saved }, log: { id, ...saved } };
  });
}
