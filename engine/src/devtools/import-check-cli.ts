// `npm run import:check` (GitHub issue #139): lr_import_photos' folder and name templates and stack_gap_seconds in
// Lightroom, through the engine's own tool function. Run from the repo root with Lightroom open on a catalog that
// `npm run catalog:throwaway` marked (or pass -- --i-know), the LrC-AVG plugin of this branch loaded (Reload
// Plug-in), and Claude Desktop quit (this takes the engine's instance lock). It needs fixtures\20260906-_OZ80005.NEF,
// its .xmp and fixtures\20260110-_Z8A0138-DxO_DeepPRIME XD3.dng. Steps: a card folder under
// %TEMP%\LrC-AVG\import-check\ with three copies of the NEF under camera names (one capture date, so one group of
// 3), the sidecar beside the first, and the DNG (another date); a dry_run; the import into a copy_to folder there
// with Jim's templates, going on with resume_after; the dated paths and the stack read back checked; one y/n; the
// photos removed with lr_remove_photos and both folders deleted. Results: import_check_<time>.json in that folder.
// Report: docs\reports\phase11\IMPORT-STACKS.md.

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BridgeClient, pluginVersionAtLeast } from "../bridge/index.js";
import { IntentLibrary } from "../intents/index.js";
import { acquireInstanceLock, BridgeGate, devOverrides, ENGINE_VERSION, Tools } from "../mcp/index.js";
import { SESSION_SILENCE_MS } from "../mcp/bridge-gate.js";
import { IMPORT_STACK_PLUGIN } from "../mcp/tools-collections.js";
import { removePhotos } from "../mcp/tools-remove.js";
import { loadDefaultParamMap } from "../params/index.js";
import { PreviewService } from "../preview/index.js";
import { step, stepOk, type StepLog } from "./develop-check.js";
import { ask } from "./mask-carry-probe.js";
import { describeError } from "./phase1-check.js";
import { redactHome } from "./phase2-check.js";
import { requireThrowaway } from "./throwaway.js";

const OUT_DIR = path.join(os.tmpdir(), "LrC-AVG", "import-check");
const started = new Date().toISOString().replace(/[:.]/g, "-");
const FIXTURES = path.join(process.cwd(), "fixtures");
const NEF = "20260906-_OZ80005.NEF";
const DNG = "20260110-_Z8A0138-DxO_DeepPRIME XD3.dng";
const FRAMES = ["_OZ80005", "_OZ80006", "_OZ80007"];
const ARGS = { folder_template: "{yyyy}-{mm}-{dd}", name_template: "{yyyy}{mm}{dd}-{name}", stack_gap_seconds: 2 };
const map = loadDefaultParamMap();

type Photo = { uuid: string; path: string; source: string; stack?: { top_uuid: string | null; position: number; count: number } };
/** `unsure`: an import call stopped, so a photo may be in the catalog with no uuid known. */
type Check = StepLog & { tools: Tools; card: string; copyTo: string; uuids: string[]; unsure: boolean };

/** Where each copy should land: the NEFs under the NEF's capture date (2026-09-06), the DNG under 2026-01-10 [handle: scratchpad exifprobe.mjs, PR #263]. */
const expected = (copyTo: string): string[] => [
  ...FRAMES.map((f) => path.join(copyTo, "2026-09-06", `20260906-${f}.NEF`)),
  path.join(copyTo, "2026-01-10", "20260110-_Z8A0138.dng"),
];

function makeCard(card: string): void {
  const dir = path.join(card, "100NCZ_8");
  mkdirSync(dir, { recursive: true });
  for (const f of FRAMES) copyFileSync(path.join(FIXTURES, NEF), path.join(dir, `${f}.NEF`));
  copyFileSync(path.join(FIXTURES, NEF.replace(".NEF", ".xmp")), path.join(dir, "_OZ80005.xmp"));
  copyFileSync(path.join(FIXTURES, DNG), path.join(dir, "_Z8A0138.dng"));
}

/** The import, call after call with resume_after, as Claude would go on; the photos imported, as one result. */
async function importAll(c: Check): Promise<{ json: Record<string, unknown> }> {
  const all = { imported: [] as Photo[], already_in_catalog: [] as unknown[], failed: [] as unknown[], not_stacked: [] as unknown[], calls: 0 };
  let resume: string | undefined;
  do {
    const { json } = await c.tools.importPhotos({ source: c.card, copy_to: c.copyTo, ...ARGS, ...(resume !== undefined ? { resume_after: resume } : {}) }).catch((err: unknown) => {
      // A call that stopped (tools-files.ts eachInBudget) lists what it imported; a photo it may still have imported
      // has no uuid here, so the copies are kept for the put-back by hand (Greptile, PR #270).
      const details = (err as { details?: { done?: { imported?: Photo[] } } }).details;
      c.uuids.push(...(details?.done?.imported ?? []).map((p) => p.uuid));
      c.unsure = true;
      throw err;
    });
    for (const key of ["imported", "already_in_catalog", "failed", "not_stacked"] as const) (all[key] as unknown[]).push(...((json[key] as unknown[] | undefined) ?? []));
    c.uuids.push(...(json["imported"] as Photo[]).map((p) => p.uuid));
    resume = json["resume_after"] as string | undefined;
    all.calls++;
  } while (resume !== undefined && all.calls < 10);
  return { json: all };
}

/** The stack read back on the second and third NEF: count 2 then 3, the first NEF on top; none on the DNG. */
function stackStatus(photos: Photo[]): string {
  const [top, second, third, dng] = photos;
  if (!top || !second || !third || !dng) return `${photos.length} photos imported`;
  const on = (p: Photo, n: number) => p.stack?.top_uuid === top.uuid && p.stack.count === n;
  return on(second, 2) && on(third, 3) && top.stack === undefined && dng.stack === undefined ? "one stack of 3" : `not as expected: ${JSON.stringify(photos.map((p) => p.stack ?? null))}`;
}

async function run(c: Check, client: BridgeClient): Promise<string[]> {
  const version = client.hello()?.plugin_version;
  if (!pluginVersionAtLeast(version, IMPORT_STACK_PLUGIN)) throw new Error(`reload the LrC-AVG plugin ${IMPORT_STACK_PLUGIN} (Lightroom runs ${String(version)}): File > Plug-in Manager, LrC-AVG, Reload Plug-in. Nothing was written.`);
  if (!existsSync(path.join(FIXTURES, NEF)) || !existsSync(path.join(FIXTURES, DNG))) throw new Error(`run this from the repo root, with ${NEF} and ${DNG} in fixtures\\. Nothing was written.`);
  makeCard(c.card);
  const want = expected(c.copyTo);
  await step(c, "dry_run", ["planned 4", "groups 3", "paths as expected", "nothing written"], () => c.tools.importPhotos({ source: c.card, copy_to: c.copyTo, ...ARGS, dry_run: true }), (j) => {
    const planned = (j["planned"] as Array<{ path: string }>).map((p) => p.path);
    return [`planned ${planned.length}`, `groups ${((j["groups"] as string[][] | undefined) ?? []).map((g) => g.length).join("+")}`, JSON.stringify(planned) === JSON.stringify(want) ? "paths as expected" : `paths ${JSON.stringify(planned)}`, existsSync(c.copyTo) ? "copy_to was made" : "nothing written"];
  });
  c.say("Importing: Lightroom shows the photos as they arrive; do not click in Lightroom until the question.");
  const j = await step(c, "lr_import_photos", ["imported 4", "failed 0", "not_stacked 0"], () => importAll(c), (r) => ["imported", "failed", "not_stacked"].map((k) => `${k} ${(r[k] as unknown[]).length}`));
  const photos = (j?.["imported"] as Photo[] | undefined) ?? [];
  const paths = photos.map((p) => p.path);
  const sidecar = existsSync(path.join(c.copyTo, "2026-09-06", "20260906-_OZ80005.xmp"));
  c.steps.push({ step: "the copies and the sidecar at the dated paths", expect: ["yes"], statuses: [JSON.stringify(paths) === JSON.stringify(want) && sidecar ? "yes" : `no: ${JSON.stringify(paths)}, sidecar ${String(sidecar)}`] });
  c.steps.push({ step: "the stack read back", expect: ["one stack of 3"], statuses: [stackStatus(photos)] });
  return [await ask(`In Lightroom's Library, Folders panel (left), click the folder 2026-09-06 inside ${path.basename(c.copyTo)}. Does the grid show one stack of 3 photos (a badge with 3 on the first thumbnail)?`)];
}

/**
 * The photos removed from the catalog and both folders deleted; true when all of it is done. The copies are deleted
 * only once every photo the check imported is removed: a photo left in the catalog keeps its file (Greptile, PR #270).
 */
async function putBack(c: Check, client: BridgeClient): Promise<boolean> {
  let removed = c.uuids.length === 0;
  if (!removed) {
    c.say("Removing the check's photos from the catalog. If Lightroom asks whether to remove them, click Remove.");
    removed = (await step(c, "lr_remove_photos", ["removed"], () => c.tools.call(removePhotos, { uuids: c.uuids, confirm: true }), (r) => [String(r["status"])]))?.["status"] === "removed";
    await client.waitConnected(SESSION_SILENCE_MS).catch(() => undefined); // a Lightroom dialog can silence the plugin (LR_SDK_NOTES "Recorded in Phase 5")
  }
  const clear = removed && !c.unsure;
  for (const dir of clear ? [c.card, c.copyTo] : [c.card]) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  const gone = !existsSync(c.card) && !existsSync(c.copyTo);
  c.steps.push({ step: "the card and copy_to folders deleted", expect: ["yes"], statuses: [gone ? "yes" : clear ? "no" : "copy_to kept: photos may be left in the catalog"] });
  return clear && gone;
}

async function main(say: (l: string) => void): Promise<number> {
  const dev = devOverrides();
  const client = new BridgeClient({ engineVersion: ENGINE_VERSION, log: (m) => console.error(`  (${m})`), silenceAllowanceMs: () => SESSION_SILENCE_MS, ...dev.bridge });
  const gate = new BridgeGate(client, () => acquireInstanceLock(dev.lockPort));
  const tools = new Tools({ client, map, previews: new PreviewService(client), intents: new IntentLibrary({ map }), sessionLogDir: mkdtempSync(path.join(os.tmpdir(), "lrc-avg-import-check-")), engineVersion: ENGINE_VERSION, ensureBridge: (waitMs) => gate.ready(waitMs), hud: false });
  mkdirSync(OUT_DIR, { recursive: true });
  const r: Record<string, unknown> = { check: "import-check", started, node: process.version, engine_version: ENGINE_VERSION, args: ARGS, results: {} };
  const c: Check = { tools, say, r, steps: [], card: path.join(OUT_DIR, `card-${started}`), copyTo: path.join(OUT_DIR, `photos-${started}`), uuids: [], unsure: false };
  let answers: string[] = [];
  let back = false;
  try {
    await gate.ready();
    requireThrowaway(client); // issue #213: a catalog not marked throwaway is refused before anything is written
    Object.assign(r, { plugin_version: client.hello()?.plugin_version, lrc_version: client.hello()?.lrc_version });
    answers = await run(c, client);
  } catch (err) {
    r["errors"] = [describeError(err)];
    say(`Stopped: ${describeError(err)}`);
  } finally {
    back = await putBack(c, client).catch((err: unknown) => (say(`Put back stopped: ${describeError(err)}`), false));
    await gate.release();
  }
  const lines = c.steps.map((s) => `${stepOk(s) ? "YES" : "NO "} ${s.step}: ${s.error ?? (s.statuses.join(", ") || "no answer")} (expected ${s.expect.join(", ")})`);
  for (const a of answers) lines.push(`${a === "y" ? "YES" : "NO "} Jim's answer (one stack of 3 in the Library grid): ${a}`);
  const worked = r["errors"] === undefined && c.steps.length > 0 && c.steps.every(stepOk) && answers.length === 1 && answers[0] === "y";
  Object.assign(r, { steps: c.steps, answers, lines, left_in_catalog: back ? [] : c.uuids, headline: worked ? "WORKED" : "FAILED" });
  const file = path.join(OUT_DIR, `import_check_${started}.json`);
  writeFileSync(file, redactHome(JSON.stringify(r, null, 2), os.homedir()) + "\n");
  say("");
  for (const line of lines) say(`  ${line}`);
  say("");
  say(`Import check: ${worked ? "WORKED" : "FAILED"}`);
  say(`put back: ${back ? "YES" : "NO"}`);
  if (!back && existsSync(c.copyTo)) say(`  The check's photos may still be in the catalog: Folders panel, ${path.basename(c.copyTo)}, select them all, Photo > Remove Photos..., Remove. Their files stay in ${redactHome(c.copyTo, os.homedir())} so that none goes missing.`);
  // No LrCatalog or LrFolder call that removes a folder is known here [unverified], so the entry stays.
  say(`The folder entry ${path.basename(c.copyTo)} may stay in the Folders panel, shown as missing; this is a throwaway catalog.`);
  say(`Results saved automatically: ${redactHome(file, os.homedir())}`);
  say('Nothing to copy. Tell Claude Code "done".');
  return worked ? 0 : 1;
}

// exitCode, not process.exit(): exiting at once can cut off the last lines of output on Windows
// [inference from a Phase 1 dry run on 2026-09-26; phase1-check-cli.ts].
main((line) => console.log(line)).then((code) => {
  process.exitCode = code;
});
