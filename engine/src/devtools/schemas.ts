// The JSON Schema files in engine\schemas\, generated from the engine's zod schemas so they cannot
// drift from what the engine accepts. `npm run schemas` writes them; tests\schemas.test.ts fails
// when a checked-in file differs from what would be generated.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { intentJsonSchema } from "../intents/index.js";

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
  return new Map([["intent.schema.json", `${JSON.stringify(withId("lrc-avg/intent.schema.json", intentJsonSchema()), null, 2)}\n`]]);
}
