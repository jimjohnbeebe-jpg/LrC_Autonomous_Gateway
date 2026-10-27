// lr_rename_keyword and lr_remove_keyword_subtree (GitHub issue #218 row 5; plugin 1.5.0, KeywordEdit.lua).
// Both write the catalog, so they run between sessions, in the session queue, as lr_set_keywords does
// (tools-catalog.ts). The subtree's keywords come off each photo through set_keywords, one photo per command,
// read before and after (library\write.ts writeEach): the photos named, or the selection, or with
// catalog_wide every photo holding one; at most MAX_PHOTOS a call, within CALL_BUDGET_MS. No keyword is deleted.

import { CALL_BUDGET_MS, CATALOG_READ_TIMEOUT_MS, MAX_PHOTOS, keywordsNotTaken, normalizeKeyword, writeEach, type WriteResult } from "../library/index.js";
import { WRITE_TIMEOUT_MS } from "../sync/target.js";
import { ToolError } from "./errors.js";
import { written } from "./tools-catalog.js";
import { run, sessionTools, type ToolContext, type ToolOutput } from "./tools-shared.js";

export type RenameKeywordArgs = { path: string; new_name: string };
export type RemoveSubtreeArgs = { path: string; uuids?: string[] | undefined; catalog_wide?: boolean | undefined; confirm?: boolean | undefined };

/** The path a keyword at `before` has once its last level is `name`. */
const renamed = (before: string, name: string): string => {
  const cut = before.lastIndexOf("|");
  return cut < 0 ? name : `${before.slice(0, cut + 1)}${name}`;
};

export async function renameKeyword(ctx: ToolContext, args: RenameKeywordArgs): Promise<ToolOutput> {
  return run(ctx, "lr_rename_keyword", args, async () => {
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    return sessions.whenIdle("lr_rename_keyword", async () => {
      const name = args.new_name.trim();
      const r = await ctx.deps.client.request("rename_keyword", { path: normalizeKeyword(args.path), new_name: name }, { timeoutMs: WRITE_TIMEOUT_MS });
      const want = renamed(r.before, name);
      if (r.write_error !== undefined || r.after !== want) {
        const why = r.write_error ?? (r.after === undefined ? `the name could not be read back (${r.after_error ?? "no answer"})` : `Lightroom read back ${r.after}`);
        throw new ToolError("KEYWORD_NOT_RENAMED", `${r.before} was not renamed to ${want}: ${why}. lr_list_keywords shows its name now.`, false, { before: r.before, after: r.after ?? null });
      }
      const old = r.before.slice(r.before.lastIndexOf("|") + 1);
      const undo = `To put it back, call lr_rename_keyword with path "${r.after}" and new_name "${old}".`;
      return { json: { before: r.before, after: r.after, photo_count: r.photo_count, undo }, log: { photo_count: r.photo_count } };
    });
  });
}

/** The photos to take the subtree off: the named ones, every holder (catalog_wide), or the selection. */
async function targets(ctx: ToolContext, args: RemoveSubtreeArgs, holders: string[] | undefined): Promise<string[]> {
  if (args.catalog_wide === true) return holders ?? [];
  if (args.uuids !== undefined) return args.uuids;
  const sel = await ctx.deps.client.request("get_selection", { max: MAX_PHOTOS });
  if (sel.count > MAX_PHOTOS) throw new ToolError("TOO_MANY_PHOTOS", `${sel.count} photos are selected; select at most ${MAX_PHOTOS}, or name them by uuid.`, false);
  return sel.photos.map((p) => p.uuid).filter((u): u is string => typeof u === "string");
}

export async function removeKeywordSubtree(ctx: ToolContext, args: RemoveSubtreeArgs, budgetMs = CALL_BUDGET_MS): Promise<ToolOutput> {
  return run(ctx, "lr_remove_keyword_subtree", args, async () => {
    if (args.catalog_wide === true && args.confirm !== true) {
      throw new ToolError("CONFIRM_REQUIRED", "catalog_wide takes the keywords off every photo in the catalog: ask the user, then call again with confirm: true.", false);
    }
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    return sessions.whenIdle("lr_remove_keyword_subtree", async () => {
      const tree = await ctx.deps.client.request("keyword_subtree", { path: normalizeKeyword(args.path), photos: args.catalog_wide === true }, { timeoutMs: CATALOG_READ_TIMEOUT_MS });
      const all = await targets(ctx, args, tree.uuids);
      const deadline = Date.now() + budgetMs;
      const out: WriteResult<string[]> = { photos: [], failed: [] };
      let done = 0;
      while (done < Math.min(all.length, MAX_PHOTOS) && (done === 0 || Date.now() < deadline)) {
        const chunk = all.slice(done, Math.min(done + 10, MAX_PHOTOS));
        const r = await writeEach(
          chunk,
          (uuid) => ctx.deps.client.request("set_keywords", { photo_uuid: uuid, add: [], remove: tree.paths }, { timeoutMs: WRITE_TIMEOUT_MS }),
          (w) => keywordsNotTaken(w.after, [], tree.paths),
          "keywords",
          "KEYWORDS_NOT_TAKEN",
        );
        out.photos.push(...r.photos);
        out.failed.push(...r.failed);
        done += chunk.length;
      }
      const rest = all.slice(done);
      const more = args.catalog_wide === true ? { remaining: (tree.photo_count ?? all.length) - done } : { not_yet: rest };
      const next = rest.length > 0 ? { next: args.catalog_wide === true ? "Call again with the same arguments for the next photos." : "Call again with uuids set to `not_yet`." } : {};
      const undo = "To put a photo back, call lr_set_keywords on it with add set to the paths in its `before` that are not in its `after`.";
      return written(out, { keywords: tree.paths, ...(rest.length > 0 ? more : {}), ...next, keywords_note: "The keywords stay in the catalog's Keyword List.", undo });
    });
  });
}
