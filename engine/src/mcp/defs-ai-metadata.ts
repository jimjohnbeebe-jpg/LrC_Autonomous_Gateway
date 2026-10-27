// The MCP definitions of lr_set_ai_metadata and lr_get_ai_metadata (GitHub issue #218 row 9, tools-ai-metadata.ts).

import { z } from "zod";
import { WRITE_RULES, uuids } from "./defs-catalog.js";
import type { ToolDef } from "./defs-shared.js";
import { getAiMetadata, setAiMetadata } from "./tools-ai-metadata.js";

/** Upstream's limits [upstream claim: Automaat/lightroom-mcp@1040453 HandlerAiMetadata.lua:30-39]. */
const MAX_REASON = 1024;

const setArgs = z
  .object({
    uuids,
    score: z.number().int().min(0).max(100).nullable().optional().describe("an AI score, 0-100; null clears it; left out, it stays"),
    reason: z.string().max(MAX_REASON).nullable().optional().describe(`why, at most ${MAX_REASON} characters; null clears it; left out, it stays`),
  })
  .refine((a) => a.score !== undefined || a.reason !== undefined, "give score or reason");
const getArgs = z.object({ uuids });

export const AI_METADATA_DEFS: ToolDef[] = [
  {
    name: "lr_set_ai_metadata",
    title: "Keep an AI score and reason on photos",
    description:
      "Keep an AI's score (0-100) and reason on photos named by uuid, in LrC-AVG's private plug-in metadata (not IPTC, not shown in " +
      `Lightroom's panels). \`before\` and \`after\` give each photo's {score, reason}. ${WRITE_RULES}`,
    schema: setArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (tools, args) => tools.call(setAiMetadata, args as z.infer<typeof setArgs>),
  },
  {
    name: "lr_get_ai_metadata",
    title: "Read photos' AI score and AVG edit stamp",
    description:
      "Read the AI score and reason lr_set_ai_metadata kept on photos named by uuid (null for none), and avg_edit: the session_id, look " +
      "(the intent) and date an accepted LrC-AVG edit left on the photo (null when none did; Lightroom shows these as AVG session, AVG look " +
      "and AVG edit date in the Metadata panel and can search them). A photo Lightroom could not find is listed in `failed`. Changes nothing.",
    schema: getArgs,
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (tools, args) => tools.call(getAiMetadata, args as z.infer<typeof getArgs>),
  },
];
