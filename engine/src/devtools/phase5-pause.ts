// The Plug-in Manager visit during an open session (PHASE5_PLAN row 7, "From row 3": "add a Plug-in
// Manager visit during an open session"; "From row 5": the 60 s allowance for a long pause is
// [unverified] in Lightroom). Plug-in Manager paused the plugin for 11.5-14.5 s on 2026-09-29, and
// for ~3 s in row 5's check [handle: vault PHASE5_PLAN.md row 3 "Probe done", row 5 "Plug-in Manager"].
// Jim opens Plug-in Manager, sets Mode to "Approve each pass" (session B's page change), counts to
// 20 and clicks Done. The check pings the plugin; at the first unanswered ping it sends Claude's next
// pass at once, and keeps pinging until the plugin answers again. It records how long the plugin was
// silent, whether the bridge dropped, and whether the pass finished. A silence over the heartbeat's
// 6 s exercises the session's 60 s allowance (engine\src\mcp\bridge-gate.ts SESSION_SILENCE_MS).

import { errorBody } from "./phase4-config.js";
import { HEARTBEAT_LIMIT_MS, PING_TIMEOUT_MS, STEPS, clickWait, sleep, type Json, type Phase5Deps, type Run } from "./phase5-config.js";
import { ensurePage, pageSteps } from "./phase5-page.js";
import { sync } from "./phase5-readback.js";

const ping = (deps: Pick<Phase5Deps, "client">): Promise<unknown> => deps.client.request("ping", { nonce: "p5check" }, { timeoutMs: PING_TIMEOUT_MS });

/** When a ping first went unanswered (when it was sent), or null when the plugin answered throughout. */
async function untilSilent(deps: Phase5Deps): Promise<number | null> {
  const end = Date.now() + clickWait(deps);
  while (Date.now() < end) {
    const sent = Date.now();
    try {
      await ping(deps);
      await sleep(Math.min(300, deps.pollMs ?? 300));
    } catch {
      return sent;
    }
  }
  return null;
}

/** When the plugin answered a ping again, or null. */
async function untilAnswers(deps: Phase5Deps): Promise<number | null> {
  const end = Date.now() + clickWait(deps);
  while (Date.now() < end) {
    try {
      await ping(deps);
      return Date.now();
    } catch {
      await sleep(Math.min(300, deps.pollMs ?? 300));
    }
  }
  return null;
}

export type PauseOutcome = Json & { ok: boolean; seen: boolean; page_ok: boolean };

/** The visit; `sid` is the open session, and its pass 2 is the one sent into the silence. */
export async function pauseVisit(deps: Phase5Deps, run: Run, sid: string): Promise<PauseOutcome> {
  const { say } = deps;
  say("");
  say("  Now a visit to Plug-in Manager while the session is open:");
  for (const line of pageSteps("approve_each_pass").slice(0, 3)) say(line);
  say("  4. Count slowly to 20, then click Done.");
  say("  (The check sends Claude's next pass while Lightroom does not answer, and watches the session ride it out.)");
  await sync(deps, run);
  const drops = deps.client.stats.drops;
  const silentFrom = await untilSilent(deps);
  const out: PauseOutcome = { ok: false, seen: silentFrom !== null, page_ok: false };
  if (silentFrom === null) {
    out["note"] = `the plugin answered every ping for ${Math.round(clickWait(deps) / 1000)} s: no pause was seen`;
    say("  Lightroom never stopped answering, so the pause could not be tested.");
  } else {
    const sent = Date.now();
    const [stepped, resumed] = await Promise.all([
      deps.tools.step({ session_id: sid, settings: STEPS[1].settings, rationale: STEPS[1].rationale, return_image: "none" }).then(
        (r) => ({ ok: true as const, pass: r.json["pass"], ms: Date.now() - sent }),
        (err: unknown) => ({ ok: false as const, error: errorBody(err), ms: Date.now() - sent }),
      ),
      untilAnswers(deps),
    ]);
    const silence = resumed === null ? null : resumed - silentFrom;
    const dropped = deps.client.stats.drops - drops;
    Object.assign(out, {
      silent_from: new Date(silentFrom).toISOString(),
      answered_again: resumed === null ? null : new Date(resumed).toISOString(),
      silence_ms: silence,
      longer_than_heartbeat: silence !== null && silence > HEARTBEAT_LIMIT_MS,
      drops: dropped,
      last_drop_reason: dropped > 0 ? deps.client.stats.last_drop_reason : null,
      pass_2: stepped,
    });
    say(`  Lightroom was silent about ${silence === null ? "?" : (silence / 1000).toFixed(1)} s; the pass sent meanwhile ${stepped.ok ? `finished after ${(stepped.ms / 1000).toFixed(1)} s` : `FAILED (${String(stepped.error["code"])})`}; bridge drops: ${dropped}.`);
    out.ok = stepped.ok && dropped === 0 && resumed !== null;
  }
  if ((await deps.prompt("  5. When you have clicked Done, press Enter here.")) !== null) {
    out.page_ok = await ensurePage(deps, run, "page_after_visit", "approve_each_pass", true);
  }
  await sync(deps, run); // pass 2 was the check's own write
  if (!out.ok) run.fail(`the session did not ride out the Plug-in Manager visit (details in session_a.pause)`);
  return out;
}
