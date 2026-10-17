// T6 and T7 of the clients check (issue #155 R6), per CLI client:
//   T6, "Approve on the Deck reaches the client": the settings page's Mode is set to "Approve each pass"
//       (Jim, in Plug-in Manager; read back with get_prefs, ported from hud\probe\check\ctx.ts ensureMode),
//       the client edits with two passes, Jim clicks Approve on the Deck, and the session log must show a
//       pass approved on the Deck ("hud") and a pass after it. The Mode goes back to Autonomous after the
//       last client (clients-check-cli.ts).
//   T7, "the harness ends the client mid-edit, then the next session lists the edit as left open and
//       reverts it": the client edits with six passes; once the run's tool log shows a successful
//       lr_begin_session and one lr_step (finished calls only: a pending line has no `ok`), the check ends
//       the client process only, never its engine nor the Deck. The engine then exits at stdin end and
//       leaves its session open [handle: engine\src\session\left-open.ts header]. A second run lists
//       `left_open` and reverts it; the first session's log must end with ended_by "recovery", outcome
//       "revert", and Jim says the photo looks as before.

import { execFileSync } from "node:child_process";
import { z } from "zod";
import { approvedOnDeck, begunAndStepped, recovered } from "./clients-judge.js";
import { MODEL_LINE, NO_QUESTIONS, RUN_TIMEOUT_MS, factsOf, holdBack, putBack, readToolLog, runClient, sayRun, yes, type ClientsDeps, type Installed, type Run, type Started } from "./clients-run.js";
import { rowOf, testOf } from "./clients-state.js";
import { settingsOf } from "./phase4-config.js";
import { waitFor } from "./phase5-config.js";
import { differingSettings, type CanonicalSettings } from "../params/index.js";

const BEGIN = 'Use the lrc-avg MCP tools to edit the photo selected in Lightroom. Call lr_begin_session with intent_id "neutral_technical_correction". ' + MODEL_LINE;
export const APPROVE_PROMPT =
  `${BEGIN} Make two passes with lr_step. Each pass waits for the user's approval: when lr_step says it is waiting, call it again as it says ` +
  `until the user approves on the Deck. Then call lr_end_session with outcome "accept". ${NO_QUESTIONS}`;
export const LONG_PROMPT = `${BEGIN} Make six small passes with lr_step, one after another, then call lr_end_session with outcome "accept". ${NO_QUESTIONS}`;
export const RECOVER_PROMPT =
  'Use the lrc-avg MCP tools. Call lr_get_active_photo_context. Its "left_open" lists an edit that an engine which stopped left open: ' +
  `end that session with lr_end_session, its session_id, outcome "revert". ${NO_QUESTIONS} Finally, reply with the session id you reverted.`;

export const PLUGIN_MANAGER = "In Lightroom: File > Plug-in Manager. In the list on the left, click LrC-AVG. In the Sessions box, set Mode to";
export type Mode = "autonomous" | "approve_each_pass";

/**
 * Waits until the settings page's Mode is `want`, asking Jim to set it, three times at most (ctx.ts
 * ensureMode). Needs the bridge. False when input ended or the Mode stayed wrong.
 */
export async function ensureMode(deps: ClientsDeps, run: Run, want: Mode): Promise<boolean> {
  const label = want === "autonomous" ? "Autonomous" : "Approve each pass";
  if (want === "approve_each_pass" && !run.state.mode_changed) {
    run.state.mode_changed = true; // saved first: a stopped run sets it back
    run.save();
  }
  for (let round = 0; round <= 3; round++) {
    const prefs = (await deps.client.request("get_prefs", {}, { timeoutMs: 30_000 })) as Record<string, unknown>;
    if (prefs["mode"] === want) {
      if (want === "autonomous" && run.state.mode_changed) {
        run.state.mode_changed = false;
        run.save();
      }
      return true;
    }
    if (round < 3 && (await deps.prompt(`  ${PLUGIN_MANAGER} "${label}", then click Done. Then press Enter here.`)) === null) return false;
  }
  run.fail(`the settings page's Mode is still not "${label}"`);
  return false;
}

/** T6 for one client; the Mode is "Approve each pass" already. */
export async function t6(deps: ClientsDeps, run: Run, c: Installed): Promise<void> {
  deps.say("");
  deps.say(`${c.name}: T6, Approve on the Deck. ${c.name} starts by itself; when the Deck says "Your turn: approve pass ...", click Approve on the Deck.`);
  const held = await holdBack(deps, run);
  await deps.gate.release();
  const r = await runClient(deps, run, c, APPROVE_PROMPT, "t6");
  sayRun(deps, c, r);
  const differing = r.back ? await putBack(deps, run, held) : ["the bridge"];
  const ok = approvedOnDeck(r.judged, r.facts);
  rowOf(run.state, c.id).T6 = testOf(ok, { exit: r.exit, timed_out: r.timed_out, error: r.error, judged: r.judged, facts: r.facts, put_back_differing: differing });
  run.save();
  deps.say(`  ${c.name}: T6 ${yes(ok)} (${r.facts.approvals_by_hud} pass(es) approved on the Deck, ${r.judged.passes} pass(es)).`);
}

const childSchema = z.object({ ProcessId: z.number(), Name: z.string(), CommandLine: z.string().nullable().optional() });

/** The processes whose parent is `pid` (Get-CimInstance Win32_Process). */
function childrenOf(pid: number): Array<z.infer<typeof childSchema>> {
  const ps = `Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}" | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress`;
  const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8", timeout: 30_000 }).trim();
  if (!out) return [];
  const parsed: unknown = JSON.parse(out);
  return z.array(childSchema).parse(Array.isArray(parsed) ? parsed : [parsed]);
}

/**
 * Ends the client process only: its own pid, or, when it was started through a shell (hermes.cmd),
 * cmd.exe's child that is not the engine (node.exe running main.js) nor the Deck. process.kill ends a
 * process at once on Windows [unverified: Node documents a forceful kill on Windows for subprocess.kill,
 * https://nodejs.org/api/child_process.html#subprocesskillsignal; T7 prints whether the client ended]. The pids ended.
 */
export function killClient(s: Started): number[] {
  const pid = s.child.pid;
  if (pid === undefined) return [];
  const targets = s.shell
    ? childrenOf(pid).filter((p) => !(p.Name.toLowerCase() === "node.exe" && /main\.js/i.test(p.CommandLine ?? "")) && p.Name !== "LrC-AVG Deck.exe").map((p) => p.ProcessId)
    : [pid];
  for (const t of targets) process.kill(t);
  return targets;
}

/** T7 for one client; false when input ended (nothing recorded). */
export async function t7(deps: ClientsDeps, run: Run, c: Installed): Promise<boolean> {
  deps.say("");
  deps.say(`${c.name}: T7, an edit left open. The check ends ${c.name} after its first pass, then starts it again to revert that edit. Nothing to click.`);
  const held = await holdBack(deps, run);
  await deps.gate.release();
  let killed: number[] = [];
  const first = await runClient(deps, run, c, LONG_PROMPT, "t7-ended", async (s, since) => {
    const exited = (): boolean => s.child.exitCode !== null || s.child.signalCode !== null;
    const hit = await waitFor(() => exited() || begunAndStepped(readToolLog(run.state.log_dir, since), since), RUN_TIMEOUT_MS - 60_000, 1000);
    if (hit && !exited()) killed = killClient(s);
  });
  sayRun(deps, c, first);
  deps.say(`  The check ended ${c.name}: ${killed.length > 0 ? `YES (pid ${killed.join(", ")})` : "NO"}.`);
  if (!first.back) return record(deps, run, c, false, { first, killed, error: "the bridge did not come back" }, null);
  await deps.gate.release();
  const second = await runClient(deps, run, c, RECOVER_PROMPT, "t7-recover");
  sayRun(deps, c, second);
  const firstFacts = factsOf(first.judged.log_path); // read again: the recovery rewrote it
  const now = second.back ? differingSettings((await settingsOf(deps, held.uuid)).settings, held.start as CanonicalSettings) : null;
  const answer = await deps.ask(`T7: Does ${held.label} in Lightroom look as it did before ${c.name} began (its edit reverted)?`);
  if (answer === "no answer") {
    if (second.back) await putBack(deps, run, held);
    return false;
  }
  const ok = killed.length > 0 && recovered(firstFacts) && answer === "y";
  return record(deps, run, c, ok, { first, second, killed, first_session: firstFacts, differing_after_revert: now, answer }, second.back ? held : null);
}

async function record(deps: ClientsDeps, run: Run, c: Installed, ok: boolean, summary: Record<string, unknown>, putBackFrom: Parameters<typeof putBack>[2] | null): Promise<boolean> {
  const differing = putBackFrom ? await putBack(deps, run, putBackFrom) : ["the bridge"];
  rowOf(run.state, c.id).T7 = testOf(ok, { ...summary, put_back_differing: differing });
  run.save();
  deps.say(`  ${c.name}: T7 ${yes(ok)}.`);
  return true;
}
