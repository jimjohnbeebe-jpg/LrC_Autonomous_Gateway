// Phase 2 acceptance check (PHASES.md Phase 2; plan approved by Jim 2026-09-26). The command-line
// entry is phase2-check-cli.ts (`npm run phase2:check`); this module holds the steps, so the contract
// test (tests/phase2-check.test.ts) can run them against a simulated plugin.
//
// Part 1 drives Lightroom through the same Tools class the MCP server uses (src/mcp/tools.ts), under
// one Develop snapshot that is applied again at the end:
//   1. take the engine lock (Claude Desktop must not be running the engine) and connect
//   2. the photo's context: a raw file on a supported process version, with room for exposure +1.0
//   3. snapshot "AVG P2 check <time>"
//   4. export timing at long edges 800, 1200 and 1600 px, three times each (open item: export time at
//      smaller long edges; PRD NFR-2)
//   5. two exports at JPEG quality 60 and 90: does the file size follow? (open item: the
//      LR_jpeg_quality range; the plugin passes quality / 100)
//   6. pings while an export runs (PHASE1.md "Consequences": round trips while Lightroom exports)
//   7. three lr_set_settings passes, exposure +0.5, +1.0, back to the start, each with its preview;
//      each pass is timed part by part (the write command, the export, the metrics, the whole pass)
//      against the ~3 s pass budget (P-02)
//   8. apply the snapshot and compare every setting with the start
//   9. release the lock and the bridge; two y/n questions (Jim's choice: y/n in this window)
// Part 2 is the PHASES.md acceptance line: Jim's chat in Claude Desktop, where Claude describes the
// photo, raises exposure and describes the change. Claude Desktop's engine connects to the plugin
// after this one left, in the same Lightroom session (open item P-13: the send-socket rebind on a
// second engine connection). The check then asks three y/n questions and collects Claude Desktop's
// MCP log and the engine's tool log from the time of the chat.

import type { BridgeClient } from "../bridge/index.js";
import type { BridgeGate, Tools } from "../mcp/index.js";
import { PREVIEW_QUALITY, ToolError } from "../mcp/index.js";
import type { ParamMap, SdkSettings } from "../params/index.js";
import type { PreviewService } from "../preview/index.js";
import { describeError, differingKeys, median } from "./phase1-check.js";

export const HISTORY_PREFIX = "AVG P2check";
/** The plugin version with export_preview; Bridge.lua PLUGIN_VERSION (tests/lua-plugin.test.ts keeps them equal). */
export const REQUIRED_PLUGIN_VERSION = "0.2.0";
export const LONG_EDGES = [800, 1200, 1600] as const;
export const QUALITIES = [60, 90] as const;
/** About 3 s per pass (Phase 0, P-02) [handle: docs\reports\phase0\S1.md; PRD NFR-2]. */
export const PASS_BUDGET_MS = 3000;
export const CHAT_PROMPT = "Look at the photo selected in Lightroom and describe it. Then raise its exposure by 0.5 EV and describe what changed.";
const EXPOSURE_MAX = 5;
const WRITE_TIMEOUT_MS = 30000;

export type Answer = "y" | "n" | "no answer";

/** What the CLI collects after the chat (phase2-check-cli.ts). */
export type ChatLogs = {
  /** Claude Desktop's log for the lrc-avg server: lines from the chat, user folder redacted. */
  desktop_log: { found: boolean; saved_as: string | null; lines: number };
  /** The engine's tool-log records from the chat (Claude Desktop's engine writes them). */
  engine_log: { found: boolean; saved_as: string | null; records: Array<Record<string, unknown>> };
};

export type Phase2Deps = {
  client: BridgeClient;
  gate: BridgeGate;
  tools: Tools;
  previews: PreviewService;
  map: ParamMap;
  ask: (question: string) => Promise<Answer>;
  /** Show the prompt and wait for Enter; false if input ended. */
  waitEnter: (prompt: string) => Promise<boolean>;
  say: (line: string) => void;
  collectChat: (since: Date) => ChatLogs;
  connectTimeoutMs?: number;
  repeats?: number;
  now?: () => Date;
};

type Stats = { n: number; median: number; min: number; max: number };

function stats(values: number[]): Stats {
  const r = (v: number) => Math.round(v * 10) / 10;
  return values.length
    ? { n: values.length, median: r(median(values)), min: r(Math.min(...values)), max: r(Math.max(...values)) }
    : { n: 0, median: Number.NaN, min: Number.NaN, max: Number.NaN };
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Replace the user folder with %USERPROFILE%, as written and JSON-escaped, in any letter case, so no
 * committed evidence file carries Jim's user-folder path.
 */
export function redactHome(text: string, home: string): string {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text
    .replace(new RegExp(escape(home.replace(/\\/g, "\\\\")), "gi"), "%USERPROFILE%")
    .replace(new RegExp(escape(home), "gi"), "%USERPROFILE%");
}

/** What the chat's tool log shows: Claude saw the photo, raised exposure by 0.5 and saw the result. */
export function evaluateChat(records: Array<Record<string, unknown>>): {
  tool_calls: Array<{ ts: unknown; tool: unknown; ok: unknown; error_code?: unknown }>;
  saw_photo: boolean;
  exposure_raised_by_half: boolean;
  saw_change: boolean;
} {
  const tool_calls = records.map((r) => ({
    ts: r["ts"],
    tool: r["tool"],
    ok: r["ok"],
    ...(r["error"] ? { error_code: (r["error"] as { code?: unknown }).code } : {}),
  }));
  const saw_photo = records.some((r) => r["ok"] === true && r["tool"] === "lr_get_preview");
  let raiseIndex = -1;
  records.forEach((r, i) => {
    if (raiseIndex >= 0 || r["ok"] !== true || r["tool"] !== "lr_set_settings") return;
    const changes = Array.isArray(r["changes"]) ? (r["changes"] as Array<Record<string, unknown>>) : [];
    const exposure = changes.find((c) => c["name"] === "exposure");
    const before = exposure?.["before"];
    const after = exposure?.["after"];
    if (typeof before === "number" && typeof after === "number" && Math.abs(after - before - 0.5) <= 0.051) raiseIndex = i;
  });
  const raise = raiseIndex >= 0 ? records[raiseIndex] : undefined;
  const saw_change =
    raise !== undefined &&
    (typeof raise["preview_hash"] === "string" || records.slice(raiseIndex + 1).some((r) => r["ok"] === true && r["tool"] === "lr_get_preview"));
  return { tool_calls, saw_photo, exposure_raised_by_half: raiseIndex >= 0, saw_change };
}

/**
 * Run the check. Returns the results (saved by the caller) and whether the acceptance lines passed.
 * The gate must not hold the lock yet; the check releases it before Part 2.
 */
export async function runPhase2Check(deps: Phase2Deps): Promise<{ accepted: boolean; results: Record<string, unknown> }> {
  const { client, gate, tools, previews, map, ask, say } = deps;
  const now = deps.now ?? (() => new Date());
  const repeats = deps.repeats ?? 3;
  const startedAt = now();
  const errors: string[] = [];
  const results: Record<string, unknown> = { check: "phase2", started_at: startedAt.toISOString(), errors };
  const fail = (message: string) => {
    errors.push(message);
    say(`FAILED: ${message}`);
  };

  say("LrC-AVG Phase 2 check");
  say("Part 1: the engine drives Lightroom. Connecting...");
  if (!(await gate.start())) {
    results["summary"] = { acceptance_suggestion: "FAILED", lock: "busy" };
    fail("another LrC-AVG engine is using the Lightroom bridge. Quit Claude Desktop: right-click the Claude icon in the Windows system tray > Quit. Then run the command again.");
    return { accepted: false, results };
  }
  const t0 = Date.now();
  try {
    results["hello"] = await client.waitConnected(deps.connectTimeoutMs ?? 20000);
    results["connect_ms"] = Date.now() - t0;
  } catch (err) {
    results["bridge_stats"] = { ...client.stats };
    await gate.release();
    results["summary"] = { acceptance_suggestion: "FAILED", connected: false };
    say("");
    fail(`could not connect to Lightroom (${client.stats.last_drop_reason ?? client.stats.last_connect_error ?? describeError(err)}). ` +
      "Check that Lightroom is open and that File > Plug-in Manager lists LrC-AVG as Enabled, then run the command again.");
    return { accepted: false, results };
  }
  const pluginVersion = (results["hello"] as { plugin_version?: unknown }).plugin_version;
  if (pluginVersion !== REQUIRED_PLUGIN_VERSION) {
    await gate.release();
    results["summary"] = { acceptance_suggestion: "FAILED", plugin_version: pluginVersion };
    fail(`Lightroom is running LrC-AVG plugin ${String(pluginVersion)}, not ${REQUIRED_PLUGIN_VERSION}. ` +
      "Restart Lightroom (File > Exit, then start it) and run the command again.");
    return { accepted: false, results };
  }
  say(`Connected (${String(results["connect_ms"])} ms, plugin ${REQUIRED_PLUGIN_VERSION}).`);

  let uuid = "";
  let snapshot: { id: string; name: string } | null = null;
  let start: SdkSettings | null = null;
  let reverted = false;
  const passes: Array<Record<string, unknown>> = [];
  results["passes"] = passes;

  try {
    // 2. The photo.
    const context = (await tools.getActivePhotoContext()).json;
    uuid = String(context["uuid"]);
    results["photo"] = {
      uuid,
      filename: context["filename"],
      file_format: context["file_format"],
      process_version: context["process_version"],
      camera_profile: context["camera_profile"],
      rating: context["rating"],
      label: context["label"],
      pick: context["pick"],
      metadata_errors: context["metadata_errors"] ?? [],
    };
    say(`Photo: ${String(context["filename"])} (${String(context["file_format"])}, process version ${String(context["process_version"])}, profile ${String(context["camera_profile"])})`);
    say(`  rating ${String(context["rating"])}, label ${String(context["label"])}, pick ${String(context["pick"])}` +
      `${(context["metadata_errors"] as string[] | undefined)?.length ? `; not read: ${(context["metadata_errors"] as string[]).join("; ")}` : ""}`);
    if (context["file_format"] !== "RAW") {
      throw new Error(`the selected photo is ${String(context["file_format"])}, not a raw file: select 20260907-_OZ80093.NEF and run the command again`);
    }
    const settings = context["settings"] as Record<string, unknown> | null;
    if (!settings) throw new Error(`the photo's settings could not be read (${JSON.stringify(context["settings_error"])}); nothing was changed. Tell Claude Code`);
    const e0 = settings["exposure"];
    if (typeof e0 !== "number" || e0 + 1.0 > EXPOSURE_MAX) {
      throw new Error(`the photo's exposure is ${String(e0)}, so +1.0 would pass +${EXPOSURE_MAX}: set Exposure below +4.0 and run the command again`);
    }
    start = (await client.request("get_settings", { target_uuid: uuid })).settings;

    // 3. Snapshot.
    const snapName = `AVG P2 check ${startedAt.toLocaleString("sv-SE").replace(",", "")}`;
    const snap = await client.request("create_snapshot", { target_uuid: uuid, name: snapName });
    snapshot = { id: snap.snapshot_id, name: snapName };
    results["snapshot"] = { name: snapName, snapshot_id: snap.snapshot_id };
    say(`Snapshot "${snapName}" made.`);

    // 4. Export timing by long edge.
    say(`Exports (${repeats} per size):`);
    const byEdge: Record<string, unknown> = {};
    for (const edge of LONG_EDGES) {
      const runs: Array<Record<string, unknown>> = [];
      for (let i = 0; i < repeats; i++) {
        const { json } = await tools.getPreview({ long_edge: edge });
        const t = json["timings"] as { export_ms: number; command_ms: number; total_ms: number };
        runs.push({ width: json["width"], height: json["height"], bytes: json["bytes"], reencoded: json["reencoded"], ...t });
      }
      const exportStats = stats(runs.map((r) => r["export_ms"] as number));
      byEdge[String(edge)] = { export_ms: exportStats, total_ms: stats(runs.map((r) => r["total_ms"] as number)), runs };
      say(`  ${edge} px: export ${exportStats.median} ms median (${exportStats.min}-${exportStats.max}); ` +
        `${String(runs[0]?.["width"])}x${String(runs[0]?.["height"])}, ${String(runs[0]?.["bytes"])} bytes`);
    }
    results["exports"] = byEdge;

    // 5. Quality.
    const quality: Record<string, unknown> = {};
    for (const q of QUALITIES) {
      const p = await previews.render({ longEdge: 1600, quality: q, targetUuid: uuid });
      quality[String(q)] = { bytes: p.bytes, export_ms: p.timings.export_ms, reencoded: p.reencoded };
    }
    const low = (quality[String(QUALITIES[0])] as { bytes: number }).bytes;
    const high = (quality[String(QUALITIES[1])] as { bytes: number }).bytes;
    results["quality"] = { ...quality, size_follows_quality: high > low * 1.1, ratio: Math.round((high / low) * 100) / 100 };
    say(`  quality ${QUALITIES[0]} -> ${low} bytes, quality ${QUALITIES[1]} -> ${high} bytes: size follows quality: ${high > low * 1.1 ? "YES" : "NO"}`);

    // 6. Pings while Lightroom exports.
    const dropsBefore = client.stats.drops;
    const rtts: number[] = [];
    let pingErrors = 0;
    let exporting = true;
    const exported = previews.render({ longEdge: 1600, quality: PREVIEW_QUALITY, targetUuid: uuid }).finally(() => {
      exporting = false;
    });
    const pinger = (async () => {
      while (exporting) {
        const t = performance.now();
        try {
          await client.request("ping", { nonce: "during-export" }, { timeoutMs: 10000 });
          rtts.push(performance.now() - t);
        } catch {
          pingErrors++;
        }
        await delay(200);
      }
    })();
    const during = await exported;
    await pinger;
    results["pings_during_export"] = { export_ms: during.timings.export_ms, rtt_ms: stats(rtts), errors: pingErrors, bridge_drops: client.stats.drops - dropsBefore };
    say(`  pings during an export: ${rtts.length} answered, median ${stats(rtts).median} ms, max ${stats(rtts).max} ms, ${pingErrors} failed`);

    // 7. Three passes.
    say("Passes (lr_set_settings, each with its preview):");
    const round = (v: number) => Math.round(v * 100) / 100;
    const targets = [round(e0 + 0.5), round(e0 + 1.0), e0];
    for (const [i, value] of targets.entries()) {
      const pass: Record<string, unknown> = { n: i + 1, exposure: value, ok: false };
      passes.push(pass);
      try {
        const { json } = await tools.setSettings({ uuid, settings: { exposure: value } });
        const delta = (json["delta_metrics"] as { luma_mean?: number } | null)?.luma_mean ?? null;
        const expectUp = value > (i === 0 ? e0 : (targets[i - 1] as number));
        const t = json["timings"] as Record<string, unknown>;
        const preview = (t["preview"] ?? {}) as Record<string, unknown>;
        Object.assign(pass, {
          history_name: json["history_name"],
          changes: json["changes"],
          delta_luma_mean: delta,
          preview_error: json["preview_error"] ?? null,
          timings: {
            get_settings_ms: t["get_settings_ms"],
            write_ms: t["write_ms"],
            plugin_apply_ms: t["plugin_apply_ms"],
            plugin_read_ms: t["plugin_read_ms"] ?? null,
            plugin_command_ms: t["plugin_command_ms"] ?? null,
            export_ms: preview["export_ms"] ?? null,
            preview_command_ms: preview["command_ms"] ?? null,
            file_ms: preview["file_ms"] ?? null,
            metrics_ms: preview["metrics_ms"] ?? null,
            total_ms: t["total_ms"],
          },
        });
        pass["ok"] = !json["preview_error"] && typeof delta === "number" && (expectUp ? delta > 0 : delta < 0);
        const total = t["total_ms"] as number;
        say(`  ${pass["ok"] ? "OK    " : "FAILED"} ${String(json["history_name"])}: exposure ${value}, mean luma ${delta !== null && delta >= 0 ? "+" : ""}${String(delta)}; ` +
          `write ${String(t["write_ms"])} ms, export ${String(preview["export_ms"])} ms, whole pass ${total} ms (${total <= PASS_BUDGET_MS ? "within" : "over"} ~${PASS_BUDGET_MS / 1000} s)`);
      } catch (err) {
        pass["error"] = err instanceof ToolError ? err.body() : describeError(err);
        say(`  FAILED pass ${i + 1}: ${describeError(err)}`);
      }
    }
  } catch (err) {
    fail(describeError(err));
  } finally {
    // 8. Put the photo back.
    if (snapshot && start) {
      try {
        const res = await client.request("apply_snapshot", { target_uuid: uuid, snapshot_id: snapshot.id }, { timeoutMs: WRITE_TIMEOUT_MS });
        const differing = differingKeys(map, start, res.read_back);
        reverted = differing.length === 0;
        results["revert"] = { ok: reverted, differing_keys: differing, key_count: Object.keys(res.read_back).length };
        say(`Snapshot applied. Photo put back to how it was: ${reverted ? "YES" : `NO - ${differing.length} setting(s) differ: ${differing.join(", ")}`}`);
      } catch (err) {
        errors.push(`revert: ${describeError(err)}`);
        results["revert"] = { ok: false, error: describeError(err) };
        say(`Photo put back to how it was: NO - ${describeError(err)}. The snapshot "${snapshot.name}" is in the Snapshots panel.`);
      }
    }
    results["bridge_stats"] = { ...client.stats };
    // 9. Leave the bridge to Claude Desktop's engine.
    await gate.release();
  }

  const passesOk = passes.length === 3 && passes.every((p) => p["ok"] === true);
  let part1Jim = false;
  if (snapshot) {
    say("");
    say("Two questions. Look at Lightroom's Develop module.");
    const history = await ask(`1. In the History panel (left side), are there three steps named "${HISTORY_PREFIX} set 1", "${HISTORY_PREFIX} set 2" and "${HISTORY_PREFIX} set 3"?`);
    const restored = await ask("2. Does the photo look the same as before the check (same Exposure)?");
    results["jim_part1"] = { history_steps_seen: history, photo_looks_restored: restored };
    part1Jim = history === "y" && restored === "y";
  }

  // Part 2: the chat.
  let chatOk = false;
  if (errors.length === 0 && passesOk && reverted) {
    say("");
    say("Part 2: the chat in Claude Desktop.");
    say("  1. Start Claude Desktop (Start menu > Claude).");
    say("  2. Open a new chat, type this sentence and press Enter:");
    say(`       ${CHAT_PROMPT}`);
    say("  3. If Claude Desktop asks whether Claude may use an lrc-avg tool, allow it.");
    say("  4. Wait until Claude has answered both parts.");
    const chatStart = now();
    results["chat_started_at"] = chatStart.toISOString();
    const entered = await deps.waitEnter("  5. Come back to this window and press Enter.");
    if (!entered) {
      errors.push("input ended before the chat was done");
    } else {
      const described = await ask("3. Did Claude describe the photo correctly?");
      const brighter = await ask("4. Is the photo in Lightroom now brighter, with Exposure 0.5 higher than before the chat?");
      const change = await ask("5. Did Claude describe the change correctly?");
      results["jim_part2"] = { photo_described: described, photo_brighter: brighter, change_described: change };
      const logs = deps.collectChat(chatStart);
      const evaluation = evaluateChat(logs.engine_log.records);
      results["chat"] = {
        desktop_log: logs.desktop_log,
        engine_log: { found: logs.engine_log.found, saved_as: logs.engine_log.saved_as, records: logs.engine_log.records.length },
        ...evaluation,
      };
      say(`Chat log: Claude Desktop's MCP log ${logs.desktop_log.found ? `found (${logs.desktop_log.lines} lines)` : "NOT found"}; ` +
        `engine tool log ${logs.engine_log.found ? `found (${logs.engine_log.records.length} calls)` : "NOT found"}.`);
      say(`  Claude looked at a preview: ${evaluation.saw_photo ? "YES" : "NO"}; raised exposure by 0.5: ${evaluation.exposure_raised_by_half ? "YES" : "NO"}; ` +
        `saw the result: ${evaluation.saw_change ? "YES" : "NO"}`);
      chatOk = described === "y" && brighter === "y" && change === "y" && evaluation.saw_photo && evaluation.exposure_raised_by_half && evaluation.saw_change;
    }
    if (snapshot) {
      say("");
      say(`Last step: in the Snapshots panel (left side of Develop), click "${snapshot.name}". That puts the photo back as it was before the check.`);
    }
  } else {
    say("");
    say("Part 2 (the chat) was skipped because Part 1 did not pass. Tell Claude Code what this window says.");
  }

  const passTotals = passes.map((p) => (p["timings"] as { total_ms?: number } | undefined)?.total_ms).filter((v): v is number => typeof v === "number");
  const accepted = passesOk && reverted && part1Jim && chatOk;
  results["summary"] = {
    acceptance_suggestion: accepted ? "WORKED" : "FAILED",
    passes_ok: passesOk,
    snapshot_revert_exact: reverted,
    jim_part1_confirmed: part1Jim,
    chat_ok: chatOk,
    pass_total_ms: stats(passTotals),
    passes_within_budget: passTotals.filter((v) => v <= PASS_BUDGET_MS).length,
  };
  results["finished_at"] = now().toISOString();
  say("");
  say(`Phase 2 acceptance: ${accepted ? "WORKED" : "FAILED"} (passes: ${passesOk ? "YES" : "NO"}; photo put back exactly: ${reverted ? "YES" : "NO"}; ` +
    `your answers in part 1: ${part1Jim ? "both yes" : "not both yes"}; chat: ${chatOk ? "YES" : "NO"})`);
  return { accepted, results };
}
