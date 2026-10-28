// `npm run develop:check` (issue #214): do the Develop parity tools work in Lightroom? The pure parts: what each step
// expects, and the verdict. The CLI (develop-check-cli.ts) drives Lightroom through the tools themselves.
// Report: docs\reports\phase11\DEVELOP-PARITY.md. `step` serves develop-catalog:check too (develop-catalog-check-cli.ts).

import { describeError } from "./phase1-check.js";

/** One tool call of the check: the statuses its photos answered, and those that count as working. */
export type Step = { step: string; expect: string[]; statuses: string[]; error?: string };

/** The snapshot name prefixes the check and the tools it calls leave on a photo (tools-develop.ts, tools-snapshots.ts). */
export const CHECK_SNAPSHOTS = ["AVG develop-check start", "AVG pre-auto ", "AVG pre-reset ", "AVG pre-process-version ", "AVG pre-apply "];

export const stepOk = (s: Step): boolean => s.error === undefined && s.statuses.length > 0 && s.statuses.every((x) => s.expect.includes(x));

/** Statuses of a tool result's `photos` (tools-develop.ts), or of a one-photo result as "ok". */
export function statusesOf(json: Record<string, unknown>): string[] {
  const photos = json["photos"];
  const failed = Array.isArray(json["failed"]) ? (json["failed"] as unknown[]).map(() => "failed") : [];
  if (!Array.isArray(photos)) return ["ok", ...failed];
  return [...photos.map((p) => String((p as { status?: unknown }).status)), ...failed];
}

/** What a check's steps write into: its output, its result file's object (results under `results`) and its steps. */
export type StepLog = { say: (l: string) => void; r: Record<string, unknown>; steps: Step[] };

/** One tool call as a step of a check; its result is kept under its name. Returns the result's JSON, or null (develop:check, develop-catalog:check). */
export async function step(c: StepLog, name: string, expect: string[], call: () => Promise<{ json: Record<string, unknown> }>, statuses = statusesOf): Promise<Record<string, unknown> | null> {
  c.say(`${name} ...`);
  try {
    const { json } = await call();
    const s: Step = { step: name, expect, statuses: statuses(json) };
    c.steps.push(s);
    (c.r["results"] as Record<string, unknown>)[name] = json;
    c.say(`  ${s.statuses.join(", ")}`);
    return json;
  } catch (err) {
    c.steps.push({ step: name, expect, statuses: [], error: describeError(err) });
    c.say(`  failed: ${describeError(err)}`);
    return null;
  }
}

/** The verdict: every step as expected, the selection and the settings put back, the snapshots cleaned, and Jim's "y"s. */
export function verdict(r: { steps: Step[]; selection_back: boolean; settings_back: boolean; snapshots_back: boolean; answers: string[]; questions: number }): { worked: boolean; lines: string[] } {
  const lines = r.steps.map((s) => `${stepOk(s) ? "YES" : "NO "} ${s.step}: ${s.error ?? (s.statuses.join(", ") || "no answer")} (expected ${s.expect.join(" or ")})`);
  lines.push(`${r.selection_back ? "YES" : "NO "} the selection is as it was`);
  lines.push(`${r.settings_back ? "YES" : "NO "} both photos' Develop settings are back as they were`);
  lines.push(`${r.snapshots_back ? "YES" : "NO "} the check's snapshots are deleted again`);
  for (const [i, a] of r.answers.entries()) lines.push(`${a === "y" ? "YES" : "NO "} Jim's answer ${i + 1}: ${a}`);
  const worked = r.steps.every(stepOk) && r.selection_back && r.settings_back && r.snapshots_back && r.answers.length === r.questions && r.answers.every((a) => a === "y");
  return { worked, lines };
}
