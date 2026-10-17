// The pure parts of `npm run sandbox:check` (sandbox-cli.ts runs them): the .wsb text, the guest's
// results file and the verdict. The guest script itself is sandbox-guest.ps1 (PowerShell, no Python).
// Windows Sandbox facts used here [upstream claim: Microsoft's .wsb schema as remembered, learn.microsoft.com
// "Windows Sandbox configuration"; not fetched in this session; the first run is the observation]:
// <Networking>Disable, <MappedFolders> with <ReadOnly>, <LogonCommand><Command>.

import { z } from "zod";

/** Where the two host folders appear inside the Sandbox. */
export const SANDBOX_RELEASE = "C:\\Release";
export const SANDBOX_RESULTS = "C:\\Results";

/** Fewer checks than this cannot be a finished guest run (sandbox-guest.ps1 records 18). */
export const MIN_CHECKS = 12;

const xml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The .wsb: release\ read-only, the results folder writable, no network, the guest script at logon. */
export function wsbText(releaseDir: string, resultsDir: string, version: string, nodeVersion: string): string {
  const folder = (host: string, guest: string, readOnly: boolean): string =>
    `    <MappedFolder>\n      <HostFolder>${xml(host)}</HostFolder>\n      <SandboxFolder>${xml(guest)}</SandboxFolder>\n      <ReadOnly>${readOnly}</ReadOnly>\n    </MappedFolder>\n`;
  const command = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${SANDBOX_RESULTS}\\guest.ps1 -Version ${version} -NodeVersion ${nodeVersion}`;
  return [
    "<Configuration>",
    "  <VGpu>Disable</VGpu>",
    "  <Networking>Disable</Networking>",
    "  <MappedFolders>",
    folder(releaseDir, SANDBOX_RELEASE, true) + folder(resultsDir, SANDBOX_RESULTS, false) + "  </MappedFolders>",
    "  <LogonCommand>",
    `    <Command>${xml(command)}</Command>`,
    "  </LogonCommand>",
    "</Configuration>",
    "",
  ].join("\n");
}

export const guestResultsSchema = z.object({
  finished: z.boolean(),
  version: z.string(),
  powershell: z.string().optional(),
  os: z.string().optional(),
  checks: z.array(z.object({ check: z.string(), ok: z.boolean(), detail: z.string().nullable().transform((d) => d ?? "") })),
  facts: z.record(z.string(), z.unknown()).optional(),
});
export type GuestResults = z.infer<typeof guestResultsSchema>;

/** The guest's results.json; Windows PowerShell 5.1 may write a BOM, which is dropped. */
export function parseGuestResults(text: string): GuestResults {
  return guestResultsSchema.parse(JSON.parse(text.replace(/^\uFEFF/, "")));
}

export type Verdict = { pass: boolean; lines: string[] };

/** PASS only when the guest finished, ran at least MIN_CHECKS checks, and every one passed. */
export function judge(r: GuestResults, expectVersion: string): Verdict {
  const lines = r.checks.map((c) => `[${c.ok ? "ok" : "FAIL"}] ${c.check}: ${c.detail}`);
  const problems: string[] = [];
  if (!r.finished) problems.push("the guest did not finish");
  if (r.version !== expectVersion) problems.push(`the guest tested ${r.version}, not ${expectVersion}`);
  if (r.checks.length < MIN_CHECKS) problems.push(`only ${r.checks.length} checks ran (at least ${MIN_CHECKS} expected)`);
  const failed = r.checks.filter((c) => !c.ok).length;
  if (failed > 0) problems.push(`${failed} check(s) failed`);
  return { pass: problems.length === 0, lines: [...lines, ...problems.map((p) => `[FAIL] ${p}`)] };
}

/** The last line of the guest's progress.txt, for a run that never finished. */
export function lastProgress(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  return lines.length > 0 ? (lines[lines.length - 1] as string) : "(the guest wrote no progress)";
}

/** What to do when Windows Sandbox is missing (admin PowerShell, then a restart); [unverified] until Jim runs it. */
export const ENABLE_SANDBOX = [
  "Windows Sandbox is not enabled on this PC (C:\\Windows\\System32\\WindowsSandbox.exe is missing).",
  "One step for Jim, once. It needs administrator rights and a restart:",
  "  1. Press the Windows key, type PowerShell, right-click Windows PowerShell, choose Run as administrator, click Yes.",
  "  2. In that window run:",
  "       Enable-WindowsOptionalFeature -Online -FeatureName Containers-DisposableClientVM -All",
  "  3. When it asks to restart the computer, type Y and press Enter.",
  '  4. After the restart tell Claude Code "sandbox enabled".',
  "[unverified] The feature name and the restart are Microsoft's documented route as remembered; they were not run on this PC.",
  "If step 2 says the feature does not exist, tell Claude Code: Windows Sandbox needs Windows 11 Pro, Enterprise or Education.",
].join("\n");
