// `npm run develop:check` (issue #214): do the Develop parity tools work in Lightroom? The pure parts: what each step
// expects, and the verdict. The CLI (develop-check-cli.ts) drives Lightroom through the tools themselves.
// Report: docs\reports\phase11\DEVELOP-PARITY.md.

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
