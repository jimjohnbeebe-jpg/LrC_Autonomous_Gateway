// What `lrc-avg-setup` does (setup-cli.ts is the thin entry point), as a function so the tests can run it:
// the arguments, the config work (apply-config.ts) and, with --installer, the result files for the
// Windows setup (setup-result.ts). Returns what the command prints and its exit code.

import { existsSync } from "node:fs";
import { applyDesktopConfig, describeResult, SetupError, type ApplyResult } from "./apply-config.js";
import { engineEntry } from "./desktop-config.js";
import { clearSetupResult, dataDir, failureOf, resultOf, writeSetupResult, type SetupAction, type SetupResult } from "./setup-result.js";

const USAGE = "Usage: lrc-avg-setup [--remove] [--dry-run] [--config <path>] [--installer]";
const RESTART = "Next: quit Claude Desktop (right-click the Claude icon in the Windows system tray > Quit), then start it again.";

export type SetupContext = {
  /** The installed engine's dist\mcp\main.js, which the config entry runs. */
  mainJs: string;
  /** The Node that runs it: the entry is this path plus mainJs, never "node" from PATH (PHASE6_PLAN decision 2). */
  execPath: string;
  /** The engine's version, for the result record. */
  version: string;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
};

export type SetupOutput = { exitCode: 0 | 1; out: string[]; err: string[] };

type Options = { remove: boolean; dryRun: boolean; installer: boolean; configPath: string | undefined };

/** The options, or the sentence that says what is wrong with the arguments. */
function parseArgs(argv: string[]): Options | string {
  const known = ["--remove", "--dry-run", "--installer", "--config"];
  let configPath: string | undefined;
  const unknown: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === "--config") {
      configPath = argv[++i];
      if (configPath === undefined || configPath.startsWith("--")) return `--config needs a file path. ${USAGE}`;
    } else if (!known.includes(a)) unknown.push(a);
  }
  if (unknown.length > 0) return `unknown argument ${unknown.join(" ")}. ${USAGE}`;
  const options = { remove: argv.includes("--remove"), dryRun: argv.includes("--dry-run"), installer: argv.includes("--installer"), configPath };
  if (options.installer && options.dryRun) return `--installer writes the result files, so it cannot be combined with --dry-run. ${USAGE}`;
  return options;
}

function apply(o: Options, ctx: SetupContext): ApplyResult {
  if (!o.remove && !existsSync(ctx.mainJs)) throw new SetupError(`the engine is incomplete: ${ctx.mainJs} is missing. Install lrc-avg again.`);
  return applyDesktopConfig({ entry: o.remove ? null : engineEntry(ctx.mainJs, ctx.execPath), configPath: o.configPath, dryRun: o.dryRun, ...(ctx.env ? { env: ctx.env } : {}) });
}

/** `--installer`: the outcome goes to the result files and the exit code is 0, whatever happened. `badArgs` is what parseArgs objected to. */
function runInstaller(o: Options, ctx: SetupContext, badArgs?: string): SetupOutput {
  const env = ctx.env ?? process.env;
  const dir = dataDir(env);
  const action: SetupAction = o.remove ? "remove" : "add";
  const now = ctx.now ?? (() => new Date());
  clearSetupResult(dir);
  let result: SetupResult;
  try {
    if (badArgs !== undefined) throw new SetupError(badArgs);
    const applied = apply(o, ctx);
    result = resultOf(action, applied, ctx.version, now(), existsSync(applied.configPath));
  } catch (err) {
    result = failureOf(action, err, ctx.version, now());
  }
  const output: SetupOutput = { exitCode: 0, out: [result.message], err: [] };
  try {
    writeSetupResult(dir, result);
  } catch (err) {
    output.err.push(`could not write the setup result in ${dir}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return output;
}

function runPlain(o: Options, ctx: SetupContext): SetupOutput {
  try {
    const result = apply(o, ctx);
    const out = describeResult(result, o.dryRun);
    if (!o.remove) out.push(`"lrc-avg" runs: ${ctx.execPath} ${ctx.mainJs}`);
    if (!o.dryRun) out.push(RESTART);
    return { exitCode: 0, out, err: [] };
  } catch (err) {
    if (err instanceof SetupError) return failed(err.message);
    throw err;
  }
}

function failed(message: string): SetupOutput {
  return { exitCode: 1, out: [], err: [`FAILED: ${message}`, "Claude Desktop's config was not changed."] };
}

/** Runs `lrc-avg-setup` with these arguments. Throws only on a crash outside the setup's own failures, and never with --installer. */
export function runSetup(argv: string[], ctx: SetupContext): SetupOutput {
  const parsed = parseArgs(argv);
  if (typeof parsed === "string") {
    if (!argv.includes("--installer")) return failed(parsed);
    const options: Options = { remove: argv.includes("--remove"), dryRun: false, installer: true, configPath: undefined };
    return runInstaller(options, ctx, parsed);
  }
  return parsed.installer ? runInstaller(parsed, ctx) : runPlain(parsed, ctx);
}
