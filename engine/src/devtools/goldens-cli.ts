// `npm run goldens`: copy the Phase 3 check's golden JPEGs from %TEMP%\LrC-AVG\P3\golden\ to
// tests\golden\ (gitignored) and write tests\golden\golden.json (committed). See goldens.ts.

import os from "node:os";
import path from "node:path";
import { goldenDir, writeGoldens } from "./goldens.js";

const from = path.join(os.tmpdir(), "LrC-AVG", "P3", "golden");
writeGoldens(from, goldenDir()).then(
  (golden) => {
    for (const e of golden.entries) console.log(`${e.file}: ${e.width}x${e.height}, sha256 ${e.sha256.slice(0, 12)}…`);
    console.log(`Wrote ${path.join(goldenDir(), "golden.json")} (${golden.entries.length} entries).`);
  },
  (err: unknown) => {
    console.error(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  },
);
