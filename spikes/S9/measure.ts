// Spike S9 (Phase 7 row 1): the one command Jim runs, `node spikes\S9\measure.ts`, with Lightroom
// open in Develop and Claude Desktop open. It starts the stub engine (stub-engine.ts), which starts the
// HUD (tauri\), measures gates S9-1 to S9-12 (spec D2 table) with koffi (win32.ts), asks Jim y/n here,
// and saves everything to %TEMP%\LrC-AVG\S9\s9_<run>.json, with the HUD's own logs beside it.
// It never talks to Lightroom's plugin or bridge, and writes nothing to the catalog.
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { clientAreaAnimation, dpi, fineTimers, foreground, mainWindow, pidOf, pidsByExe, rect, title, tree } from "./win32.ts";
import { HUD_EXE, alive, beep, closePrompts, enter, hudPids, here, killTree, pollUntil, saver, say, startStub, type Results, type Stub } from "./harness.ts";
import { coldStarts, idle, pulsing, updates, warmShows, type Ctx } from "./auto.ts";
import { exitsWithLightroom, focusChecks, followChecks, responsiveness, survives, topmostChecks } from "./jim.ts";
import { summarize } from "./summary.ts";

const r: Results = { run_id: new Date().toISOString().replace(/[:.]/g, "-"), started: new Date().toISOString(), errors: [] };
const save = saver(r);
let stub: Stub | null = null;

async function findWindow(exe: string, start: string): Promise<{ pid: number; hwnd: number } | null> {
  for (let tries = 0; tries < 3; tries++) {
    for (const pid of pidsByExe(exe)) {
      const hwnd = mainWindow(pid);
      if (hwnd) return { pid, hwnd };
    }
    await enter(start);
  }
  return null;
}

async function step(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    r.errors.push(`${name}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    save();
  }
}

function sizes(): void {
  const nsis = join(here, "tauri", "src-tauri", "target", "release", "bundle", "nsis");
  const setup = existsSync(nsis) ? readdirSync(nsis).find((f) => f.endsWith("-setup.exe")) : undefined;
  r.s9_12 = {
    exe_bytes: statSync(HUD_EXE).size,
    setup_file: setup ?? null,
    setup_bytes: setup ? statSync(join(nsis, setup)).size : null,
    note: "WebView2 is the system's runtime and is not counted (spec D2).",
  };
}

async function cleanup(): Promise<void> {
  if (stub && stub.child.exitCode === null) stub.child.kill();
  for (const pid of hudPids()) await killTree(tree(pid));
  const endpoint = join(homedir(), ".lrc-avg", "hud_endpoint.json");
  try {
    const pid = (JSON.parse(readFileSync(endpoint, "utf8")) as { pid?: number }).pid;
    if (typeof pid === "number" && !alive(pid)) unlinkSync(endpoint); // a stub this run killed (S9-9)
  } catch {
    // no file
  }
  fineTimers(false);
}

async function main(): Promise<void> {
  say("LrC-AVG spike S9: the Tauri HUD bar. It changes nothing in Lightroom.");
  if (!existsSync(HUD_EXE)) {
    say(`FAILED: the HUD is not built (${HUD_EXE}). Tell Claude Code.`);
    return;
  }
  for (const pid of hudPids()) await killTree(tree(pid)); // a HUD left over from an earlier run
  const lrExe = process.env.LRC_AVG_S9_LR_EXE ?? "lightroom.exe"; // dev override for dry runs, as in win.rs
  const lr = await findWindow(lrExe, "Lightroom Classic is not open. Start it, open a photo in Develop (press D), then come back here.");
  const claude = await findWindow("claude.exe", "Claude Desktop is not open. Start it, then come back here.");
  if (!lr || !claude) {
    say("FAILED: Lightroom Classic and Claude Desktop must both be open. Nothing was measured.");
    return;
  }
  r.lightroom = { pid: lr.pid, title: title(lr.hwnd), rect: rect(lr.hwnd), dpi: dpi(lr.hwnd), exe: lrExe };
  r.claude_desktop = { pid: claude.pid, title: title(claude.hwnd) };
  r.windows_animation_effects = clientAreaAnimation();
  fineTimers(true);
  save();

  await enter("Part 1 is hands-off and takes about 4 minutes. After you press Enter, click once on the photo in Lightroom within 5 seconds,\nthen leave the mouse and keyboard alone until this window beeps. A dark bar appears and disappears at the bottom of Lightroom many times: that is the test.");
  r.lightroom_in_front_at_start = (await pollUntil(() => pidOf(foreground()) === lr.pid, 15_000, 20)) !== null;
  stub = await startStub();
  const ctx: Ctx = { stub, r, save, lr, hud: { pid: 0, hwnd: 0 } };
  await step("S9-1", () => coldStarts(ctx));
  if (!ctx.hud.hwnd) throw new Error("no HUD window after S9-1");
  await step("S9-2", () => warmShows(ctx));
  await step("S9-3", () => updates(ctx));
  await step("S9-4/5 hidden", () => idle(ctx));
  await step("S9-5 visible", () => pulsing(ctx));
  r.reduced_motion = { windows_animation_effects: r.windows_animation_effects, webview_prefers_reduced_motion: stub.events.find((e) => e.ev === "hello")?.reduced_motion ?? null };
  beep();
  say("\nPart 1 is done. Part 2 has six short steps; each one tells you what to do.");
  await step("S9-6", () => focusChecks(ctx));
  await step("S9-7", () => topmostChecks(ctx));
  await step("S9-8", () => followChecks(ctx));
  await step("S9-11", () => responsiveness(ctx));
  await step("S9-9", () => survives(ctx));
  await step("S9-10", () => exitsWithLightroom(ctx));
}

process.on("SIGINT", () => void cleanup().then(() => process.exit(130)));
try {
  await main();
} catch (e) {
  r.errors.push(`main: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
} finally {
  if (existsSync(HUD_EXE)) sizes();
  r.stub_events = (stub as Stub | null)?.events ?? []; // assigned inside main()
  r.finished = new Date().toISOString();
  const { gates, headline } = summarize(r);
  r.summary = { headline, gates };
  const file = save();
  await cleanup();
  closePrompts();
  say(`\n${headline}`);
  for (const g of gates) say(`  ${g.suggested.toUpperCase().padEnd(8)} ${g.gate}: ${JSON.stringify(g.value)}`);
  say(r.errors.length ? `\nERRORS: ${r.errors.length} (in the results file)` : "\nNo errors.");
  say(`Results: ${file}\nTell Claude Code: "S9 done."`);
}
