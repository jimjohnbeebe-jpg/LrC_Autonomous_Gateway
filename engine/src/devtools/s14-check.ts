// Spike S14's steps (s14-config.ts has the plan; `npm run s14:check` is s14-check-cli.ts), so
// tests\s14-check.test.ts can run them against the simulated plugin. The census of "fixtures" finds
// the raw NEF and the rendered JPEG; the charts are made, imported in place and put in
// CHART_COLLECTION; then each photo's parts run behind its own snapshot, with Jim's two questions
// asked on the wedge while it is in Develop.

import sdkKeysJson from "../params/sdk-keys.lrc15.json" with { type: "json" };
import { pluginVersionAtLeast } from "../bridge/version.js";
import { CATALOG_READ_TIMEOUT_MS } from "../library/index.js";
import { loadSdkKeys } from "../params/sdk-keys.js";
import { describeError } from "./phase1-check.js";
import { yn, type Json } from "./phase3-config.js";
import { census, describe } from "./s10-census.js";
import { restoreSelection } from "./s10-check.js";
import { connect, write, type Ctx, type Photo, type S10Deps } from "./s10-config.js";
import { behindSnapshot } from "./s10-writes.js";
import { makeCharts } from "./s14-charts.js";
import { CHART_COLLECTION, FIXTURES, history, MIN_PLUGIN_VERSION, snapshotName, toSnapshot } from "./s14-config.js";
import { curveProbe, firstWorking } from "./s14-curve.js";
import { gradingProbe } from "./s14-grading.js";
import { hslProbe } from "./s14-hsl.js";
import { calibrationProbe, mixerProbe } from "./s14-keys.js";

/** The grading question's values: a wheel position Jim can read in the panel. */
export const ASK_GRADE = { SplitToningShadowHue: 120, SplitToningShadowSaturation: 80 } as const;

/** Both charts imported (or found) and in CHART_COLLECTION, read as census entries. */
async function charts(ctx: Ctx, chartDir: string, selected: string | null): Promise<{ wedge: Photo; hue: Photo }> {
  const { client } = ctx.deps;
  const files = await makeCharts(chartDir);
  const pinned = loadSdkKeys(sdkKeysJson as unknown);
  const read = async (file: string): Promise<Photo> => {
    const imported = await client.request("import_photo", { path: file }, { timeoutMs: CATALOG_READ_TIMEOUT_MS });
    const context = await client.request("get_context", { photo_uuid: imported.uuid });
    const settings = (await client.request("get_settings", { photo_uuid: imported.uuid })).settings;
    return describe(ctx, pinned, context, settings, selected);
  };
  const wedge = await read(files.wedge);
  const hue = await read(files.hue);
  const c = await client.request("create_collection", { name: CHART_COLLECTION, set_path: [] }, { timeoutMs: CATALOG_READ_TIMEOUT_MS });
  await client.request("collection_photos", { collection_id: c.local_id, uuids: [wedge.uuid, hue.uuid], remove: false }, { timeoutMs: CATALOG_READ_TIMEOUT_MS });
  ctx.results["charts"] = { dir: chartDir, collection: CHART_COLLECTION, wedge: { uuid: wedge.uuid, pipeline: wedge.pipeline }, hue: { uuid: hue.uuid, pipeline: hue.pipeline } };
  ctx.deps.say(`Charts in "${CHART_COLLECTION}": ${wedge.filename} (${wedge.pipeline}), ${hue.filename} (${hue.pipeline})`);
  return { wedge, hue };
}

/** Write `settings`, ask Jim `question` about what Develop shows, and record both. */
async function askAbout(ctx: Ctx, photo: Photo, out: Json, id: string, settings: Record<string, unknown>, question: string): Promise<void> {
  const q: Json = { id, settings, question };
  (ctx.results["questions"] as Json[]).push(q);
  await toSnapshot(ctx, photo, out);
  if (await write(ctx, photo, settings, history(`ask ${id}`)(1, 1), q)) q["answer"] = await ctx.deps.ask(question);
  else q["answer"] = "not asked: the write failed";
  await toSnapshot(ctx, photo, out);
}

type Part = [string, (photo: Photo, out: Json) => Promise<Json>];

async function battery(ctx: Ctx, photo: Photo, parts: Part[]): Promise<Json> {
  return behindSnapshot(ctx, photo, snapshotName(ctx.deps.stamp), async (out) => {
    for (const [name, run] of parts) {
      out[name] = await run(photo, out);
      if ((out[name] as Json)["completed"] !== true) ctx.fail(`${photo.filename}: ${name} did not complete (see the results file)`);
    }
  });
}

export async function runS14Check(deps: S10Deps, chartDir: string): Promise<{ worked: boolean; results: Json }> {
  const errors: string[] = [];
  const results: Json = { check: "s14", started_at: (deps.now ?? (() => new Date()))().toISOString(), errors, questions: [] };
  const ctx: Ctx = { deps, results, errors, fail: (m) => {
    errors.push(m);
    deps.say(`FAILED: ${m}`);
  } };
  deps.say("LrC-AVG spike S14: tone curve, grading wheels, HSL bands, B&W mixer, calibration");
  if (!(await connect(ctx))) return finish(ctx, []);
  const out: Json[] = [];
  try {
    const version = (results["hello"] as Json)["plugin_version"];
    if (!pluginVersionAtLeast(version, MIN_PLUGIN_VERSION)) throw new Error(`Lightroom runs LrC-AVG plugin ${String(version)}, not ${MIN_PLUGIN_VERSION} or later`);
    const found = await census(ctx);
    if (!found) throw new Error("the census of \"fixtures\" found nothing");
    const [nef, jpg] = FIXTURES.map((w) => found.photos.find((p) => p.filename === w.name && !p.is_virtual_copy && p.pipeline === w.pipeline));
    if (!nef || !jpg) throw new Error(`the collection "fixtures" lacks ${FIXTURES.map((f) => `${f.name} (${f.pipeline})`).join(" or ")}. Run npm run s10:check -- --fixtures, then this again.`);
    const { wedge, hue } = await charts(ctx, chartDir, (results["census"] as Json)["selected_uuid"] as string | null);
    out.push(await battery(ctx, nef, [["curve", (p, o) => curveProbe(ctx, p, o)], ["calibration", (p) => calibrationProbe(ctx, p)], ["mixer", (p) => mixerProbe(ctx, p)]]));
    out.push(await battery(ctx, jpg, [["calibration", (p) => calibrationProbe(ctx, p)], ["mixer", (p) => mixerProbe(ctx, p)]]));
    out.push(await battery(ctx, wedge, [
      ["curve", (p, o) => curveProbe(ctx, p, o)],
      ["curve_question", async (p, o) => {
        const v = firstWorking(o["curve"] as Json);
        if (!v) return { completed: true, note: "no variant was taken with a changed render: nothing to ask" };
        await askAbout(ctx, p, o, "curve", v.settings, `Lightroom shows ${p.filename} in Develop. In the Tone Curve panel, is the curve bent (not a straight diagonal line)?`);
        return { completed: true, variant: v.label };
      }],
      ["grading", (p, o) => gradingProbe(ctx, p, o)],
      ["grading_question", async (p, o) => {
        await askAbout(ctx, p, o, "grading", { ...ASK_GRADE }, `In the Color Grading panel, click the Shadows circle in the Adjust row. Do its Hue and Saturation read ${ASK_GRADE.SplitToningShadowHue} and ${ASK_GRADE.SplitToningShadowSaturation}?`);
        return { completed: true };
      }],
    ]));
    out.push(await battery(ctx, hue, [["hsl", (p, o) => hslProbe(ctx, p, o)]]));
    await restoreSelection(ctx, found.photos);
  } catch (err) {
    ctx.fail(`the check stopped: ${describeError(err)}`);
  }
  await deps.gate.release();
  return finish(ctx, out);
}

/** WORKED: no error, all four photos written and put back. */
function finish(ctx: Ctx, out: Json[]): { worked: boolean; results: Json } {
  const putBack = out.map((w) => ({ photo: String(w["filename"]), ok: (w["put_back"] as Json | null)?.["ok"] === true }));
  const worked = ctx.errors.length === 0 && out.length === 4 && putBack.every((p) => p.ok);
  Object.assign(ctx.results, { photos: out, suggestion: worked ? "WORKED" : "FAILED", finished_at: (ctx.deps.now ?? (() => new Date()))().toISOString() });
  ctx.deps.say("");
  ctx.deps.say(`Spike S14: ${worked ? "WORKED" : "FAILED"}`);
  for (const p of putBack) ctx.deps.say(`  ${p.photo}: PUT BACK ${yn(p.ok)}`);
  for (const q of ctx.results["questions"] as Json[]) ctx.deps.say(`  question ${String(q["id"])}: ${String(q["answer"])}`);
  return { worked, results: ctx.results };
}
