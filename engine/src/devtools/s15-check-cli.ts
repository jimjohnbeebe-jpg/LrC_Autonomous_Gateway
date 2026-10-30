// `npm run s15:check` (Phase 10 row 11, spike S15 "style memory"): what as-shot measurements of Jim's edited photos
// cost, and whether the nearest of them (on as-shot features) are sensible style references. Run from the repo root
// with Lightroom open on a copy of Jim's catalog (a catalog marked by `npm run catalog:throwaway`, or pass
// -- --i-know), 4 to 20 photos Jim edited himself selected in the Library grid, and Claude Desktop quit (this takes the
// engine's instance lock). Per photo: its final render by uuid, measured; one virtual copy made by this check
// (lr_create_virtual_copies), reset (lr_reset), rendered and measured as shot, then removed (lr_remove_photos, only
// after get_metadata reads it back as a virtual copy); each step timed. Then, with the bridge given back: each photo's
// 3 nearest neighbours on standardised as-shot features, the edit test (s15-check.ts), one composite per photo (its
// final beside its neighbours' finals) and one y/n per composite in this window. The masters are only read.
// Results and images: %TEMP%\LrC-AVG\S15\<run>\. Report: docs\reports\phase10\S15.md.

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { BridgeClient, BridgeError } from "../bridge/index.js";
import { IntentLibrary } from "../intents/index.js";
import { summarize, type MetricsSummary } from "../metrics/index.js";
import { acquireInstanceLock, BridgeGate, DEFAULT_LONG_EDGE, devOverrides, ENGINE_VERSION, PREVIEW_QUALITY, Tools } from "../mcp/index.js";
import { SESSION_SILENCE_MS } from "../mcp/bridge-gate.js";
import { settingChanges } from "../mcp/tools-develop.js";
import { removePhotos } from "../mcp/tools-remove.js";
import { loadDefaultParamMap, type SdkSettings } from "../params/index.js";
import { composite, PreviewService } from "../preview/index.js";
import { ask } from "./mask-carry-probe.js";
import { describeError } from "./phase1-check.js";
import { redactHome } from "./phase2-check.js";
import { edit, featureNames, features, K, MAX_PHOTOS, MIN_PHOTOS, nearest, predictionTest, standardise, stepMedians, verdict, type StepTimes } from "./s15-check.js";
import { requireThrowaway } from "./throwaway.js";

const started = new Date().toISOString().replace(/[:.]/g, "-");
const RUN_DIR = path.join(os.tmpdir(), "LrC-AVG", "S15", started);
const COPY = "AVG S15 as-shot";
const map = loadDefaultParamMap();
const QUESTION = "Are these sensible style references for this photo?";

type Photo = { uuid: string; filename: string | null; times: StepTimes; copy: string | null; final?: MetricsSummary; as_shot?: MetricsSummary; final_file?: string; error?: string };
type Measured = Photo & { final: MetricsSummary; as_shot: MetricsSummary; final_file: string };
type Check = { client: BridgeClient; tools: Tools; previews: PreviewService; say: (l: string) => void; photos: Photo[]; before: Map<string, SdkSettings> };

const home = (p: string): string => redactHome(p, os.homedir());
const nameOf = (p: Photo): string => p.filename ?? p.uuid;

async function timed<T>(times: StepTimes, step: keyof StepTimes, f: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  const v = await f();
  times[step] = Math.round(performance.now() - t0);
  return v;
}

/** One render by uuid at the session's size and quality, saved under RUN_DIR; its metrics without the histograms. */
async function render(c: Check, uuid: string, file: string): Promise<MetricsSummary> {
  const p = await c.previews.render({ longEdge: DEFAULT_LONG_EDGE, quality: PREVIEW_QUALITY, photoUuid: uuid });
  writeFileSync(file, p.jpeg);
  return summarize(p.metrics);
}

/** Removes this check's copy, only once Lightroom reads it back as a virtual copy; timed. Leaves `copy` set when it stays. */
async function removeCopy(c: Check, p: Photo): Promise<void> {
  const copy = p.copy as string;
  const meta = await c.client.request("get_metadata", { photo_uuid: copy });
  if (copy === p.uuid || meta.virtual_copy !== true) throw new Error(`${copy} does not read back as a virtual copy, so it was not removed`);
  const j = await timed(p.times, "remove", () => c.tools.call(removePhotos, { uuids: [copy], confirm: true }));
  await c.client.waitConnected(SESSION_SILENCE_MS).catch(() => undefined); // a Lightroom dialog can silence the plugin (LR_SDK_NOTES "Recorded in Phase 5")
  // Only unknown_photo means gone (as crop:check); another error keeps the copy listed as left.
  const gone = await c.client.request("get_settings", { photo_uuid: copy }).then(() => false, (err: unknown) => err instanceof BridgeError && err.code === "unknown_photo");
  if (!gone) throw new Error(`the copy ${copy} is still in the catalog (lr_remove_photos: ${String(j.json["status"])})`);
  p.copy = null;
}

/** Final render; then one copy, reset, rendered as shot and removed. Throws at the first step that fails. */
async function measurePhoto(c: Check, p: Photo, nn: string): Promise<void> {
  p.final_file = path.join(RUN_DIR, `${nn}_final.jpg`);
  p.final = await timed(p.times, "final", () => render(c, p.uuid, p.final_file as string));
  const vc = await timed(p.times, "create", () => c.tools.createVirtualCopies({ uuids: [p.uuid], copy_name: COPY }));
  const copy = (vc.json["photos"] as Array<{ copy_uuid?: string | null }> | undefined)?.[0]?.copy_uuid;
  if (typeof copy !== "string" || copy === p.uuid) throw new Error(`no virtual copy was made: ${JSON.stringify(vc.json).slice(0, 300)}`);
  p.copy = copy;
  const rs = await timed(p.times, "reset", () => c.tools.resetDevelop({ uuids: [copy], confirm: true }));
  const status = (rs.json["photos"] as Array<{ status?: string }> | undefined)?.[0]?.status;
  if (status !== "reset") throw new Error(`lr_reset on the copy answered ${String(status)}`);
  p.as_shot = await timed(p.times, "render", () => render(c, copy, path.join(RUN_DIR, `${nn}_as_shot.jpg`)));
  await removeCopy(c, p);
  c.say(`  ${nn} ${nameOf(p)}: final ${p.times.final} ms, copy ${p.times.create} ms, reset ${p.times.reset} ms, render ${p.times.render} ms, remove ${p.times.remove} ms`);
}

/** The selection, each master's settings, then every photo; a photo that fails is recorded and its copy removed. */
async function lightroomPart(c: Check): Promise<string[]> {
  const sel = await c.client.request("get_selection", { max: MAX_PHOTOS + 1 });
  const chosen: Photo[] = sel.photos.flatMap((p) => (typeof p.uuid === "string" ? [{ uuid: p.uuid, filename: p.filename ?? null, times: {}, copy: null }] : []));
  if (chosen.length < MIN_PHOTOS || chosen.length > MAX_PHOTOS || chosen.length !== sel.count) {
    throw new Error(`select ${MIN_PHOTOS} to ${MAX_PHOTOS} photos you edited yourself in Lightroom's Library grid (${sel.count} selected), then run this again. Nothing was written.`);
  }
  for (const p of chosen) c.before.set(p.uuid, (await c.client.request("get_settings", { photo_uuid: p.uuid })).settings);
  c.say(`${chosen.length} photos. Lightroom switches between Library and Develop; do not click in Lightroom until the questions.`);
  for (const [i, p] of chosen.entries()) {
    c.photos.push(p);
    try {
      await measurePhoto(c, p, String(i + 1).padStart(2, "0"));
    } catch (err) {
      p.error = describeError(err);
      c.say(`  ${nameOf(p)}: stopped: ${p.error}`);
      if (p.copy !== null) await removeCopy(c, p).catch((e: unknown) => c.say(`  the copy stays: ${describeError(e)}`));
    }
  }
  return chosen.map((p) => p.uuid);
}

/** The masters whose settings no longer read as they started (unreadable counts as changed). */
async function mastersChanged(c: Check): Promise<string[]> {
  const out: string[] = [];
  for (const [uuid, before] of c.before) {
    const after = await c.client.request("get_settings", { photo_uuid: uuid }).then((r) => r.settings, () => null);
    const d = after === null ? null : settingChanges(map, before, after);
    if (d === null || Object.keys(d.changed).length > 0 || d.masks !== undefined) out.push(c.photos.find((p) => p.uuid === uuid)?.filename ?? uuid);
  }
  return out;
}

/** Neighbours, the edit test, one composite per photo; returns the composite files in photo order. */
async function analyse(r: Record<string, unknown>, done: Measured[], say: (l: string) => void): Promise<string[]> {
  const z = standardise(done.map((p) => features(p.as_shot.perceptual)));
  const nbrs = nearest(z, K);
  const edits = done.map((p) => edit(p.final.perceptual, p.as_shot.perceptual));
  const prediction = predictionTest(edits, nbrs);
  r["analysis"] = { features: featureNames((done[0] as Measured).as_shot.perceptual), edits, prediction, neighbours: done.map((p, i) => ({ uuid: p.uuid, filename: p.filename, nearest: (nbrs[i] ?? []).map((n) => ({ uuid: done[n.index]?.uuid, filename: done[n.index]?.filename, distance: n.distance })) })) };
  say("");
  for (const x of prediction) say(`  edit ${x.key}: mean abs error kNN ${x.mae_knn}, mean of all others ${x.mae_mean} (${x.knn_better ? "kNN better" : "kNN not better"})`);
  const files: string[] = [];
  for (const [i, p] of done.entries()) {
    const panels = [{ image: p.final_file, label: "PHOTO" }, ...(nbrs[i] ?? []).map((n, j) => ({ image: (done[n.index] as Measured).final_file, label: `REF ${j + 1}  D=${n.distance.toFixed(2)}` }))];
    const out = await composite(panels.map((x) => ({ image: readFileSync(x.image), label: x.label })), { longEdge: 2400, quality: 85 });
    const file = path.join(RUN_DIR, `${String(i + 1).padStart(2, "0")}_composite.jpg`);
    writeFileSync(file, out.jpeg);
    files.push(file);
  }
  return files;
}

/** Opens the first composite in Windows' default viewer, then one y/n per composite in this window. */
async function askJim(done: Measured[], files: string[], say: (l: string) => void): Promise<string[]> {
  if (files[0] === undefined) return [];
  spawn("explorer.exe", [files[0]], { detached: true, stdio: "ignore" }).unref();
  say("");
  say(`The first composite is open. Each one shows the photo (PHOTO, left) beside its ${K} nearest edited photos (REF 1-${K}, D = distance). In the viewer, the right arrow key goes to the next one.`);
  const answers: string[] = [];
  for (const [i, p] of done.entries()) answers.push(await ask(`${path.basename(files[i] as string)} (${nameOf(p)}): ${QUESTION}`));
  return answers;
}

function report(r: Record<string, unknown>, c: Check, v: ReturnType<typeof verdict>, worked: boolean): void {
  const file = path.join(RUN_DIR, `s15_check_${started}.json`);
  writeFileSync(file, home(JSON.stringify(r, null, 2)) + "\n");
  const m = r["step_medians_ms"] as ReturnType<typeof stepMedians>;
  c.say("");
  c.say(`  median ms: final render ${m.final}, create copy ${m.create}, reset ${m.reset}, as-shot render ${m.render}, remove ${m.remove}; as-shot total ${m.as_shot_total}`);
  for (const line of v.lines) c.say(`  ${line}`);
  c.say("");
  c.say(`S15 style memory check: ${worked ? "WORKED" : "FAILED"}`);
  c.say(`put back: ${v.putBack ? "YES" : "NO"}`);
  const left = c.photos.filter((p) => p.copy !== null);
  if (left.length > 0) c.say(`  Copies named "${COPY}" are still in the catalog: Library, search the grid for that name, select them, Photo > Remove Photos..., Remove.`);
  c.say(`Results saved automatically: ${home(file)}`);
  c.say('Nothing to copy. Tell Claude Code "done".');
}

async function main(say: (l: string) => void): Promise<number> {
  const dev = devOverrides();
  const client = new BridgeClient({ engineVersion: ENGINE_VERSION, log: (m) => console.error(`  (${m})`), silenceAllowanceMs: () => SESSION_SILENCE_MS, ...dev.bridge });
  const gate = new BridgeGate(client, () => acquireInstanceLock(dev.lockPort));
  const previews = new PreviewService(client);
  const tools = new Tools({ client, map, previews, intents: new IntentLibrary({ map }), sessionLogDir: mkdtempSync(path.join(os.tmpdir(), "lrc-avg-s15-")), engineVersion: ENGINE_VERSION, ensureBridge: (waitMs) => gate.ready(waitMs), hud: false });
  const c: Check = { client, tools, previews, say, photos: [], before: new Map() };
  const r: Record<string, unknown> = { check: "s15", started, node: process.version, engine_version: ENGINE_VERSION, long_edge: DEFAULT_LONG_EDGE, quality: PREVIEW_QUALITY, k: K };
  mkdirSync(RUN_DIR, { recursive: true });
  let start: string[] = [];
  let changed: string[] = [];
  let selectionBack = false;
  try {
    await gate.ready();
    requireThrowaway(client); // issue #213: a catalog not marked throwaway is refused before anything is written
    Object.assign(r, { plugin_version: client.hello()?.plugin_version, lrc_version: client.hello()?.lrc_version });
    start = await lightroomPart(c);
    changed = await mastersChanged(c);
    const now = await client.request("get_selection", { max: MAX_PHOTOS + 1 });
    selectionBack = now.count === start.length && now.photos.every((p) => typeof p.uuid === "string" && start.includes(p.uuid));
  } catch (err) {
    r["errors"] = [describeError(err)];
    say(`Stopped: ${describeError(err)}`);
  } finally {
    await gate.release();
  }
  const done = c.photos.filter((p): p is Measured => p.final !== undefined && p.as_shot !== undefined && p.error === undefined);
  let answers: string[] = [];
  try {
    if (done.length >= MIN_PHOTOS) answers = await askJim(done, await analyse(r, done, say), say);
  } catch (err) {
    r["errors"] = [...((r["errors"] as string[] | undefined) ?? []), describeError(err)];
    say(`Stopped: ${describeError(err)}`);
  }
  const v = verdict({ photos: c.photos.length, measured: done.length, copiesLeft: c.photos.filter((p) => p.copy !== null).length, mastersChanged: changed, selectionBack, answers });
  const worked = v.worked && r["errors"] === undefined;
  Object.assign(r, { photos: c.photos, step_medians_ms: stepMedians(c.photos.map((p) => p.times)), answers, masters_changed: changed, selection_back: selectionBack, lines: v.lines, headline: worked ? "WORKED" : "FAILED", put_back: v.putBack ? "YES" : "NO" });
  report(r, c, v, worked);
  return worked ? 0 : 1;
}

// exitCode, not process.exit(): exiting at once can cut off the last lines of output on Windows
// [inference from a Phase 1 dry run on 2026-09-26; phase1-check-cli.ts].
main((line) => console.log(line)).then((code) => {
  process.exitCode = code;
});
