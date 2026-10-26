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
import { PIPELINES } from "../params/index.js";
import { ToolError } from "./errors.js";
import { LOOK_LEFT_OUT, captureLook } from "./look-capture.js";
import { library, pageBridgeUse, readPageFolders, run, type ToolContext, type ToolOutput } from "./tools-shared.js";

export type SaveIntentArgs = { intent: Record<string, unknown>; confirmed: boolean; replace?: boolean | undefined; from_photo?: boolean | undefined; dry_run?: boolean | undefined };
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
  return run(ctx, "lr_save_intent", args, args.from_photo === true ? { usesBridge: true } : pageBridgeUse(ctx), async () => {
    // The tool's schema requires `confirmed` to be a boolean; false is refused here. A dry run writes nothing, so needs no approval.
    if (args.confirmed !== true && args.dry_run !== true) {
      throw notConfirmed("this intent");
    }
    // A capture is only a preview: the save takes the returned intent, so what is written is what the user
    // approved, even if the photo or its settings changed meanwhile (Greptile, PR #206).
    if (args.from_photo === true && args.dry_run !== true) {
      throw new ToolError("INVALID_ARGUMENTS", "from_photo works only with dry_run: true. Show the user the intent it returns, then save that intent unchanged (without from_photo) with confirmed: true.", false);
    }
    const { intent, photo } = args.from_photo === true ? await fromPhoto(ctx, args.intent) : { intent: args.intent, photo: null };
    const id = (intent as { id?: unknown }).id;
    const from = photo ? { from_photo: photo } : {};
    if (args.dry_run === true) {
      const checked = library(ctx).check(intent);
      return { json: { ok: true, dry_run: true, written: false, id, intent: checked, ...from }, log: { id, dry_run: true, ...from } };
    }
    const folder = await intentsFolder(ctx);
    const saved = library(ctx).save(intent, { replace: args.replace === true });
    const notes = migrationNotes();
    return { json: { ok: true, id, ...saved, ...from, ...folder, ...notes }, log: { id, ...saved, ...from, ...folder, ...notes } };
  });
}

/**
 * The candidate with the look of the photo selected in Lightroom (look-capture.ts): schema v3, the
 * photo's profile unless the candidate names one, and the photo's values under the candidate's own `set` values.
 */
async function fromPhoto(ctx: ToolContext, candidate: Record<string, unknown>): Promise<{ intent: Record<string, unknown>; photo: Record<string, unknown> }> {
  const { client, map } = ctx.deps;
  await ctx.deps.ensureBridge();
  const photo = await client.request("get_context", {});
  const view = map.fromSdk((await client.request("get_settings", { target_uuid: photo.uuid })).settings);
  const look = captureLook(view, map.cameraProfiles());
  const own = (key: string): Record<string, unknown> => (candidate[key] as Record<string, unknown> | undefined) ?? {};
  const byPipeline = own("set_by_pipeline");
  const setByPipeline = Object.fromEntries(
    PIPELINES.map((p) => [p, { ...look.set_by_pipeline[p], ...(byPipeline[p] as Record<string, unknown> | undefined) }]).filter(([, v]) => Object.keys(v as object).length > 0),
  );
  const intent: Record<string, unknown> = {
    priors: {},
    ...candidate,
    schema_version: 3,
    ...(candidate["profile"] === undefined && look.profile ? { profile: look.profile } : {}),
    set: { ...look.set, ...own("set") },
    ...(Object.keys(setByPipeline).length ? { set_by_pipeline: setByPipeline } : {}),
  };
  const info = {
    uuid: photo.uuid,
    filename: photo.filename ?? null,
    pipeline: view.pipeline,
    captured: Object.keys(look.set).length + Object.keys(look.set_by_pipeline[view.pipeline] ?? {}).length,
    left_out: LOOK_LEFT_OUT,
    ...(look.profile ? {} : { note: "the photo's camera profile is not one the engine has pinned, so the look keeps each photo's profile" }),
  };
  return { intent, photo: info };
}

export async function deleteIntent(ctx: ToolContext, args: DeleteIntentArgs): Promise<ToolOutput> {
  return run(ctx, "lr_delete_intent", args, pageBridgeUse(ctx), async () => {
    if (args.confirmed !== true) throw notConfirmed("deleting this intent");
    const folder = await intentsFolder(ctx);
    const deleted = library(ctx).delete(args.id);
    return { json: { ok: true, id: args.id, ...deleted, ...folder }, log: { id: args.id, ...deleted, ...folder } };
  });
}
