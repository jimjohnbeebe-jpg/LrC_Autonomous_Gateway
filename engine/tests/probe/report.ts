// The client probe's results: docs\reports\phase8.5\clients-probe.json, and the "Pre-run findings"
// section of clients-probe.md filled from it (rule 02 format; the report stays status: template until
// Jim reads it). Each line names its handle: the JSON path and the command that wrote it.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ClientId } from "../../src/devtools/clients-launch.js";

export const REPORT_JSON = fileURLToPath(new URL("../../../docs/reports/phase8.5/clients-probe.json", import.meta.url));
export const REPORT_MD = fileURLToPath(new URL("../../../docs/reports/phase8.5/clients-probe.md", import.meta.url));
const COMMAND = "npm run clients:probe";
const HANDLE = "docs\\reports\\phase8.5\\clients-probe.json";

/** yes: passed; no: failed; null: not run. */
export type Check = { yes: boolean | null; detail: string };
export type ClientResult = {
  client: ClientId;
  status: "run" | "not run";
  reason?: string;
  exe?: string;
  registration?: string;
  model_requested: string | null;
  model_reported: string | null;
  client_info: { name: string; version: string } | null;
  progress_token: boolean | null;
  exit_code?: number | null;
  duration_ms?: number;
  /** The end of the client's stdout, as evidence for T1 and T3. */
  excerpt?: string;
  t1: Check;
  t2: Check;
  t3: Check;
  t4: Check;
  t5: Check;
};
export type ProbeReport = {
  date: string;
  self_checks: Record<string, unknown>;
  clients: ClientResult[];
};

export const notRun = (client: ClientId, reason: string): ClientResult => {
  const no: Check = { yes: null, detail: "not run" };
  return { client, status: "not run", reason, model_requested: null, model_reported: null, client_info: null, progress_token: null, t1: no, t2: no, t3: no, t4: no, t5: no };
};

const cell = (c: Check): string => (c.yes === null ? "not run" : c.yes ? "YES" : `NO (${c.detail})`);
const esc = (s: string): string => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

/** The sharp SVG-text fact behind T3, from self-check (a). */
function wordLine(a: unknown): string[] {
  const w = a as { noise?: { mean: number }; printed?: { mean: number; min: number }; ok?: boolean } | undefined;
  if (!w?.noise || !w.printed) return [];
  return [
    `- sharp ${w.ok ? "draws" : "did NOT draw"} the SVG box and text on the preview: the box's mean grey ${w.printed.mean} against ${w.noise.mean} on plain noise, ` +
      `its darkest pixel ${w.printed.min} (the text) [handle: ${HANDLE} \`self_checks.a_word\`].`,
  ];
}

function findings(r: ProbeReport): string {
  const lines = [
    `Written by \`${COMMAND}\` on ${r.date}; every value below is in \`${HANDLE}\` (the path in brackets).`,
    "",
    `- Self-checks, no client [handle: ${HANDLE} \`self_checks\`]: ${esc(JSON.stringify(r.self_checks))}`,
    ...wordLine(r.self_checks["a_word"]),
    "",
    "| Client | Status | Model (asked / reported) | clientInfo | progressToken | T1 tools | T2 identity | T3 word | T4 session | T5 slow export |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...r.clients.map((c, i) =>
      `| ${c.client} [${HANDLE} \`clients[${i}]\`] | ${esc(c.status + (c.reason ? `: ${c.reason}` : ""))} | ${esc(`${c.status === "not run" ? "-" : (c.model_requested ?? "default")} / ${c.model_reported ?? "-"}`)} | ` +
        `${c.client_info ? esc(`${c.client_info.name} ${c.client_info.version}`) : "-"} | ${c.progress_token ?? "-"} | ${[c.t1, c.t2, c.t3, c.t4, c.t5].map((t) => esc(cell(t))).join(" | ")} |`,
    ),
  ];
  return lines.join("\n");
}

/** Write the JSON and put the findings into the report's "Pre-run findings" section. */
export function writeReport(r: ProbeReport): void {
  writeFileSync(REPORT_JSON, JSON.stringify(r, null, 2) + "\n");
  const md = readFileSync(REPORT_MD, "utf8");
  const start = md.indexOf("## Pre-run findings");
  const end = md.indexOf("\n## ", start + 1);
  if (start < 0 || end < 0) throw new Error(`${REPORT_MD} has no "## Pre-run findings" section followed by another`);
  const heading = md.slice(start, md.indexOf("\n", start));
  writeFileSync(REPORT_MD, `${md.slice(0, start)}${heading}\n\n${findings(r)}\n${md.slice(end)}`);
}
