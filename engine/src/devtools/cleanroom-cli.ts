// `npm run cleanroom -- --park | --verify-gone [--expect-data-gone] | --restore | --status`, with
// `--dry-run` for --park and --restore (vault PHASE9_PLAN.md D9.1). Prints a headline (CLEAN, GONE or
// RESTORED: YES/NO) and saves the run to %TEMP%\LrC-AVG\cleanroom\ (rule 04: harnesses save their own
// results); a dry run saves nothing. Exit 0 when the headline is YES.

import { parseArgs, printRun, runCleanroom, saveRun } from "./cleanroom-run.js";
import { realSys } from "./cleanroom-sys.js";

const args = parseArgs(process.argv.slice(2));
if (typeof args === "string") {
  console.error(args);
  process.exit(2);
}
const sys = realSys();
const run = await runCleanroom(sys, args.command, args.dryRun, args.expectDataGone);
printRun(run);
const file = saveRun(sys, run);
if (file) console.log(`Saved: ${file}`);
process.exit(run.ok ? 0 : 1);
