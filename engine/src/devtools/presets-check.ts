// `npm run presets:check` (issue #215): do the Develop preset tools work in Lightroom? The pure parts: the two
// checkpoints the check makes and the diff expected between them, the Lightroom preset it applies, and the verdict.
// The CLI (presets-check-cli.ts) drives Lightroom. Report: docs\reports\phase11\PRESET-PARITY.md.

/** The checkpoints the check makes from canonical settings: their known diff is exposure and vibrance. */
export const CHECKPOINT_A = { exposure: 0.3, contrast: 10 };
export const CHECKPOINT_B = { exposure: 0.5, contrast: 10, vibrance: 15 };
export const EXPECTED_DIFF = ["exposure", "vibrance"];

export type Row = { step: string; ok: boolean; detail: string };
export type Answer = "y" | "n" | "no answer";
export type ListedPreset = { name: string; folder: string; scope: string; uuid: string; file?: string | undefined };

/**
 * The Lightroom preset the check applies: one with an AI mask when a name says so (an "Adaptive" sky preset), so the
 * AI recompute runs, else the first listed. Which presets carry AI masks is [unverified]: lr_get_preset says, in the run.
 */
export function pickLightroomPreset(list: readonly ListedPreset[]): ListedPreset | null {
  const lightroom = list.filter((p) => p.scope === "lightroom");
  return lightroom.find((p) => /adaptive/i.test(p.folder) && /sky/i.test(p.name)) ?? lightroom[0] ?? null;
}

/** User presets live in CameraRaw\Settings [handle: vault LR_SDK_NOTES "Recorded in Phase 4"], and imported ones in
 *  CameraRaw\ImportedSettings [handle: docs\reports\phase11\PRESET-PARITY.md run 1]; built-in ones elsewhere or with no file [inference]. */
export function countKinds(list: readonly ListedPreset[]): { lightroom: number; user: number; plugin: number } {
  return {
    lightroom: list.filter((p) => p.scope === "lightroom").length,
    user: list.filter((p) => p.scope === "lightroom" && /[\\/]CameraRaw[\\/](Imported)?Settings[\\/]/i.test(p.file ?? "")).length,
    plugin: list.filter((p) => p.scope === "plugin").length,
  };
}

/**
 * WORKED when every step did as expected, the photo is back, and Jim answered y to the two questions that are
 * pass/fail (the module and selection unchanged; the photo looks as before). The History name and the panel
 * visibility answers are findings, recorded either way.
 */
export function verdict(rows: readonly Row[], passFail: readonly Answer[], findings: Readonly<Record<string, Answer>>): { worked: boolean; lines: string[] } {
  const lines = rows.map((r) => `${r.ok ? "YES" : "NO "} ${r.step}: ${r.detail}`);
  for (const [i, a] of passFail.entries()) lines.push(`${a === "y" ? "YES" : "NO "} Jim's answer ${i + 1}: ${a}`);
  for (const [q, a] of Object.entries(findings)) lines.push(`    finding, ${q}: ${a}`);
  return { worked: rows.length > 0 && rows.every((r) => r.ok) && passFail.length > 0 && passFail.every((a) => a === "y"), lines };
}
