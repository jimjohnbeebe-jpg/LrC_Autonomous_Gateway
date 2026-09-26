// Phase 1 acceptance check (PHASES.md Phase 1; plan approved by Jim 2026-09-26). The command-line
// entry is phase1-check-cli.ts (`npm run phase1:check`); this module holds the check itself, so the
// contract test (tests/phase1-check.test.ts) can run it against a simulated plugin.
//
// Everything happens on the selected photo under one Develop snapshot, which is applied again at the
// end, so the photo ends as it started. The History panel keeps the steps; that is how Jim checks
// the History name. Steps:
//   1. connect and hello; pings: a non-ASCII nonce, five in flight at once, 20 in a row for timing
//   2. read the photo's context and settings; refuse anything but a raw file on a supported process version
//   3. snapshot "AVG P1 check <time>"
//   4. exposure +0.5, History "AVG P1check pass 1/9", read back (the PHASES.md acceptance write);
//      a photo whose exposure cannot go up by 0.5 is refused in step 2
// Every write has a History name in the FR-4.4 form "AVG <id> pass n/N" (rule 03-lightroom), with
// "P1check" as the id and the nine writes of steps 4-7 numbered 1/9 to 9/9.
//   5. camera profile pairs through the params map: an Adobe Look, then a Nikon profile with Look = {}
//   6. both lens switches off, then on (writing "on" was unverified after S5)
//   7. range probe (Jim's choice): every numeric parameter at its minimum, its maximum, then one step
//      (1 % of the range) below the minimum and above the maximum, four batched writes, each read back
//   8. apply the snapshot and compare every setting with step 2
//   9. two y/n questions for Jim (his choice, instead of a screenshot)

import { BridgeError, type BridgeClient } from "../bridge/index.js";
import type { ParamMap, ReadbackMismatch, SdkSettings } from "../params/index.js";

export const HISTORY = "AVG P1check";
/** Writes in steps 4-7: exposure, two profiles, lens off, lens on, four range-probe writes. */
export const TOTAL_WRITES = 9;
/** History name of the PHASES.md acceptance write (the first write). */
export const ACCEPTANCE_HISTORY_NAME = `${HISTORY} pass 1/${TOTAL_WRITES}`;
const WRITE_TIMEOUT_MS = 30000;
/** The exposure slider's upper limit; the acceptance write needs room for +0.5 below it. */
const EXPOSURE_MAX = 5;

export type Answer = "y" | "n" | "no answer";

export type Phase1Deps = {
  client: BridgeClient;
  map: ParamMap;
  /** Ask Jim a y/n question. */
  ask: (question: string) => Promise<Answer>;
  say: (line: string) => void;
  connectTimeoutMs?: number;
  now?: () => Date;
};

type Step = {
  label: string;
  history_name: string;
  requested: SdkSettings;
  ok: boolean;
  /** An out-of-range probe write: read-back differences are expected, and ok only means it ran. */
  probe?: boolean;
  apply_ms?: number;
  mismatches?: ReadbackMismatch[];
  changed_keys?: string[];
  note?: string;
  error?: string;
};

export function describeError(err: unknown): string {
  if (err instanceof BridgeError) return `${err.code}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

/** Keys whose value differs between two full settings tables, in either direction. */
export function differingKeys(map: ParamMap, before: SdkSettings, after: SdkSettings): string[] {
  const keys = new Set(map.verifyReadback(before, after).map((m) => m.sdk_key));
  for (const key of Object.keys(after)) if (!(key in before)) keys.add(key);
  return [...keys].sort();
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? Number.NaN;
}

/**
 * Run the check. Returns the results (saved by the caller) and whether the acceptance lines passed.
 * The client must be created but not started; it is stopped before the questions.
 */
export async function runPhase1Check(deps: Phase1Deps): Promise<{ accepted: boolean; results: Record<string, unknown> }> {
  const { client, map, ask, say } = deps;
  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  const steps: Step[] = [];
  const errors: string[] = [];
  const results: Record<string, unknown> = { check: "phase1", started_at: startedAt.toISOString(), steps, errors };

  say("LrC-AVG Phase 1 check");
  say("Connecting to Lightroom...");
  client.start();
  const t0 = Date.now();
  try {
    results["hello"] = await client.waitConnected(deps.connectTimeoutMs ?? 20000);
    results["connect_ms"] = Date.now() - t0;
  } catch (err) {
    errors.push(describeError(err));
    results["bridge_stats"] = { ...client.stats };
    client.stop();
    results["summary"] = { acceptance_suggestion: "FAILED", connected: false };
    say("");
    say("FAILED: could not connect to Lightroom.");
    say(`Reason: ${client.stats.last_drop_reason ?? client.stats.last_connect_error ?? describeError(err)}`);
    say("Check that Lightroom is open and that File > Plug-in Manager lists LrC-AVG as Enabled, then run the command again.");
    return { accepted: false, results };
  }
  say(`Connected (${String(results["connect_ms"])} ms).`);

  const target: { target_uuid?: string } = {};
  let snapshotId: string | null = null;
  let start: SdkSettings | null = null;
  let reverted = false;

  let pass = 0;
  const write = async (
    label: string,
    requested: SdkSettings,
    options: { expectOnly?: string[]; probe?: boolean } = {},
  ): Promise<SdkSettings | null> => {
    const { expectOnly, probe = false } = options;
    pass++;
    const historyName = `${HISTORY} pass ${pass}/${TOTAL_WRITES}`;
    const step: Step = { label, history_name: historyName, requested, ok: false, ...(probe ? { probe } : {}) };
    steps.push(step);
    try {
      const before = (await client.request("get_settings", target)).settings;
      const res = await client.request("apply_settings", { ...target, settings: requested, history_name: historyName }, { timeoutMs: WRITE_TIMEOUT_MS });
      step.apply_ms = Math.round(res.apply_ms * 10) / 10;
      step.mismatches = map.verifyReadback(requested, res.read_back);
      step.changed_keys = differingKeys(map, before, res.read_back);
      const unexpected = expectOnly ? step.changed_keys.filter((k) => !expectOnly.includes(k)) : [];
      if (unexpected.length) step.note = `other keys changed too: ${unexpected.join(", ")}`;
      if (probe) {
        // Out-of-range values may be clamped or ignored; that is what the probe records.
        step.ok = true;
        say(`  DONE   ${label} (${step.mismatches.length} value(s) not taken as written; recorded)`);
      } else {
        step.ok = step.mismatches.length === 0 && unexpected.length === 0;
        say(`  ${step.ok ? "OK    " : "FAILED"} ${label}${step.ok ? "" : ` (${step.mismatches.length} read-back mismatch(es)${step.note ? "; " + step.note : ""})`}`);
      }
      return res.read_back;
    } catch (err) {
      step.error = describeError(err);
      say(`  FAILED ${label}: ${step.error}`);
      return null;
    }
  };

  try {
    // 1. Pings.
    say("Checking the connection...");
    const utf8Nonce = "AVG P1 é漢字 ✓";
    const echoed = (await client.request("ping", { nonce: utf8Nonce })).nonce;
    const inFlight = await Promise.all(["a", "b", "c", "d", "e"].map((n) => client.request("ping", { nonce: n })));
    const rtts: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t = performance.now();
      await client.request("ping", { nonce: `rtt-${i}` });
      rtts.push(performance.now() - t);
    }
    results["pings"] = {
      utf8: { sent: utf8Nonce, echoed: echoed ?? null, ok: echoed === utf8Nonce },
      in_flight: { count: 5, ok: inFlight.map((r) => r.nonce).join("") === "abcde" },
      rtt_ms: { n: rtts.length, median: median(rtts), min: Math.min(...rtts), max: Math.max(...rtts) },
    };
    say(`  non-ASCII text round trip: ${echoed === utf8Nonce ? "OK" : "FAILED"}; 5 messages in flight: OK; median round trip ${median(rtts).toFixed(2)} ms`);

    // 2. The photo.
    const context = await client.request("get_context", {});
    target.target_uuid = context.uuid;
    start = (await client.request("get_settings", target)).settings;
    const view = map.fromSdk(start); // throws on an unsupported process version, before any write
    results["photo"] = {
      uuid: context.uuid,
      local_id: context.local_id,
      filename: context["filename"] ?? null,
      file_format: context["file_format"] ?? null,
      is_virtual_copy: context["is_virtual_copy"] ?? null,
      lrc_version: context.lrc_version,
      metadata_errors: context.metadata_errors ?? [],
      process_version: view.process_version,
      camera_profile: view.camera_profile,
      unpinned_keys: view.unpinned_keys,
      key_count: Object.keys(start).length,
    };
    say(`Photo: ${String(context["filename"])} (${String(context["file_format"])}, process version ${view.process_version}, profile ${view.camera_profile.name ?? view.camera_profile.camera_profile})`);
    if (context["file_format"] === undefined) {
      const why = context.metadata_errors?.find((e) => e.startsWith("fileFormat: ")) ?? context.metadata_errors?.[0];
      throw new Error(`the plugin could not read the photo's file format${why ? ` (${why})` : ""}; nothing was changed. Tell Claude Code`);
    }
    if (context["file_format"] !== "RAW") {
      throw new Error(`the selected photo is ${String(context["file_format"])}, not a raw file: select 20260907-_OZ80093.NEF and run the command again`);
    }
    // PHASES.md asks for exposure +0.5; refuse a photo that has no room for it rather than go down.
    const exposureStart = view.settings["exposure"];
    if (typeof exposureStart !== "number" || exposureStart + 0.5 > EXPOSURE_MAX) {
      throw new Error(`the photo's exposure is ${String(exposureStart)}, so +0.5 would pass +${EXPOSURE_MAX}: set Exposure below +4.5 and run the command again`);
    }

    // 3. Snapshot.
    const snapName = `AVG P1 check ${startedAt.toLocaleString("sv-SE").replace(",", "")}`;
    const snap = await client.request("create_snapshot", { ...target, name: snapName });
    snapshotId = snap.snapshot_id;
    results["snapshot"] = { name: snapName, snapshot_id: snap.snapshot_id, same_name_count: snap.same_name_count };
    say(`Snapshot "${snapName}" made. Writing:`);

    // 4. Exposure +0.5 (the acceptance write, pass 1).
    const exposureTarget = Math.round((exposureStart + 0.5) * 100) / 100;
    const exposureSdk = map.toSdk({ exposure: exposureTarget }, { processVersion: view.process_version });
    const afterExposure = await write(`exposure ${exposureStart} -> ${exposureTarget}`, exposureSdk, {
      expectOnly: Object.keys(exposureSdk),
    });
    results["exposure"] = { start: exposureStart, target: exposureTarget, read_back: afterExposure ? map.fromSdk(afterExposure).settings["exposure"] : null };

    // 5. Camera profile pairs (P-07, P-12, P-17).
    const adobe = view.camera_profile.name === "Adobe Landscape" ? "Adobe Neutral" : "Adobe Landscape";
    for (const name of [adobe, "Camera Landscape"]) {
      const sdk = map.toSdk({ camera_profile: name }, { processVersion: view.process_version });
      const rb = await write(`camera profile ${name}`, sdk, { expectOnly: ["CameraProfile", "Look"] });
      const last = steps[steps.length - 1] as Step;
      const identified = rb ? map.fromSdk(rb).camera_profile.name : null;
      if (rb && identified !== name) {
        last.ok = false;
        last.note = `${last.note ? last.note + "; " : ""}read back as ${String(identified)}`;
      }
    }

    // 6. Lens switches off, then on (P-16).
    await write("lens corrections off",
      map.toSdk({ "lens.corrections_enable": false, "lens.profile_enable": 0 }, { processVersion: view.process_version }));
    await write("lens corrections on",
      map.toSdk({ "lens.corrections_enable": true, "lens.profile_enable": 1 }, { processVersion: view.process_version }));

    // 7. Range probe.
    say("Range probe:");
    const numeric = map.names().flatMap((name) => {
      const spec = map.spec(name);
      return spec?.kind === "number" ? [{ name, spec }] : [];
    });
    const batch = (pick: (min: number, max: number, delta: number) => number): SdkSettings =>
      Object.fromEntries(numeric.map(({ spec }) => [spec.sdkKey, pick(spec.min, spec.max, (spec.max - spec.min) * 0.01)]));
    const probeLabels = ["at minimum", "at maximum", "1 % below minimum", "1 % above maximum"] as const;
    const probeValues = [batch((min) => min), batch((_min, max) => max), batch((min, _max, d) => min - d), batch((_min, max, d) => max + d)];
    const readBacks: Array<SdkSettings | null> = [];
    for (let i = 0; i < 4; i++) {
      readBacks.push(await write(`range probe: all ${numeric.length} numeric parameters ${probeLabels[i]}`,
        probeValues[i] as SdkSettings, { probe: i >= 2 }));
    }
    // What Lightroom did with a value one step beyond a limit: took it as written, clamped it to that
    // limit, ignored it (the value from the previous write stayed), or something else. When the
    // previous value equals the limit, clamped and ignored look the same and are not told apart.
    const outcome = (written: number, read: unknown, limit: number, previous: unknown): string => {
      if (typeof read !== "number") return "missing";
      const same = (a: unknown) => typeof a === "number" && Math.abs(a - read) <= 1e-6;
      if (same(written)) return "accepted";
      if (same(limit) && same(previous)) return "clamped_or_ignored";
      if (same(limit)) return "clamped";
      if (same(previous)) return "ignored";
      return "other";
    };
    const probe = numeric.map(({ name, spec }) => {
      const delta = (spec.max - spec.min) * 0.01;
      const read = (i: number) => readBacks[i]?.[spec.sdkKey] ?? null;
      return {
        name,
        sdk_key: spec.sdkKey,
        min: spec.min,
        max: spec.max,
        min_read: read(0),
        max_read: read(1),
        below_written: spec.min - delta,
        below_read: read(2),
        below_outcome: outcome(spec.min - delta, read(2), spec.min, read(1)),
        above_written: spec.max + delta,
        above_read: read(3),
        above_outcome: outcome(spec.max + delta, read(3), spec.max, read(2)),
      };
    });
    const count = (pred: (p: (typeof probe)[number]) => boolean) => probe.filter(pred).length;
    const tally = (key: "below_outcome" | "above_outcome") =>
      Object.fromEntries(
        ["accepted", "clamped", "ignored", "clamped_or_ignored", "other", "missing"].map((o) => [o, count((p) => p[key] === o)]),
      );
    const rangeProbe = {
      parameters: probe.length,
      min_accepted: count((p) => typeof p.min_read === "number" && Math.abs(p.min_read - p.min) <= 1e-6),
      max_accepted: count((p) => typeof p.max_read === "number" && Math.abs(p.max_read - p.max) <= 1e-6),
      below_min: tally("below_outcome"),
      above_max: tally("above_outcome"),
      per_parameter: probe,
    };
    results["range_probe"] = rangeProbe;
    say(`  limits taken as written: minimum ${rangeProbe.min_accepted}/${probe.length}, maximum ${rangeProbe.max_accepted}/${probe.length}; ` +
      `one step beyond: below ${JSON.stringify(rangeProbe.below_min)}, above ${JSON.stringify(rangeProbe.above_max)}`);
  } catch (err) {
    errors.push(describeError(err));
    say(`FAILED: ${describeError(err)}`);
  } finally {
    // 8. Put the photo back.
    if (snapshotId && start) {
      try {
        const res = await client.request("apply_snapshot", { ...target, snapshot_id: snapshotId }, { timeoutMs: WRITE_TIMEOUT_MS });
        const differing = differingKeys(map, start, res.read_back);
        reverted = differing.length === 0;
        results["revert"] = { ok: reverted, differing_keys: differing, key_count: Object.keys(res.read_back).length };
        say(`Snapshot applied. Photo put back to how it was: ${reverted ? "YES" : `NO - ${differing.length} setting(s) differ: ${differing.join(", ")}`}`);
      } catch (err) {
        errors.push(`revert: ${describeError(err)}`);
        results["revert"] = { ok: false, error: describeError(err) };
        const snapName = (results["snapshot"] as { name?: string } | undefined)?.name;
        say(`Photo put back to how it was: NO - ${describeError(err)}. The snapshot "${String(snapName)}" is in the Snapshots panel.`);
      }
    }
    results["bridge_stats"] = { ...client.stats };
    client.stop();
  }

  // 9. Jim's two observations.
  let jimOk = false;
  if (snapshotId) {
    say("");
    say("Two questions. Look at Lightroom's Develop module.");
    const history = await ask(`1. In the History panel (left side), is there a step named "${ACCEPTANCE_HISTORY_NAME}"?`);
    const restored = await ask("2. Does the photo look the same as before the check (same Exposure, same Profile)?");
    results["jim"] = { history_step_seen: history, photo_looks_restored: restored, asked_at: now().toISOString() };
    jimOk = history === "y" && restored === "y";
  }

  const exposureStep = steps.find((s) => s.history_name === ACCEPTANCE_HISTORY_NAME);
  const accepted = Boolean(exposureStep?.ok) && reverted && jimOk;
  const extended = steps.filter((s) => s !== exposureStep && !s.probe);
  results["summary"] = {
    acceptance_suggestion: accepted ? "WORKED" : "FAILED",
    exposure_write_read_back: Boolean(exposureStep?.ok),
    snapshot_revert_exact: reverted,
    jim_confirmed: jimOk,
    extended_steps_ok: extended.filter((s) => s.ok).length,
    extended_steps_total: extended.length,
  };
  results["finished_at"] = now().toISOString();
  say("");
  say(`Phase 1 acceptance: ${accepted ? "WORKED" : "FAILED"} (exposure write read back: ${exposureStep?.ok ? "YES" : "NO"}; photo put back exactly: ${reverted ? "YES" : "NO"}; your answers: ${jimOk ? "both yes" : "not both yes"})`);
  say(`Other writes (profiles, lens, range limits): ${extended.filter((s) => s.ok).length} of ${extended.length} read back as sent.`);
  return { accepted, results };
}
