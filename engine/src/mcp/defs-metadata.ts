// The MCP definitions of the catalog metadata tools (tools-metadata.ts): lr_set_flag, lr_set_iptc and
// lr_get_metadata (GitHub issues #111, #112, #139 gap 4; plugin 0.22.0); lr_set_color_label and lr_set_iptc's
// creator, copyright, location and accessibility fields (issue #218 rows 2-4, plugin 1.5.0).

import { z } from "zod";
import { COLOR_LABELS, FLAGS, MAX_TEXT, NO_STACK_WRITE, TEXT_FIELDS, type FlagName, type TextField } from "../library/index.js";
import { WRITE_RULES, uuids } from "./defs-catalog.js";
import type { ToolDef } from "./defs-shared.js";
import { setColorLabel } from "./tools-metadata.js";

const flagArgs = z.object({
  uuids,
  flag: z.enum(Object.keys(FLAGS) as [FlagName, ...FlagName[]]).describe('"pick" (flagged), "reject" or "none" (unflagged)'),
});
const text = (what: string) => z.string().max(MAX_TEXT).optional().describe(`the photos' ${what}, at most ${MAX_TEXT} characters; "" empties it; left out, it stays as it is`);
/** What each lr_set_iptc field is, in Lightroom's Metadata panel words [inference: the panel's labels]. */
const TEXT_WHAT: Record<TextField, string> = {
  title: "title",
  caption: "caption (the description)",
  headline: "headline",
  creator: "IPTC creator",
  copyright: "copyright notice",
  sublocation: "IPTC sublocation",
  city: "IPTC city",
  state: "IPTC state / province",
  country: "IPTC country",
  iso_country_code: "IPTC ISO country code (2 or 3 letters)",
  alt_text: "accessibility alt text (Lightroom Classic 13.2 or later)",
  extended_description: "accessibility extended description (Lightroom Classic 13.2 or later)",
};
const iptcArgs = z
  .object({ uuids, ...Object.fromEntries(TEXT_FIELDS.map((f) => [f, text(TEXT_WHAT[f])])) } as { uuids: typeof uuids } & Record<TextField, ReturnType<typeof text>>)
  .refine((a) => TEXT_FIELDS.some((f) => a[f] !== undefined), `give at least one of ${TEXT_FIELDS.join(", ")}`);
const metadataArgs = z.object({ uuids });
const labelArgs = z.object({ uuids, label: z.enum(COLOR_LABELS).describe('the colour label; "none" removes it') });

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
    name: "lr_set_color_label",
    title: "Set colour labels",
    description: `Set the colour label of photos named by uuid: red, yellow, green, blue, purple or none. \`before\` and \`after\` give each photo's label. ${WRITE_RULES}`,
    schema: labelArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (tools, args) => tools.call(setColorLabel, args as z.infer<typeof labelArgs>),
  },
  {
    name: "lr_set_iptc",
    title: "Set IPTC text, location and alt text",
    description:
      "Set text metadata of photos named by uuid: title, caption, headline, creator, copyright, the IPTC location (sublocation, city, " +
      "state, country, iso_country_code; GPS is lr_set_gps) and the accessibility alt_text and extended_description (Lightroom Classic 13.2 " +
      "or later, else FEATURE_UNAVAILABLE). A field left out is not touched, \"\" empties it. `before` and `after` give each photo's text " +
      `fields. ${WRITE_RULES}`,
    schema: iptcArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (tools, args) => tools.setIptc(args as z.infer<typeof iptcArgs>),
  },
  {
    name: "lr_get_metadata",
    title: "Read photos' metadata",
    description:
      "Read the catalog metadata of photos named by uuid: the text fields lr_set_iptc writes (\"\" for none; alt_text and " +
      "extended_description from Lightroom Classic 13.2), flag (pick, reject or none), label (the colour label, none for none), rating, " +
      "capture_time, path, copy_name and virtual_copy, keywords (as paths, the form lr_set_keywords takes), gps ({latitude, longitude}, " +
      "null for none) and stack (null outside one, else position (1 = top), count, collapsed and top_uuid). Read these before a write so " +
      "the user sees what will change. A photo Lightroom could not find is listed in `failed`; a part it could not read is left out and " +
      `named in \`errors\`. ${NO_STACK_WRITE} Changes nothing.`,
    schema: metadataArgs,
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (tools, args) => tools.getMetadata(args as z.infer<typeof metadataArgs>),
  },
];
