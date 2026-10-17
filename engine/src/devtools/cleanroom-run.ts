// The clean room's commands (cleanroom-cli.ts runs them): the headline, the checks, the saved results.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { park, restore, type Outcome } from "./cleanroom-park.js";
import { cleanChecks, goneChecks, type Check } from "./cleanroom-scan.js";
import { pathsOf, type Sys } from "./cleanroom-sys.js";

const USAGE = "Usage: npm run cleanroom -- --park [--dry-run] | --verify-gone [--expect-data-gone] | --restore [--dry-run] | --status";
const COMMANDS = ["--park", "--verify-gone", "--restore", "--status"] as const;
type Command = (typeof COMMANDS)[number];

export type Run = { command: Command; dry_run: boolean; at: string; headline: string; ok: boolean; actions: string[]; messages: string[]; checks: Check[] };

export function parseArgs(argv: string[]): { command: Command; dryRun: boolean; expectDataGone: boolean } | string {
  const commands = argv.filter((a): a is Command => (COMMANDS as readonly string[]).includes(a));
  const unknown = argv.filter((a) => !(COMMANDS as readonly string[]).includes(a) && a !== "--dry-run" && a !== "--expect-data-gone");
  if (unknown.length > 0) return `unknown argument ${unknown.join(" ")}. ${USAGE}`;
  if (commands.length !== 1) return USAGE;
  const command = commands[0] as Command;
  const dryRun = argv.includes("--dry-run");
  const expectDataGone = argv.includes("--expect-data-gone");
  if (dryRun && command !== "--park" && command !== "--restore") return `--dry-run goes with --park or --restore. ${USAGE}`;
  if (expectDataGone && command !== "--verify-gone") return `--expect-data-gone goes with --verify-gone. ${USAGE}`;
  return { command, dryRun, expectDataGone };
}

const yes = (checks: Check[]): boolean => checks.every((c) => c.ok);

export async function runCleanroom(sys: Sys, command: Command, dryRun: boolean, expectDataGone: boolean): Promise<Run> {
  const at = sys.now().toISOString();
  const base = { command, dry_run: dryRun, at };
  if (command === "--status" || command === "--verify-gone") {
    const checks = command === "--status" ? cleanChecks(sys) : goneChecks(sys, expectDataGone);
    const parked = existsSync(pathsOf(sys).parkFile) ? ["The development setup is parked (restore with npm run cleanroom -- --restore)."] : ["Nothing is parked."];
    const label = command === "--status" ? "CLEAN" : "GONE";
    return { ...base, headline: `${label}: ${yes(checks) ? "YES" : "NO"}`, ok: yes(checks), actions: [], messages: parked, checks };
  }
  const outcome: Outcome = command === "--park" ? await park(sys, dryRun) : await restore(sys, dryRun);
  if (command === "--park") {
    const checks = outcome.ok && !dryRun ? cleanChecks(sys) : [];
    const ok = outcome.ok && (dryRun || yes(checks));
    const headline = dryRun ? `DRY RUN: ${outcome.refused ? "REFUSED" : "nothing changed"}` : `CLEAN: ${ok ? "YES" : "NO"}`;
    return { ...base, headline, ok, actions: outcome.actions, messages: outcome.messages, checks };
  }
  const headline = dryRun ? `DRY RUN: ${outcome.refused ? "REFUSED" : "nothing changed"}` : `RESTORED: ${outcome.ok ? "YES" : "NO"}`;
  const messages = outcome.ok && !dryRun ? [...outcome.messages, "Next: in Lightroom choose File > Plug-in Manager > Add and pick plugin\\LrC-AVG.lrplugin in this repo."] : outcome.messages;
  return { ...base, headline, ok: outcome.ok, actions: outcome.actions, messages, checks: [] };
}

export function printRun(run: Run, out: (line: string) => void = console.log): void {
  out(run.headline);
  for (const a of run.actions) out(`  ${a}`);
  for (const c of run.checks) out(`  [${c.ok ? "ok" : "LEFT"}] ${c.check}: ${c.detail}`);
  for (const m of run.messages) out(m);
}

/** Saves the run; returns the file, or null for a dry run. */
export function saveRun(sys: Sys, run: Run): string | null {
  if (run.dry_run) return null;
  const dir = pathsOf(sys).resultsDir;
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${run.command.slice(2)}-${run.at.replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(run, null, 2) + "\n");
  return file;
}
