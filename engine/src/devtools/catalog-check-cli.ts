// `npm run catalog:check` (GitHub issue #218): issue #218's catalog tools in Lightroom, from the command line (the steps
// are in catalog-check.ts). Run from the repo root with Lightroom Classic open on a throwaway or copied catalog, the
// LrC-AVG plugin that has the issue #218 commands loaded, exactly one photo selected in the Library grid, and Claude
// Desktop quit (this takes the engine's instance lock). Jim answers y/n in this window. Results, under
// %TEMP%\LrC-AVG\catalog-check\ (Claude Code collects them): catalog_check_<time>.json and the exported metadata file.

import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BridgeClient } from "../bridge/index.js";
import { IntentLibrary } from "../intents/index.js";
import { ToolLog } from "../log/index.js";
import { acquireInstanceLock, BridgeGate, devOverrides, ENGINE_VERSION, Tools, toToolError } from "../mcp/index.js";
import { listFolders } from "../mcp/tools-catalog.js";
import { loadDefaultParamMap } from "../params/index.js";
import { PreviewService } from "../preview/index.js";
import { PREFIX, putBack, runSteps, verdict, type CheckCtx, type Step } from "./catalog-check.js";
import { ask } from "./mask-carry-probe.js";
import { describeError } from "./phase1-check.js";
import { redactHome } from "./phase2-check.js";

const OUT_DIR = path.join(os.tmpdir(), "LrC-AVG", "catalog-check");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

/** The one selected photo's uuid; throws (nothing written) when the plugin lacks the commands or the selection is not one photo. */
async function preflight(tools: Tools): Promise<string> {
  try {
    await tools.call(listFolders, { limit: 1 });
  } catch (err) {
    const e = toToolError(err);
    if (e.code === "FEATURE_UNAVAILABLE") throw new Error("Lightroom runs a plugin without the issue #218 commands: File > Plug-in Manager, LrC-AVG, Reload Plug-in, then run this again. Nothing was written.");
    throw err;
  }
  const sel = (await tools.getSelectedPhotos({ limit: 2 })).json;
  const photos = sel["photos"] as Array<{ uuid: unknown }>;
  if (sel["count"] !== 1 || typeof photos[0]?.uuid !== "string") throw new Error(`select exactly one photo in Lightroom's Library grid (${String(sel["count"])} selected), then run this again. Nothing was written.`);
  return photos[0].uuid;
}

async function main(say: (l: string) => void): Promise<number> {
  const dev = devOverrides();
  const map = loadDefaultParamMap();
  const client = new BridgeClient({ engineVersion: ENGINE_VERSION, log: (m) => console.error(`  (${m})`), ...dev.bridge });
  const gate = new BridgeGate(client, () => acquireInstanceLock(dev.lockPort));
  mkdirSync(OUT_DIR, { recursive: true });
  const tools = new Tools({
    client,
    map,
    previews: new PreviewService(client),
    intents: new IntentLibrary({ map }),
    sessionLogDir: path.join(OUT_DIR, `sessions_${stamp}`),
    engineVersion: ENGINE_VERSION,
    ensureBridge: () => gate.ready(),
    log: new ToolLog(path.join(OUT_DIR, `catalog_check_tools_${stamp}`)),
  });
  const r: Record<string, unknown> = { check: "catalog-check", started: stamp, node: process.version, engine_version: ENGINE_VERSION };
  let steps: Step[] = [];
  let back: Step[] = [];
  const answers: string[] = [];
  let c: CheckCtx | null = null;
  try {
    if ((await ask("Is Lightroom running a throwaway or copied catalog (not your real one)?")) !== "y") throw new Error("open a throwaway or copied catalog in Lightroom (File > Open Catalog), then run this again. Nothing was written.");
    await gate.ready();
    r["plugin_version"] = client.hello()?.plugin_version ?? null;
    r["lrc_version"] = client.hello()?.lrc_version ?? null;
    c = { tools, uuid: await preflight(tools), dir: OUT_DIR, run: stamp, taken: { collections: new Set() } };
    r["photo"] = c.uuid;
    steps = await runSteps(c, say);
  } catch (err) {
    r["errors"] = [describeError(err)];
    say(`Stopped: ${describeError(err)}`);
  } finally {
    if (c) back = await putBack(c).catch((err: unknown) => [{ step: "put back", ok: false, detail: describeError(err) }]);
  }
  if (c && steps.length > 0) {
    answers.push(await ask(`In Lightroom's Collections panel, is there no collection whose name starts with "${PREFIX}"?`));
    answers.push(await ask("Select the photo in Lightroom: do its colour label and its IPTC Creator and Location (Metadata panel, IPTC) read as before the check?"));
    // Row 9 (MetadataDefinition.lua): whether Lightroom took the metadata provider is Jim's to see [unverified].
    answers.push(await ask("When you reloaded the plugin before this check, did Lightroom finish without an error dialog?"));
    answers.push(await ask('In the Metadata panel, open the list at its top left (where "Default" is) and pick "All Plug-in Metadata": are "AVG session", "AVG look" and "AVG edit date" listed?'));
  }
  await gate.release();
  const v = verdict(steps, back, answers);
  Object.assign(r, { steps, put_back: back, answers, lines: v.lines, headline: v.worked ? "WORKED" : "FAILED" });
  const file = path.join(OUT_DIR, `catalog_check_${stamp}.json`);
  writeFileSync(file, redactHome(JSON.stringify(r, null, 2), os.homedir()) + "\n");
  say("");
  for (const line of v.lines) say(`  ${line}`);
  say("");
  say(`Catalog check: ${v.worked ? "WORKED" : "FAILED"}`);
  say(`put back: ${v.putBack ? "YES" : "NO"}`);
  say(`The test keywords "${PREFIX} kw" stay in this catalog's Keyword List: no tool deletes a keyword.`);
  say(`Results saved automatically: ${redactHome(file, os.homedir())}`);
  say('Nothing to copy. Tell Claude Code "done".');
  return v.worked ? 0 : 1;
}

// exitCode, not process.exit(): exiting at once can cut off the last lines of output on Windows
// [inference from a Phase 1 dry run on 2026-09-26; phase1-check-cli.ts].
main((line) => console.log(line)).then((code) => {
  process.exitCode = code;
});
