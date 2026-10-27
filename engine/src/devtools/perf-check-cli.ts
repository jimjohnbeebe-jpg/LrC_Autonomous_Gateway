// `npm run perf:check` (issue #212 Work 1): times the bridge reads the catalog tools use, against the
// catalog Lightroom has open. Run from the repo root with Lightroom open, the LrC-AVG plugin enabled and
// Claude Desktop quit (this takes the engine's instance lock). It is read only: it selects nothing, writes
// nothing and asks nothing, so there is nothing to put back. Options after `--`: --runs N (default 20),
// --warmup N (default 2), --label <text> (stored in the JSON, e.g. baseline or after).
// Timed: ping (bridge round trip), search_photos with no filter (limit 100) and with a filter (rating == 0,
// limit 100), get_metadata (first photo of the unfiltered search), get_selection with max 500 (the bridge's
// cap; `count` says how many photos are selected: select 1,000 in the Library grid for #212's case, the
// call returns at most 500 of them), list_keywords (limit 100).
// Results: %TEMP%\LrC-AVG\perf\perf_<label>_<time>.json (Claude Code collects them into the report).

import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BridgeClient } from "../bridge/index.js";
import { acquireInstanceLock, BridgeGate, devOverrides, ENGINE_VERSION } from "../mcp/index.js";
import { line, sample, summarize, type Timing } from "./perf-check.js";
import { describeError } from "./phase1-check.js";
import { redactHome } from "./phase2-check.js";

const OUT_DIR = path.join(os.tmpdir(), "LrC-AVG", "perf");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

function option(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}
const RUNS = Math.max(1, Math.min(200, Number(option("runs", "20")) || 20));
const WARMUP = Math.max(0, Math.min(20, Number(option("warmup", "2")) || 0));
const LABEL = option("label", "run").replace(/[^A-Za-z0-9_-]/g, "");

async function measure(client: BridgeClient, say: (l: string) => void, r: Record<string, unknown>): Promise<void> {
  const hello = client.hello();
  r["plugin_version"] = hello?.plugin_version ?? null;
  r["lrc_version"] = hello?.lrc_version ?? null;
  const first = await client.request("search_photos", { criteria: [], offset: 0, limit: 100 });
  const sel = await client.request("get_selection", { max: 500 });
  const uuid = first.photos.find((p) => typeof p.uuid === "string")?.uuid;
  r["catalog_matches"] = first.count;
  r["selected_count"] = sel.count;
  say(`Catalog: ${first.count} photos match an empty search; ${sel.count} selected. ${RUNS} runs each after ${WARMUP} warm-up calls.`);
  const timings: Timing[] = [];
  const time = async (name: string, note: string, fn: () => Promise<unknown>): Promise<void> => {
    const t = summarize(name, note, await sample(RUNS, WARMUP, fn));
    timings.push(t);
    say(line(t));
  };
  await time("ping", "bridge round trip", () => client.request("ping", {}));
  await time("search_photos (no filter)", `limit 100 of ${first.count}`, () => client.request("search_photos", { criteria: [], offset: 0, limit: 100 }));
  await time("search_photos (filtered)", "rating == 0, limit 100", () => client.request("search_photos", { criteria: [{ criteria: "rating", operation: "==", value: 0 }], offset: 0, limit: 100 }));
  if (uuid) await time("get_metadata", "first photo of the search", () => client.request("get_metadata", { photo_uuid: uuid }));
  else say("  get_metadata                 skipped: the catalog search returned no photo with a uuid");
  await time("get_selection (max 500)", `${sel.count} selected`, () => client.request("get_selection", { max: 500 }));
  await time("list_keywords", "limit 100", () => client.request("list_keywords", { offset: 0, limit: 100 }));
  r["timings"] = timings;
}

async function main(say: (l: string) => void): Promise<number> {
  const dev = devOverrides();
  const client = new BridgeClient({ engineVersion: ENGINE_VERSION, log: (m) => console.error(`  (${m})`), ...dev.bridge });
  const gate = new BridgeGate(client, () => acquireInstanceLock(dev.lockPort));
  const r: Record<string, unknown> = { check: "perf-check", label: LABEL, started: stamp, node: process.version, engine_version: ENGINE_VERSION, runs: RUNS, warmup: WARMUP };
  let worked = false;
  try {
    await gate.ready();
    await measure(client, say, r);
    worked = true;
  } catch (err) {
    r["errors"] = [describeError(err)];
    say(`Stopped: ${describeError(err)}`);
  } finally {
    await gate.release();
  }
  r["headline"] = worked ? "WORKED" : "FAILED";
  mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `perf_${LABEL}_${stamp}.json`);
  writeFileSync(file, redactHome(JSON.stringify(r, null, 2), os.homedir()) + "\n");
  say("");
  say(`Perf check: ${worked ? "WORKED" : "FAILED"}`);
  say("put back: YES (nothing was selected or written)");
  say(`Results saved automatically: ${redactHome(file, os.homedir())}`);
  say('Nothing to copy. Tell Claude Code "done".');
  return worked ? 0 : 1;
}

main((l) => console.log(l)).then((code) => {
  process.exitCode = code;
});
