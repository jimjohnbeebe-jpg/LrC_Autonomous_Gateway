// Spike S10's check (s10-config.ts has the plan; `npm run s10:check` is s10-check-cli.ts). This
// module runs the steps so tests\s10-check.test.ts can run them against the simulated plugin with a
// rendered photo. Rendered photos are written first, then unknown, then raw (the raw battery is the
// control: every write there is a Phase 1 repeat).

import { yn, type Json } from "./phase3-config.js";
import { describeError } from "./phase1-check.js";
import { census, type Census } from "./s10-census.js";
import { errorBody } from "./phase4-config.js";
import { connect, COLLECTION, ensureConnected, label, type Ctx, type Photo, type S10Deps } from "./s10-config.js";
import { exportAll, virtualCopies } from "./s10-extras.js";
import { addFixtures } from "./s10-fixtures.js";
import { readRecorded } from "./s10-profiles.js";
import { writeBattery } from "./s10-writes.js";

/** fixtures: add the fixture photos to the collection first (s10-fixtures.ts), then the census only; censusOnly: the census only. */
export type S10Options = { censusOnly?: boolean; fixtures?: boolean };

const ORDER: Record<Photo["pipeline"], number> = { rendered: 0, unknown: 1, raw: 2 };

export async function runS10Check(deps: S10Deps, options: S10Options = {}): Promise<{ worked: boolean; results: Json }> {
  const now = deps.now ?? (() => new Date());
  const errors: string[] = [];
  const readOnly = options.censusOnly === true || options.fixtures === true;
  const results: Json = { check: "s10", started_at: now().toISOString(), collection: COLLECTION, census_only: readOnly, errors };
  const ctx: Ctx = { deps, results, errors, fail: (m) => {
    errors.push(m);
    deps.say(`FAILED: ${m}`);
  } };
  deps.say("LrC-AVG spike S10: the rendered pipeline");
  if (!(await connect(ctx))) return summarize(results, errors, deps.say, now);
  let found: Census | null = null;
  try {
    if (options.fixtures) results["fixtures"] = await addFixtures(ctx);
    deps.say(`Census of the collection "${COLLECTION}" (read only):`);
    found = await census(ctx);
    if (found && !readOnly) await steps(ctx, found);
  } catch (err) {
    ctx.fail(`the check stopped: ${describeError(err)}`);
  }
  await deps.gate.release();
  return summarize(results, errors, deps.say, now);
}

async function steps(ctx: Ctx, found: Census): Promise<void> {
  const { deps, results } = ctx;
  const recorded = readRecorded(deps.recorderDir);
  results["recorder"] = { file: recorded.file, pairs: recorded.pairs.map(({ look: _look, ...p }) => p), problems: recorded.problems };
  deps.say(`Recorded profile pairs: ${recorded.pairs.length}${recorded.problems.length ? ` (${recorded.problems.join("; ")})` : ""}`);
  deps.say("Writes, each photo behind its own snapshot:");
  const writes: Json[] = [];
  results["writes"] = writes;
  for (const photo of [...found.photos].sort((a, b) => ORDER[a.pipeline] - ORDER[b.pipeline])) writes.push(await writeBattery(ctx, photo, recorded));
  await restoreSelection(ctx, found.photos);
  if (await ensureConnected(ctx, "the copies")) results["copies"] = await virtualCopies(ctx, found.photos);
  if (await ensureConnected(ctx, "the exports")) results["exports"] = await exportAll(ctx, found.photos);
}

/** Jim's selection as the check found it (in the collection or not: Greptile, PR #97), put back after the batteries selected every photo in turn. */
async function restoreSelection(ctx: Ctx, photos: Photo[]): Promise<void> {
  const uuid = (ctx.results["census"] as Json)["selected_uuid"];
  const jims = photos.find((p) => p.uuid === uuid);
  const out: Json = { uuid: uuid ?? null, photo: jims ? label(jims) : null, ok: false };
  ctx.results["selection_restored"] = out;
  if (typeof uuid !== "string") return;
  try {
    await ctx.deps.client.request("select_photo", { uuid });
    out["ok"] = true;
  } catch (err) {
    out["error"] = errorBody(err);
    ctx.deps.say(`  Your selection (${jims ? label(jims) : uuid}) could not be put back: ${describeError(err)}. Click it in the Filmstrip.`);
  }
}

/** The summary in the results and the headlines in the window. WORKED: no error, the census read, and every photo written to put back. */
export function summarize(results: Json, errors: readonly string[], say: (line: string) => void, now: () => Date): { worked: boolean; results: Json } {
  const c = results["census"] as Json | undefined;
  const writes = (results["writes"] as Json[] | undefined) ?? [];
  const putBack = writes.map((w) => ({ photo: label(w as { filename: string; copy_name: string | null }), ok: (w["put_back"] as Json | null)?.["ok"] === true }));
  const exportsOut = results["exports"] as Json | undefined;
  const worked = errors.length === 0 && c?.["photos"] !== undefined && putBack.every((p) => p.ok);
  const summary: Json = {
    suggestion: worked ? "WORKED" : "FAILED",
    census: c?.["pipelines"] ?? null,
    writes: writes.map((w) => ({
      photo: label(w as { filename: string; copy_name: string | null }),
      pipeline: w["pipeline"],
      process_version: w["process_version"],
      range_limits_taken: w["range"] ? `${String((w["range"] as Json)["min_accepted"])}+${String((w["range"] as Json)["max_accepted"])}/${String((w["range"] as Json)["parameters"])}x2` : null,
      extra_keys_taken: Object.fromEntries((((w["extra_keys"] as Json | undefined)?.["per_key"] as Json[] | undefined) ?? []).map((k) => [k["key"], k["taken"]])),
      wb_custom_taken: (w["white_balance"] as Json | undefined)?.["custom_taken"] ?? null,
      lens_taken: ((w["lens"] as Json | undefined)?.["steps"] as Json[] | undefined)?.map((s) => s["taken"] ?? null) ?? null,
      profiles_taken: ((w["profiles"] as Json | undefined)?.["pairs"] as Json[] | undefined)?.map((p) => `${String(p["label"])}: ${String(p["taken"] ?? "not read back")}`) ?? null,
      put_back: (w["put_back"] as Json | null)?.["ok"] === true,
    })),
    copies: (results["copies"] as Json | undefined)?.["summary"] ?? null,
    exports: exportsOut ? { ok: exportsOut["ok"], of: exportsOut["of"] } : null,
    put_back_all: putBack.length > 0 && putBack.every((p) => p.ok),
  };
  results["summary"] = summary;
  results["finished_at"] = now().toISOString();
  say("");
  say(`Spike S10: ${String(summary["suggestion"])}`);
  if (c?.["pipelines"]) say(`  Census: ${JSON.stringify(c["pipelines"])}; dumps in ${String(c["dump_dir"])}`);
  for (const p of putBack) say(`  ${p.photo}: PUT BACK ${yn(p.ok)}`);
  if (summary["copies"]) say(`  Copies: ${String(summary["copies"])}`);
  if (exportsOut) say(`  Exports: ${String(exportsOut["ok"])} of ${String(exportsOut["of"])} rendered and read by sharp`);
  if (writes.length === 0) say("  Writes: not run (nothing was written)");
  return { worked, results };
}
