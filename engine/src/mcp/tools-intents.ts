// The intent tools (Phase 3; ARCHITECTURE section 7): lr_list_intents, lr_get_intent,
// lr_save_intent, lr_delete_intent (issue #108). They read and write intent files. With the settings page (PHASE5_PLAN row 3) they
// first ask Lightroom for the page's intents folder (tools-shared.ts readPageFolders, at most
// PAGE_WAIT_MS); without an answer they use the folder read before, else the variable's or the
// default, and the result names the folder and why, where it really is on disk (`real_path`), whether
// Windows redirects this engine's AppData files (`virtualized`, `package`, and a `warning` when the
// folder is under AppData; issue #180) and, once, what moved into the default folder from the older
// ones (`notes`; intents\migrate.ts). An engine without the page (the checks, the tests) never needs
// Lightroom here.

import { takeMigrationNotes } from "../intents/index.js";
import { ToolError } from "./errors.js";
import { library, pageBridgeUse, readPageFolders, run, type ToolContext, type ToolOutput } from "./tools-shared.js";

export type SaveIntentArgs = { intent: unknown; confirmed: boolean; replace?: boolean | undefined };
export type DeleteIntentArgs = { id: string; confirmed: boolean };

const notConfirmed = (what: string) => new ToolError("NOT_CONFIRMED", `Ask the user to approve ${what} in the chat first, then call again with confirmed: true.`, false);

/** Read the page, then what the result says about the intents folder. */
async function intentsFolder(ctx: ToolContext): Promise<Record<string, unknown>> {
  const page = await readPageFolders(ctx);
  const settings = ctx.deps.settings;
  if (page === null || !settings) return {};
  const choice = settings.folders.intents();
  return { intents_folder: { ...choice, ...settings.folders.locate(choice.path), page } };
}

/** What moved into the default folder since the last call, as the field the result adds (empty when nothing did). */
function migrationNotes(): Record<string, unknown> {
  const notes = takeMigrationNotes();
  return notes.length ? { notes } : {};
}

export async function listIntents(ctx: ToolContext): Promise<ToolOutput> {
  return run(ctx, "lr_list_intents", {}, pageBridgeUse(ctx), async () => {
    const folder = await intentsFolder(ctx);
    const lib = library(ctx);
    const { intents, warnings } = lib.list();
    const notes = migrationNotes();
    const json: Record<string, unknown> = { ok: true, intents, folders: lib.directories(), ...folder, ...(warnings.length ? { warnings } : {}), ...notes };
    return { json, log: { count: intents.length, warnings, ...folder, ...notes } };
  });
}

export async function getIntent(ctx: ToolContext, args: { id: string }): Promise<ToolOutput> {
  return run(ctx, "lr_get_intent", args, pageBridgeUse(ctx), async () => {
    const folder = await intentsFolder(ctx);
    const found = library(ctx).get(args.id);
    const json = { ok: true, source: found.source, path: found.path, overrides_bundled: found.overrides_bundled, intent: found.intent, ...folder };
    return { json, log: { id: args.id, source: found.source, ...folder } };
  });
}

export async function saveIntent(ctx: ToolContext, args: SaveIntentArgs): Promise<ToolOutput> {
  return run(ctx, "lr_save_intent", args, pageBridgeUse(ctx), async () => {
    // The tool's schema requires `confirmed` to be a boolean; false is refused here.
    if (args.confirmed !== true) {
      throw notConfirmed("this intent");
    }
    const folder = await intentsFolder(ctx);
    const saved = library(ctx).save(args.intent, { replace: args.replace === true });
    const id = (args.intent as { id?: unknown }).id;
    const notes = migrationNotes();
    return { json: { ok: true, id, ...saved, ...folder, ...notes }, log: { id, ...saved, ...folder, ...notes } };
  });
}

export async function deleteIntent(ctx: ToolContext, args: DeleteIntentArgs): Promise<ToolOutput> {
  return run(ctx, "lr_delete_intent", args, pageBridgeUse(ctx), async () => {
    if (args.confirmed !== true) throw notConfirmed("deleting this intent");
    const folder = await intentsFolder(ctx);
    const deleted = library(ctx).delete(args.id);
    return { json: { ok: true, id: args.id, ...deleted, ...folder }, log: { id: args.id, ...deleted, ...folder } };
  });
}
