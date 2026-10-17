// `npm run sandbox:check` (vault PHASE9_PLAN.md D9.2): installs the unsigned setup in a disposable Windows
// (Windows Sandbox), checks what it did, uninstalls and checks the leftovers. Claude Code runs this, not
// Jim; Jim only enables Windows Sandbox once (ENABLE_SANDBOX prints the one administrator command).
// The Sandbox has the network on (the setup downloads WebView2, see sandbox-model.ts wsbText), release\ read-only and a writable results folder:
//   %TEMP%\LrC-AVG-phase9\sandbox_<time>\   guest.ps1, sandbox.wsb, progress.txt, results.json, installed-files.txt
//   %TEMP%\LrC-AVG-phase9\sandbox_<time>.json   this run's verdict and the guest's results
// Prints SANDBOX: PASS or FAIL with each check. Exit 0 on PASS, 1 on FAIL, 2 when it could not run.
// No Lightroom is in the Sandbox, so the plugin and its Status dialog are not tested here (phase9:local).

import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { describeError } from "./phase1-check.js";
import { ENABLE_SANDBOX, judge, lastProgress, parseGuestResults, wsbText, type GuestResults } from "./sandbox-model.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
// The .ps1 is not compiled into engine/dist: it is read from the source tree (devtools are not in the npm package).
const GUEST_SCRIPT = path.join(REPO, "engine", "src", "devtools", "sandbox-guest.ps1");
const SANDBOX_EXE = path.join(process.env["windir"] ?? "C:\\Windows", "System32", "WindowsSandbox.exe");
const OUT_ROOT = process.env["LRC_AVG_P9_OUT"] || path.join(os.tmpdir(), "LrC-AVG-phase9");
const TIMEOUT_MIN = Number(process.env["LRC_AVG_SANDBOX_TIMEOUT_MIN"] ?? "20");
const POLL_MS = 3000;

const readJson = <T>(file: string, schema: z.ZodType<T>): T => schema.parse(JSON.parse(readFileSync(file, "utf8")));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Windows Sandbox's processes (the names are [unverified]: WindowsSandbox.exe, WindowsSandboxClient.exe, WindowsSandboxRemoteSession.exe). */
function sandboxRunning(): boolean {
  const out = spawnSync("tasklist", ["/NH"], { encoding: "utf8" }).stdout ?? "";
  return /WindowsSandbox/i.test(out);
}

/** The guest shuts the Sandbox down itself; this waits for it, then ends what is left. */
async function closeSandbox(): Promise<void> {
  for (let i = 0; i < 20 && sandboxRunning(); i++) await sleep(3000);
  if (sandboxRunning()) spawnSync("taskkill", ["/F", "/IM", "WindowsSandbox*.exe"], { stdio: "ignore" });
}

function save(file: string, body: Record<string, unknown>): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(body, null, 2) + "\n");
}

async function main(): Promise<number> {
  const version = readJson(path.join(REPO, "engine", "package.json"), z.object({ version: z.string() })).version;
  const nodeVersion = readJson(path.join(REPO, "tools", "setup", "node-pin.json"), z.object({ node_version: z.string() })).node_version;
  const releaseDir = path.join(REPO, "release");
  const setup = path.join(releaseDir, `LrC-AVG-Setup-${version}.exe`);
  if (!existsSync(SANDBOX_EXE)) {
    console.log(ENABLE_SANDBOX);
    console.log("SANDBOX: NOT RUN (Windows Sandbox is not enabled)");
    return 2;
  }
  if (!existsSync(setup)) {
    console.log(`${setup} is missing. Run npm run setup:build first.\nSANDBOX: NOT RUN (no setup)`);
    return 2;
  }
  if (sandboxRunning()) {
    console.log("A Windows Sandbox window is already open, and only one can run. Close it, then run this again.\nSANDBOX: NOT RUN (Sandbox busy)");
    return 2;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(OUT_ROOT, `sandbox_${stamp}`);
  mkdirSync(dir, { recursive: true });
  copyFileSync(GUEST_SCRIPT, path.join(dir, "guest.ps1"));
  const wsb = path.join(dir, "sandbox.wsb");
  writeFileSync(wsb, wsbText(releaseDir, dir, version, nodeVersion));
  console.log(`Starting Windows Sandbox with ${path.basename(setup)} (results: ${dir}). A Sandbox window opens; leave it alone.`);
  spawn(SANDBOX_EXE, [wsb], { detached: true, stdio: "ignore" }).unref();

  const results = path.join(dir, "results.json");
  const progress = path.join(dir, "progress.txt");
  const deadline = Date.now() + TIMEOUT_MIN * 60_000;
  let lastShown = 0;
  while (!existsSync(results) && Date.now() < deadline) {
    await sleep(POLL_MS);
    if (Date.now() - lastShown > 30_000) {
      lastShown = Date.now();
      console.log(`  waiting: ${existsSync(progress) ? lastProgress(readFileSync(progress, "utf8")) : "(the Sandbox is starting)"}`);
    }
  }
  const outFile = path.join(OUT_ROOT, `sandbox_${stamp}.json`);
  if (!existsSync(results)) {
    const last = existsSync(progress) ? lastProgress(readFileSync(progress, "utf8")) : "the guest never started";
    await closeSandbox();
    save(outFile, { check: "sandbox", pass: false, reason: `no results.json within ${TIMEOUT_MIN} min`, last_progress: last, dir });
    console.log(`SANDBOX: FAIL (no results within ${TIMEOUT_MIN} min; last step: ${last})\nSaved: ${outFile}`);
    return 1;
  }
  let guest: GuestResults;
  try {
    guest = parseGuestResults(readFileSync(results, "utf8"));
  } catch (err) {
    await closeSandbox();
    save(outFile, { check: "sandbox", pass: false, reason: `results.json unreadable: ${describeError(err)}`, dir });
    console.log(`SANDBOX: FAIL (results.json unreadable: ${describeError(err)})\nSaved: ${outFile}`);
    return 1;
  }
  const verdict = judge(guest, version);
  await closeSandbox();
  save(outFile, { check: "sandbox", pass: verdict.pass, version, node_version: nodeVersion, at: new Date().toISOString(), dir, guest });
  for (const line of verdict.lines) console.log(`  ${line}`);
  console.log(`SANDBOX: ${verdict.pass ? "PASS" : "FAIL"}\nSaved: ${outFile}`);
  return verdict.pass ? 0 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(`SANDBOX: FAIL (${describeError(err)})`);
    process.exitCode = 1;
  },
);
