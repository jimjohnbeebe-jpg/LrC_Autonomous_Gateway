// Session log schema v1 (engine 0.3.x), kept to read the logs written before v2: the Phase 3 run's
// evidence in docs\reports\phase3\P3\ [handle: tests\clip-check.test.ts "finds, in the Phase 3 run's
// twelve session logs and the chat's, …"]. New logs are v2 (session-log.ts). v1 is v2 without the
// copies: Converge mode only, every pass on the master, one region baseline.

import { z } from "zod";
import { passSchema, regionBaselineSchema, regionEntrySchema, sessionLogSchema } from "./session-log.js";

export const SESSION_LOG_V1_SCHEMA_ID = "lrc-avg/session-log/1";

export const sessionLogV1Schema = sessionLogSchema
  .omit({ variant_count: true, variants: true, picked: true })
  .extend({
    schema: z.literal(SESSION_LOG_V1_SCHEMA_ID),
    mode: z.literal("converge"),
    passes: z.array(passSchema.extend({ target: z.literal("master") })),
    regions: z.array(regionEntrySchema.omit({ baselines: true }).extend({ baseline: regionBaselineSchema.nullable() })),
  })
  .describe("LrC-AVG session log, schema v1");

/** A session log of either schema, for readers that need only what both have (passes, guardrails). */
export const anySessionLogSchema = z.union([sessionLogSchema, sessionLogV1Schema]);

export type SessionLogV1Data = z.infer<typeof sessionLogV1Schema>;
export type AnySessionLog = z.infer<typeof anySessionLogSchema>;
