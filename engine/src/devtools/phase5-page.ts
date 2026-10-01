// The settings page in the Phase 5 check (PHASE5_PLAN row 7: "a setting changed on the page reaches
// the engine"). The check reads the page as the engine does (get_prefs through settings\PageSettings)
// and, when it is not as a part needs it, gives Jim the steps to set it and reads again:
//   - at the start: Mode "Autonomous" and 4 passes, the defaults [handle: engine\src\settings\page.ts
//     PAGE_SPECS], so session A runs autonomous and the chats hold to AC-1's "≤ 4 passes";
//   - during session A, Jim sets Mode to "Approve each pass" (phase5-pause.ts); session B's begin
//     must then report the mode as the page's (phase5-approve.ts);
//   - before the six chats, Mode back to "Autonomous".
// The page's labels are plugin\LrC-AVG.lrplugin\PluginInfoProvider.lua's (the "Sessions" box, "Mode:",
// "Max passes per photo"), the plugin's name Info.lua's LrPluginName.

import type { PageValues } from "../settings/index.js";
import { ROUNDS, type Json, type Phase5Deps, type Run } from "./phase5-config.js";

export type Mode = PageValues["mode"];
export const MODE_TITLE: Record<Mode, string> = { autonomous: "Autonomous", approve_each_pass: "Approve each pass" };
/** AC-1: "≤ 4 passes" (PRD section 10); the page's default. */
export const PASSES = 4;

/** Jim's steps to set the page's Mode (and the passes back to 4), ending with Enter in this window. */
export function pageSteps(mode: Mode): string[] {
  return [
    "  1. In Lightroom: File > Plug-in Manager.",
    '  2. In the list on the left, click "LrC-AVG (Autonomous Vision Gateway)".',
    `  3. In the "Sessions" box on the right, set Mode to "${MODE_TITLE[mode]}", and "Max passes per photo" to ${PASSES} if it is not.`,
    "  4. Click Done.",
  ];
}

/** The page as get_prefs gives it now: the mode and passes, or why it could not be read. */
async function readNow(deps: Pick<Phase5Deps, "settings">): Promise<{ read: boolean; mode: Mode | null; max_passes: number | null; note: string | null; problems: string[] }> {
  const r = await deps.settings.read();
  return { read: r.read, mode: r.values.mode ?? null, max_passes: r.values.max_passes ?? null, note: r.note, problems: r.problems };
}

/**
 * Make sure the page holds Mode `mode` and 4 passes, asking Jim to set it at most ROUNDS times.
 * `asked`: Jim has just been told to set it (the first read counts as his answer). Recorded under
 * `results[key]`; true once the page reads as wanted.
 */
export async function ensurePage(deps: Pick<Phase5Deps, "settings" | "say" | "prompt">, run: Run, key: string, mode: Mode, asked = false): Promise<boolean> {
  const reads: Json[] = [];
  run.results[key] = { want: { mode, max_passes: PASSES }, reads };
  for (let round = 0; round <= ROUNDS; round++) {
    const now = await readNow(deps);
    reads.push({ at: new Date().toISOString(), ...now });
    if (now.read && now.mode === mode && now.max_passes === PASSES) {
      if (round > 0 || asked) deps.say(`  The settings page now reads Mode "${MODE_TITLE[mode]}", ${PASSES} passes.`);
      return true;
    }
    if (round === ROUNDS) break;
    const seen = now.read ? `Mode "${now.mode ? MODE_TITLE[now.mode] : "?"}", ${String(now.max_passes ?? "?")} passes` : `not readable (${now.note ?? "no answer"})`;
    deps.say(`  The settings page reads ${seen}; this part needs Mode "${MODE_TITLE[mode]}" and ${PASSES} passes.`);
    for (const line of pageSteps(mode)) deps.say(line);
    if ((await deps.prompt("  5. Press Enter here.")) === null) break;
  }
  run.fail(`the settings page was not set to Mode "${MODE_TITLE[mode]}" and ${PASSES} passes (details in ${key})`);
  return false;
}
