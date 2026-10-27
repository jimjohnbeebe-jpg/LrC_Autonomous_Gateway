// `npm run sdkver:check` (GitHub issue #209, Phase 11): does the LrSdkVersion a plugin declares hide Develop keys?
// One run reads, read only and by uuid (nothing selected, nothing written), the full getDevelopSettings() table of
// every photo of the "fixtures" collection through the running plugin (S10's census), stamps it with the version
// that plugin declares (hello.sdk_declared) and Lightroom's version, and saves it. With an earlier run that declared
// another version, it then diffs the two (sdkver-diff.ts) and lists the keys new against the pinned file. The two
// runs are the plugin before and after the PR that changes Info.lua, with a Reload Plug-in between: nothing is
// edited by hand (spikes\SDKVER\README.md; the report is docs\reports\phase11\SDKVER.md; the command line is
// sdkver-check-cli.ts).

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { HelloResult } from "../bridge/index.js";
import { describeError } from "./phase1-check.js";
import type { Json } from "./phase3-config.js";
import { census } from "./s10-census.js";
import { COLLECTION, connect, type Ctx, type S10Deps } from "./s10-config.js";
import { buildRun, compareRuns, fmtSdk, labelNotes, newVsPinned, parseInfoLua, pickPrevious, runSchema, type Comparison, type Run } from "./sdkver-diff.js";

export type SdkverDeps = Omit<S10Deps, "ask" | "recorderDir"> & {
  /** This repo's plugin\LrC-AVG.lrplugin\Info.lua (path and text), null when it cannot be read. */
  info: { path: string; text: string } | null;
  /** Runs saved by earlier invocations. */
  previous: readonly Run[];
};

const MAX_LISTED = 30;
const photos = (n: number): string => `${n} photo${n === 1 ? "" : "s"}`;
const list = (keys: readonly string[]): string => (keys.length <= MAX_LISTED ? keys.join(", ") : `${keys.slice(0, MAX_LISTED).join(", ")}, ... +${keys.length - MAX_LISTED} more`);

export async function runSdkverCheck(d: SdkverDeps): Promise<{ worked: boolean; results: Json }> {
  const now = d.now ?? (() => new Date());
  const errors: string[] = [];
  const results: Json = { check: "sdkver", started_at: now().toISOString(), collection: COLLECTION, errors };
  const deps: S10Deps = { ...d, ask: async () => "no answer", recorderDir: d.dumpDir };
  const ctx: Ctx = { deps, results, errors, fail: (m) => {
    errors.push(m);
    deps.say(`FAILED: ${m}`);
  } };
  deps.say("LrC-AVG sdkver: the develop keys under the declared Lightroom SDK version");
  if (!(await connect(ctx))) return finish(ctx);
  try {
    const hello = results["hello"] as HelloResult;
    deps.say(`The loaded plugin declares LrSdkVersion ${fmtSdk(hello.sdk_declared)} (plugin ${hello.plugin_version}, Lightroom Classic ${hello.lrc_version}).`);
    results["info_lua"] = d.info ? { path: d.info.path, ...parseInfoLua(d.info.text) } : null;
    const notes = labelNotes(hello.sdk_declared, d.info);
    for (const n of notes) deps.say(`NOTE: ${n}`);
    deps.say(`Census of the collection "${COLLECTION}" (read only):`);
    const found = await census(ctx);
    if (found) report(ctx, buildRun(hello, found.photos, now().toISOString()), notes, d.previous);
  } catch (err) {
    ctx.fail(`the check stopped: ${describeError(err)}`);
  }
  await deps.gate.release();
  return finish(ctx);
}

/** The runs earlier invocations saved in `dir` (sdkver_<declared>_<time>.json, field `run`); a file that holds none is skipped. */
export function readRuns(dir: string): Run[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith("sdkver_") && f.endsWith(".json"))
    .flatMap((f) => {
      try {
        const run = runSchema.safeParse((JSON.parse(readFileSync(path.join(dir, f), "utf8")) as { run?: unknown }).run);
        return run.success ? [run.data] : [];
      } catch {
        return [];
      }
    });
}

/** WORKED: connected and every photo read, whatever the keys did; the answer is in the comparison, and the verdict is Jim's. */
function finish(ctx: Ctx): { worked: boolean; results: Json } {
  const worked = ctx.errors.length === 0 && ctx.results["run"] !== undefined;
  ctx.results["headline"] = worked ? "WORKED" : "FAILED";
  ctx.deps.say(`SDKVER: ${worked ? "WORKED" : "FAILED"}`);
  return { worked, results: ctx.results };
}

function report(ctx: Ctx, run: Run, notes: string[], previous: readonly Run[]): void {
  const { say } = ctx.deps;
  const extra = newVsPinned(run);
  Object.assign(ctx.results, { run, notes, new_vs_pinned: extra });
  say(`Read ${photos(run.photos.length)}. Keys new against the pinned file (engine\\src\\params\\sdk-keys.lrc15.json): ${extra.length ? `${extra.length}: ${list(extra)}` : "none"}.`);
  const earlier = pickPrevious(previous, run);
  ctx.results["comparison"] = null;
  if (!earlier) {
    say(previous.length === 0
      ? `This is run 1 (declared ${fmtSdk(run.declared)}). Run 2 comes after the plug-in declares another version and is reloaded (spikes\\SDKVER\\README.md).`
      : `Every earlier run declared ${fmtSdk(run.declared)} too, so nothing is compared. Run 2 needs the plug-in to declare another version: reload it after the new Info.lua is in place.`);
    return;
  }
  const c = compareRuns(earlier, run);
  ctx.results["comparison"] = { ...c, compared_with_captured_at: earlier.captured_at };
  show(say, c);
}

function show(say: (line: string) => void, c: Comparison): void {
  say(`Declared ${c.a.declared} (Lightroom ${c.a.lrc_version}, ${c.a.captured_at}) against ${c.b.declared} (Lightroom ${c.b.lrc_version}, ${c.b.captured_at}), ${photos(c.photos_compared)} in both:`);
  if (c.photos_only_a.length + c.photos_only_b.length > 0) say(`  photos in one run only: ${list([...c.photos_only_a, ...c.photos_only_b])}`);
  say(`  keys only under ${c.a.declared}: ${c.only_a.length ? list(c.only_a) : "none"}`);
  say(`  keys only under ${c.b.declared}: ${c.only_b.length ? list(c.only_b) : "none"}`);
  say(`  keys with another type: ${c.type_changed.length ? list(c.type_changed) : "none"}`);
  say(`  values that differ on shared keys: ${c.values_changed}`);
  for (const p of c.per_photo.filter((x) => x.only_a.length + x.only_b.length + x.type_changed.length > 0)) say(`  ${p.label}: ${p.only_a.length} only under ${c.a.declared}, ${p.only_b.length} only under ${c.b.declared}, ${p.type_changed.length} with another type`);
  say(`Suggestion (the verdict is Jim's): ${c.suggestion}`);
}
