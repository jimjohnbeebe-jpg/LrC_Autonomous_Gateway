// lr_remove_photos (decision D3 of epic #207, issue #218 row 10): photos named by uuid removed from the catalog by
// Lightroom's own LrSelection.removeFromCatalog (plugin Remove.lua: the 14.3 check, the selection read back as exactly
// the photos, a master refused without all its virtual copies). Only between sessions (SessionManager.whenIdle), and
// a photo a stopped engine's session left open, its master or one of its Variants copies, is refused before anything
// is sent. The files stay on disk [upstream claim: Automaat/lightroom-mcp 1040453, tool-contracts.ts
// remove_photos_from_catalog]; the photos' catalog edits and metadata are gone. What a re-import brings back (an XMP
// sidecar's settings, say) is [inference], not tried.

import { WRITE_TIMEOUT_MS } from "../sync/target.js";
import { ToolError } from "./errors.js";
import { DECISIONS_PLUGIN, leftOpenOn } from "./tools-develop.js";
import { needPlugin, run, sessionTools, type ToolContext, type ToolOutput } from "./tools-shared.js";

export type RemovePhotosArgs = { uuids: string[]; confirm: true };

export function removePhotos(ctx: ToolContext, args: RemovePhotosArgs): Promise<ToolOutput> {
  return run(ctx, "lr_remove_photos", args, async () => {
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    needPlugin(ctx, "lr_remove_photos", DECISIONS_PLUGIN, "it has the remove_photos command");
    return sessions.whenIdle("lr_remove_photos", async () => {
      for (const uuid of args.uuids) {
        const open = leftOpenOn(ctx, uuid);
        if (open) {
          throw new ToolError("SESSION_LEFT_OPEN", `Nothing was removed: session ${open.session_id}, left open by an engine that stopped, edits ${uuid}; end it with lr_end_session first.`, false, { session_id: open.session_id, uuid });
        }
      }
      const r = await ctx.deps.client.request("remove_photos", { photo_uuids: args.uuids, confirm: true }, { timeoutMs: WRITE_TIMEOUT_MS });
      const json = {
        ...r,
        note:
          "Removed from the catalog only: the files stay on disk, and lr_import_photos imports them again, but what only the catalog held " +
          "(Develop settings, keywords, collections and other metadata not saved to the files) does not come back.",
      };
      return { json, log: { status: r.status, removed: r.removed.length, not_removed: r.not_removed.length, missing: r.missing.length } };
    });
  });
}
