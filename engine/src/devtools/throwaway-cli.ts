// `npm run catalog:throwaway` (GitHub issue #213 item 3): marks the catalog open in Lightroom as a throwaway one, so
// the live checks that write to photos run on it (throwaway.ts). Run from the repo root with Lightroom open on the
// throwaway catalog, the LrC-AVG plugin loaded, and Claude Desktop quit (this takes the engine's instance lock). It
// shows the catalog's path and asks Jim in this window; on y it writes lrc-avg-throwaway.json beside the catalog and
// reads the guard back. Results under %TEMP%\LrC-AVG\throwaway\ (Claude Code collects them): throwaway_<time>.json.

import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BridgeClient } from "../bridge/index.js";
import { acquireInstanceLock, BridgeGate, devOverrides, ENGINE_VERSION } from "../mcp/index.js";
import { ask } from "./mask-carry-probe.js";
import { describeError } from "./phase1-check.js";
import { redactHome } from "./phase2-check.js";
import { I_KNOW, MARKER, markerPath, throwawayRefusal } from "./throwaway.js";

const OUT_DIR = path.join(os.tmpdir(), "LrC-AVG", "throwaway");
const started = new Date().toISOString().replace(/[:.]/g, "-");
const redact = (text: string): string => redactHome(text, os.homedir());

async function mark(client: BridgeClient, say: (l: string) => void, r: Record<string, unknown>): Promise<boolean> {
  const catalog = client.hello()?.catalog_path;
  r["catalog_path"] = catalog ?? null;
  if (catalog === undefined) throw new Error(throwawayRefusal(undefined, []) ?? "no catalog path");
  say(`Lightroom has this catalog open: ${catalog}`);
  r["refused_before"] = throwawayRefusal(catalog, []) !== null;
  const answer = await ask("Is this a throwaway catalog made for the checks (not the catalog you keep your photos in)?");
  r["answer"] = answer;
  if (answer !== "y") {
    say(`Nothing was written. Open a throwaway catalog (File > New Catalog), then run this again.`);
    return false;
  }
  const marker = { catalog: path.basename(catalog), marked_at: new Date().toISOString(), by: "npm run catalog:throwaway", engine_version: ENGINE_VERSION };
  writeFileSync(markerPath(catalog), JSON.stringify(marker, null, 2) + "\n");
  r["marker"] = markerPath(catalog);
  // The guard as a check sees it now, without --i-know.
  const after = throwawayRefusal(catalog, []);
  r["refused_after"] = after;
  say(`Wrote ${MARKER} beside it. The checks now run on this catalog: ${after === null ? "YES" : `NO (${after})`}`);
  return after === null;
}

async function main(say: (l: string) => void): Promise<number> {
  const dev = devOverrides();
  const client = new BridgeClient({ engineVersion: ENGINE_VERSION, log: (m) => console.error(`  (${m})`), ...dev.bridge });
  const gate = new BridgeGate(client, () => acquireInstanceLock(dev.lockPort));
  const r: Record<string, unknown> = { check: "catalog-throwaway", started, node: process.version, engine_version: ENGINE_VERSION };
  let worked = false;
  try {
    await gate.ready();
    r["plugin_version"] = client.hello()?.plugin_version ?? null;
    worked = await mark(client, say, r);
  } catch (err) {
    r["errors"] = [describeError(err)];
    say(`Stopped: ${describeError(err)}`);
  } finally {
    await gate.release();
  }
  r["headline"] = worked ? "WORKED" : "FAILED";
  mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `throwaway_${started}.json`);
  writeFileSync(file, redact(JSON.stringify(r, null, 2)) + "\n");
  say("");
  say(`Throwaway catalog: ${worked ? "WORKED" : "FAILED"}`);
  say(`(A check on a catalog without the mark refuses to run; ${I_KNOW} runs it anyway.)`);
  say(`Results saved automatically: ${redact(file)}`);
  say('Nothing to copy. Tell Claude Code "done".');
  return worked ? 0 : 1;
}

// exitCode, not process.exit(): exiting at once can cut off the last lines of output on Windows
// [inference from a Phase 1 dry run on 2026-09-26; phase1-check-cli.ts].
main((line) => console.log(line)).then((code) => {
  process.exitCode = code;
});
