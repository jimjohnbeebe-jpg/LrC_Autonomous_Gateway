// `npm run goldens`: copy the golden JPEGs the newest Phase 3 check run recorded, from
// %TEMP%\LrC-AVG\P3\golden\ to the repo's tests\golden\ (gitignored), and write
// tests\golden\golden.json (committed). See goldens.ts.

import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { goldenDir, newestResults, recordedGoldens, writeGoldens } from "./goldens.js";

const outDir = path.join(os.tmpdir(), "LrC-AVG", "P3");

async function main(): Promise<void> {
  const results = newestResults(outDir);
  if (!results) throw new Error(`no p3_check_*.json in ${outDir}; run npm run phase3:check first`);
  const recorded = recordedGoldens(JSON.parse(readFileSync(results, "utf8")));
  const golden = await writeGoldens(path.join(outDir, "golden"), goldenDir(), recorded);
  console.log(`From ${path.basename(results)}:`);
  for (const e of golden.entries) console.log(`  ${e.file}: ${e.width}x${e.height}, sha256 ${e.sha256.slice(0, 12)}…`);
  console.log(`Wrote ${path.join(goldenDir(), "golden.json")} (${golden.entries.length} entries).`);
}

main().catch((err: unknown) => {
  console.error(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
