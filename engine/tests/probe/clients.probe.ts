// `npm run clients:probe` (ISSUE155_PLAN R5): each installed AI client, started headless with one
// prompt against the built engine and the Lightroom simulator (harness.ts), never Jim's Lightroom.
// Per client: T1 the tools listed (35) with no schema error; T2 clientInfo, progressToken and the
// self-reported model, read from the scratch tool and session logs; T3 a random word printed on the
// preview read back by the model; T4 begin -> step -> end in the session log; T5 a 70 s export that
// finishes through continuations (`pending` lines or `not_yet` in the tool log). A client that is not
// installed is "not run", never a failure. The self-checks run with no client:
// LRC_AVG_PROBE_CLIENTS=none runs only them; a comma list (e.g. "opencode,hermes") picks clients.
// Results: report.ts. Registrations are restored in `finally`, and a stopped run's are repaired first.

import { execFileSync, spawn } from "node:child_process";
import { randomInt } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { register, restore, restoreLeftovers, type Registration } from "../../src/devtools/clients-config.js";
import { CLIENT_IDS, findClient, launchFor, MODELS, type ClientId, type Launch } from "../../src/devtools/clients-launch.js";
import { engineSelfCheck, startHarness, TOOL_COUNT, wordSelfCheck, type Harness } from "./harness.js";
import { notRun, writeReport, type Check, type ClientResult, type ProbeReport } from "./report.js";

const WORDS = ["PELICAN", "LANTERN", "MEADOW", "COMPASS", "HARBOR", "VIOLIN", "GLACIER", "TEAPOT", "CANYON", "ORCHID"];
const RUN_TIMEOUT_MS = 12 * 60_000;
const EXPORT_DELAY_MS = 70_000;
const RUNS = path.join(os.tmpdir(), "lrc-avg-probe-runs");
const pick = process.env["LRC_AVG_PROBE_CLIENTS"];
const selected: ClientId[] = pick === undefined || pick === "" ? [...CLIENT_IDS] : CLIENT_IDS.filter((id) => pick.split(",").includes(id));
const report: ProbeReport = { date: new Date().toISOString(), self_checks: {}, clients: [] };

function prompt(out: string): string {
  return [
    "This is an automated compatibility test of the lrc-avg MCP server against a simulated Lightroom; no real photo is involved.",
    "Use the lrc-avg tools and do these steps in order, without asking questions:",
    "1. Count how many tools the lrc-avg server gives you.",
    "2. Call lr_get_preview for the selected photo. The image shows one English word printed in a light box in its middle; read it.",
    "3. Call lr_begin_session with model set to your own model name or id. Then call lr_step once with that session_id, settings {exposure: 0.1} and a one-line rationale. Then call lr_end_session with that session_id and outcome accept.",
    `4. Call lr_export_photos with uuids [SIM-UUID], folder ${out.replace(/\\/g, "/")} and format jpeg. If its result says the work is still going (pending, not_yet or next), do what it says and call again until the export is finished.`,
    "Then reply with exactly three lines: TOOLS= followed by the count, WORD= followed by the word, EXPORT= followed by done or failed.",
  ].join("\n");
}

type Run = { code: number | null; stdout: string; stderr: string; ms: number };

function runClient(l: Launch): Promise<Run> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(l.file, l.args, { cwd: l.cwd, env: l.env, shell: l.shell, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    child.stdin.on("error", () => {});
    child.stdin.end(l.stdin ?? "");
    // The tree: a client's own children (the engine among them) go with it.
    const timer = setTimeout(() => {
      try {
        execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      } catch {
        child.kill();
      }
    }, RUN_TIMEOUT_MS);
    child.on("error", (err) => (clearTimeout(timer), reject(err)));
    child.on("close", (code) => (clearTimeout(timer), resolve({ code, stdout, stderr, ms: Date.now() - started })));
  });
}

type Line = Record<string, unknown>;
const toolLines = (dir: string): Line[] =>
  readdirSync(dir)
    .filter((f) => /^engine-\d{8}\.jsonl$/.test(f))
    .flatMap((f) => readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Line));
const sessionLogs = (dir: string): Line[] =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".recipe.json"))
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as Line)
    .filter((j) => typeof j["session_id"] === "string");

/**
 * The tools the client loaded, and where the count came from. Claude Code's stream-json system/init
 * event has a `tools` array with MCP tools named mcp__<server>__<tool> [handle:
 * docs/reports/phase0/S3/s3_cli_run_redacted.jsonl:1, Claude Code 2.1.283; spikes/S3/summarize-cli-run.ts:131-133]
 * ([unverified] for 2.1.300); without it, and for the other clients, the model's TOOLS= line.
 */
function toolCount(stdout: string): { count: number | null; source: "init event" | "model" | "none" } {
  for (const line of stdout.split("\n")) {
    try {
      const e = JSON.parse(line) as { type?: string; subtype?: string; tools?: string[] };
      if (e.type === "system" && e.subtype === "init" && Array.isArray(e.tools)) return { count: e.tools.filter((t) => t.startsWith("mcp__lrc-avg__")).length, source: "init event" };
    } catch {
      // not a JSON line
    }
  }
  const said = [...stdout.matchAll(/TOOLS\s*=\s*(\d+)/g)].at(-1);
  return said ? { count: Number(said[1]), source: "model" } : { count: null, source: "none" };
}

const check = (yes: boolean, detail: string): Check => ({ yes, detail });

function judge(id: ClientId, run: Run, h: Harness, word: string, registration: string): ClientResult {
  const lines = toolLines(h.logDir);
  const sessions = sessionLogs(h.logDir);
  const client = lines.map((l) => l["client"]).find((c): c is { name: string; version: string } => typeof c === "object" && c !== null) ?? null;
  const tokens = lines.map((l) => l["progress_token"]).filter((t): t is boolean => typeof t === "boolean");
  const model = sessions.map((s) => s["model"]).find((m): m is string => typeof m === "string") ?? null;
  const { count, source } = toolCount(run.stdout);
  const schemaError = /(invalid|error)[^\n]{0,80}schema|schema[^\n]{0,80}(invalid|error)/i.test(run.stdout + run.stderr);
  const stepped = sessions.some((s) => Array.isArray(s["passes"]) && (s["passes"] as Line[]).some((p) => p["kind"] === "step") && s["ended"] !== null);
  const exports = lines.filter((l) => l["tool"] === "lr_export_photos");
  const continued = exports.some((l) => "pending" in l || (typeof l["not_yet"] === "number" && l["not_yet"] > 0));
  const written = readdirSync(h.outDir).filter((f) => f.toLowerCase().endsWith(".jpg"));
  return {
    client: id,
    status: "run",
    registration,
    model_requested: MODELS[id] ?? null,
    model_reported: model,
    client_info: client,
    progress_token: tokens.length === 0 ? null : tokens.includes(true),
    exit_code: run.code,
    duration_ms: run.ms,
    excerpt: run.stdout.slice(-1500),
    t1: check(count === TOOL_COUNT && !schemaError, `tools ${count ?? "unknown"} (from ${source}), schema error ${schemaError}, ${lines.length} tool-log lines`),
    t2: check(client !== null && model !== null, `client ${client ? client.name : "none"}, model ${model ?? "none"}, progress_token ${JSON.stringify([...new Set(tokens)])}`),
    t3: check(new RegExp(`\\b${word}\\b`, "i").test(run.stdout), `word ${word}`),
    t4: check(stepped, `${sessions.length} session logs, a step and an end: ${stepped}`),
    t5: check(written.length > 0 && continued, `${exports.length} export lines, continued ${continued}, files ${written.join(", ") || "none"}`),
  };
}

/** One client: register, run, (Antigravity: global fallback when no tool call came), judge; always restore. */
async function probeClient(id: ClientId): Promise<ClientResult> {
  const exe = findClient(id);
  if (exe === null) return notRun(id, "not installed");
  const runDir = path.join(RUNS, id);
  restoreLeftovers(runDir);
  rmSync(runDir, { recursive: true, force: true });
  mkdirSync(runDir, { recursive: true });
  const h = await startHarness({ waitMs: 15_000 });
  const word = WORDS[randomInt(WORDS.length)] as string;
  h.lr.previewWord = word;
  h.lr.files.delayMs = EXPORT_DELAY_MS;
  let reg: Registration | null = null;
  try {
    reg = register(id, h.entry, runDir);
    if (reg?.method === "refused") return notRun(id, `config has mcp_servers (${reg.file}), left as it is`);
    const text = prompt(h.outDir);
    let run = await runClient(launchFor(id, { exe, prompt: text, entry: h.entry, runDir }));
    if (id === "antigravity" && toolLines(h.logDir).length === 0) {
      if (reg) restore(reg);
      reg = register(id, h.entry, runDir, { global: true });
      run = await runClient(launchFor(id, { exe, prompt: text, entry: h.entry, runDir }));
    }
    writeFileSync(path.join(runDir, "stdout.txt"), run.stdout);
    writeFileSync(path.join(runDir, "stderr.txt"), run.stderr);
    return { ...judge(id, run, h, word, reg?.method ?? "per-run config"), exe };
  } finally {
    if (reg) restore(reg);
    await h.close();
  }
}

describe("client probe", () => {
  afterAll(() => writeReport(report));

  it("self-check (a): the printed word changes the preview", async () => {
    const a = await wordSelfCheck("PELICAN");
    report.self_checks["a_word"] = a;
    expect(a.ok, JSON.stringify(a)).toBe(true);
  });

  it("self-check (b): the built engine starts with the harness env and lists the tools", async () => {
    const h = await startHarness();
    try {
      const b = await engineSelfCheck(h);
      report.self_checks["b_engine"] = b;
      expect(b.ok, JSON.stringify(b)).toBe(true);
    } finally {
      await h.close();
    }
  });

  for (const id of CLIENT_IDS) {
    it(`client ${id}`, async () => {
      if (!selected.includes(id)) return void report.clients.push(notRun(id, `not selected (LRC_AVG_PROBE_CLIENTS=${pick})`));
      try {
        report.clients.push(await probeClient(id));
      } catch (err) {
        // Recorded as a NO on every row, with the reason; the other clients still run.
        const no: Check = { yes: false, detail: `probe error: ${err instanceof Error ? err.message : String(err)}` };
        report.clients.push({ ...notRun(id, no.detail), status: "run", model_requested: MODELS[id] ?? null, t1: no, t2: no, t3: no, t4: no, t5: no });
      }
    });
  }
});
