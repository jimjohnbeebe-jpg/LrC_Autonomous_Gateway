// The JSON Schema files in engine\schemas\, generated from the engine's zod schemas so they cannot
// drift from what the engine accepts. `npm run schemas` writes them; the "schemas" tests in
// tests\intents.test.ts fail when a checked-in file differs from what would be generated.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { intentJsonSchema } from "../intents/index.js";
import { recipeSchema, sessionLogSchema } from "../log/index.js";

/** engine\schemas\ (this file is <engine>\{src,dist}\devtools\schemas.*). */
export function schemasDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "schemas");
}

/** File name -> file text. */
export function generatedSchemas(): Map<string, string> {
  const withId = (id: string, schema: Record<string, unknown>): Record<string, unknown> => {
    const { $schema, ...rest } = schema;
    return { $schema, $id: id, ...rest };
  };
  const json = (id: string, schema: Record<string, unknown>): string => `${JSON.stringify(withId(id, schema), null, 2)}\n`;
  const fromZod = (schema: z.ZodType): Record<string, unknown> => z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  return new Map([
    ["intent.schema.json", json("lrc-avg/intent.schema.json", intentJsonSchema())],
    ["session-log.schema.json", json("lrc-avg/session-log.schema.json", fromZod(sessionLogSchema))],
    ["recipe.schema.json", json("lrc-avg/recipe.schema.json", fromZod(recipeSchema))],
  ]);
}
