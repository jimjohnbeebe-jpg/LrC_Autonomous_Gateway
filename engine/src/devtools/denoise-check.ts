// `npm run denoise:check` (issue #190): does lr_apply_denoise's plugin command (Denoise.lua) work in Lightroom?
// The pure parts: what each step expects, and the verdict. The CLI (denoise-check-cli.ts) drives Lightroom.
// Report: docs\reports\phase9\upstream-ports.md.

/** One apply_denoise answer, as the bridge returns it (protocol-results.ts). */
export type DenoiseAnswer = { uuid: string; status: string; reason?: string | undefined; previous_amount?: number | undefined; snapshot?: { id: string; name: string } | undefined; ms: number };
export type Step = { step: string; expect: string[]; answers: DenoiseAnswer[] };

/**
 * The develop settings' FilterList, read for the record: the live dump the key names come from (rule 03,
 * LR_SDK_NOTES). The name "FilterList" is in a recorded dump [handle: docs\reports\phase8\S10\census\
 * s10_PICT0019.DNG.json]; what Denoise adds to it is what this check records.
 */
export const FILTER_LIST = "FilterList";

/** Whether a step's answers are all among the statuses it expects. */
export const stepOk = (s: Step): boolean => s.answers.length > 0 && s.answers.every((a) => s.expect.includes(a.status));

/** The check's verdict: every step as expected, the selection and module put back, the snapshots undoing Denoise, and Jim's two "y". */
export function verdict(r: { steps: Step[]; selection_back: boolean; filters_back: boolean; preview_ok: boolean; answers: string[] }): { worked: boolean; lines: string[] } {
  const lines = r.steps.map((s) => `${stepOk(s) ? "YES" : "NO "} ${s.step}: ${s.answers.map((a) => `${a.status}${a.reason ? ` (${a.reason})` : ""}`).join(", ") || "no answer"} (expected ${s.expect.join(" or ")})`);
  lines.push(`${r.selection_back ? "YES" : "NO "} the selection is as it was`);
  lines.push(`${r.filters_back ? "YES" : "NO "} the snapshots put each photo's FilterList back as it was`);
  lines.push(`${r.preview_ok ? "YES" : "NO "} lr_get_preview by uuid rendered a photo that is not the active one`);
  for (const [i, a] of r.answers.entries()) lines.push(`${a === "y" ? "YES" : "NO "} Jim's answer ${i + 1}: ${a}`);
  const worked = r.steps.every(stepOk) && r.selection_back && r.filters_back && r.preview_ok && r.answers.length === 2 && r.answers.every((a) => a === "y");
  return { worked, lines };
}
