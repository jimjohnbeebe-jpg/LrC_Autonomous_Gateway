// `npm run schemas`: write engine\schemas\*.schema.json from the engine's zod schemas (schemas.ts).

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { generatedSchemas, schemasDir } from "./schemas.js";

mkdirSync(schemasDir(), { recursive: true });
for (const [name, text] of generatedSchemas()) {
  const file = path.join(schemasDir(), name);
  writeFileSync(file, text, "utf8");
  console.log(`wrote ${file}`);
}
