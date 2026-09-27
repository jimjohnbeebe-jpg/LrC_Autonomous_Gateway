// `npm run goldens`: copy the golden JPEGs of the newest Phase 3 check run that captured all six
// fixtures, from %TEMP%\LrC-AVG\P3\golden_<time>\ to the repo's tests\golden\ (gitignored), and
// write tests\golden\golden.json (committed). See goldens.ts.

import os from "node:os";
import path from "node:path";
import { goldenDir, newestCompleteRun, writeGoldens } from "./goldens.js";
import { FIXTURES } from "./phase3-check.js";

const outDir = path.join(os.tmpdir(), "LrC-AVG", "P3");

async function main(): Promise<void> {
  const run = newestCompleteRun(outDir, FIXTURES);
  if (!run) throw new Error(`no check run in ${outDir} captured all ${FIXTURES.length} fixtures; run npm run phase3:check first`);
  const golden = await writeGoldens(outDir, goldenDir(), run.recorded);
  console.log(`From ${path.basename(run.results)}:`);
  for (const e of golden.entries) console.log(`  ${e.file}: ${e.width}x${e.height}, sha256 ${e.sha256.slice(0, 12)}…`);
  console.log(`Wrote ${path.join(goldenDir(), "golden.json")} (${golden.entries.length} entries).`);
}

main().catch((err: unknown) => {
  console.error(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
