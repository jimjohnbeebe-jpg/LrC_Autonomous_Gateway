// The MCP definitions of the catalog metadata tools (tools-metadata.ts): lr_set_flag, lr_set_iptc and
// lr_get_metadata (GitHub issues #111, #112, #139 gap 4; plugin 0.22.0).

import { z } from "zod";
import { FLAGS, MAX_TEXT, NO_STACK_WRITE, TEXT_FIELDS, type FlagName } from "../library/index.js";
import { WRITE_RULES, uuids } from "./defs-catalog.js";
import type { ToolDef } from "./defs-shared.js";

const flagArgs = z.object({
  uuids,
  flag: z.enum(Object.keys(FLAGS) as [FlagName, ...FlagName[]]).describe('"pick" (flagged), "reject" or "none" (unflagged)'),
});
const text = (what: string) => z.string().max(MAX_TEXT).optional().describe(`the photos' ${what}, at most ${MAX_TEXT} characters; "" empties it; left out, it stays as it is`);
const iptcArgs = z
  .object({ uuids, title: text("title"), caption: text("caption (the description)"), headline: text("headline") })
  .refine((a) => TEXT_FIELDS.some((f) => a[f] !== undefined), "give at least one of title, caption, headline");
const metadataArgs = z.object({ uuids });

export const METADATA_DEFS: ToolDef[] = [
  {
    name: "lr_set_flag",
    title: "Set pick flags",
    description: `Set the pick flag of photos named by uuid: pick, reject or none. \`before\` and \`after\` give each photo's flag. ${WRITE_RULES}`,
    schema: flagArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (tools, args) => tools.setFlag(args as z.infer<typeof flagArgs>),
  },
  {
    name: "lr_set_iptc",
    title: "Set title, caption and headline",
    description:
      "Set the IPTC title, caption and/or headline of photos named by uuid; a field left out is not touched, \"\" empties it. " +
      `\`before\` and \`after\` give each photo's three fields. ${WRITE_RULES}`,
    schema: iptcArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (tools, args) => tools.setIptc(args as z.infer<typeof iptcArgs>),
  },
  {
    name: "lr_get_metadata",
    title: "Read photos' metadata",
    description:
      "Read the catalog metadata of photos named by uuid: title, caption, headline (\"\" for none), flag (pick, reject or none), " +
      "keywords (as paths, the form lr_set_keywords takes), gps ({latitude, longitude}, null for none) and stack (null outside one, else " +
      "position (1 = top), count, collapsed and top_uuid). Read these before a write so the user sees what will change. A photo Lightroom " +
      `could not find is listed in \`failed\`; a part it could not read is left out and named in \`errors\`. ${NO_STACK_WRITE} Changes nothing.`,
    schema: metadataArgs,
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (tools, args) => tools.getMetadata(args as z.infer<typeof metadataArgs>),
  },
];
