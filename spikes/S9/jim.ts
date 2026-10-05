// Spike S9: the steps that need Jim (rule 04: y/n in this PowerShell window, his choice for S9
// [stated: Jim, 2026-10-04, "S9, powershell"]). Each step measures while he acts, then asks.
// Lightroom keys used below, on Windows: \ "View Before only" (spec 4.6 / D5), F "Cycle screen modes",
// Ctrl+Alt+F "Go to Normal screen mode" [handle: https://helpx.adobe.com/lightroom-classic/help/keyboard-shortcuts.html,
// read through Tavily 2026-10-04]. That each release of a slider is one History step, undone by one
// Ctrl+Z, is [inference]; S9-11 asks Jim to check the History panel.
import { deckRect, foreground, iconic, mainWindow, pidOf, processes, rect, startedAt, topmost, tree, visible, zOrder } from "./win32.ts";
import { alive, ask, beep, enter, enterLater, now, pollUntil, say, sleep } from "./harness.ts";
import type { Ctx } from "./auto.ts";

const lrFront = (ctx: Ctx): boolean => pidOf(foreground()) === ctx.lr.pid;

async function showWorking(ctx: Ctx): Promise<void> {
  ctx.stub.cmd({ cmd: "state", name: "W" });
  ctx.stub.cmd({ cmd: "spike", action: "show" });
  await pollUntil(() => visible(ctx.hud.hwnd), 2000, 5);
}

/** S9-6, Jim's half: `\` still reaches Lightroom right after a show, 3 of 3. */
export async function focusChecks(ctx: Ctx): Promise<void> {
  const rounds: Record<string, unknown>[] = [];
  for (let i = 1; i <= 3; i++) {
    await enter(`S9-6, check ${i} of 3. After you press Enter, click once on the photo in Lightroom within 5 seconds, then let go of the mouse.\nThe bar disappears, and a few seconds later it comes back and this window beeps. Then press \\ (backslash) once in Lightroom.`);
    ctx.stub.cmd({ cmd: "spike", action: "hide" });
    const front = (await pollUntil(() => lrFront(ctx), 10_000, 20)) !== null;
    await sleep(2000);
    const fgBefore = foreground();
    ctx.stub.cmd({ cmd: "state", name: "C" });
    const shown = (await pollUntil(() => visible(ctx.hud.hwnd), 3000, 2)) !== null;
    await sleep(300);
    const fgAfter = foreground();
    beep();
    const yes = await ask("Did Lightroom switch to the Before view when you pressed \\ ? (Press \\ again in Lightroom to switch back.)");
    rounds.push({ lightroom_in_front: front, shown, fg_unchanged: fgBefore === fgAfter, jim_backslash_reached_lightroom: yes });
    ctx.r.s9_6_jim = rounds;
    ctx.save();
  }
}

/** S9-7: topmost only while Lightroom or the HUD is in front, over 10 switches. */
export async function topmostChecks(ctx: Ctx): Promise<void> {
  await enter("S9-7. Put Claude Desktop where it covers the bottom part of Lightroom's window (both open, neither minimised).\nAfter you press Enter, click on Lightroom, then on Claude Desktop, then Lightroom again, and so on: 10 clicks in all, about 2 seconds apart.\nThis window beeps after the 10th switch.");
  ctx.lr.hwnd = mainWindow(ctx.lr.pid) || ctx.lr.hwnd;
  const hud = ctx.hud.hwnd;
  const exe = new Map<number, string>();
  const exeOf = (pid: number): string => {
    if (!exe.has(pid)) for (const [p, info] of processes()) exe.set(p, info.exe.toLowerCase());
    return exe.get(pid) ?? "";
  };
  const switches: Record<string, unknown>[] = [];
  // Only alternations count: Lightroom, Claude Desktop, Lightroom, ... A visit to any other window
  // (this one, the HUD) is ignored, so a return to the same app is not a switch.
  let last = "";
  const end = now() + 180_000;
  while (switches.length < 10 && now() < end) {
    await sleep(3);
    const fg = foreground();
    const pid = pidOf(fg);
    const kind = pid === ctx.lr.pid ? "lightroom" : exeOf(pid) === "claude.exe" ? "claude" : "other";
    if (kind === "other" || kind === last) continue;
    last = kind;
    const t0 = now();
    const correct = (): boolean => {
      const z = zOrder();
      const iHud = z.indexOf(hud);
      return kind === "lightroom" ? topmost(hud) && iHud < z.indexOf(ctx.lr.hwnd) : !topmost(hud) && z.indexOf(fg) < iHud;
    };
    const t = await pollUntil(correct, 1000, 2);
    switches.push({ to: kind, ms: t === null ? null : t - t0, correct: t !== null, hud_visible: visible(hud) });
  }
  beep();
  const overLightroom = await ask("While Lightroom was in front, was the bar always on top of Lightroom?");
  const underClaude = await ask("While Claude Desktop was in front, did it always cover the bar (the bar never on top of Claude Desktop)?");
  ctx.r.s9_7 = { switches, jim_over_lightroom: overLightroom, jim_under_claude: underClaude };
  ctx.save();
}

const same = (a: { left: number; top: number; right: number; bottom: number }, b: typeof a): boolean =>
  Math.abs(a.left - b.left) <= 1 && Math.abs(a.top - b.top) <= 1 && Math.abs(a.right - b.right) <= 1 && Math.abs(a.bottom - b.bottom) <= 1;

/** S9-8: follows Lightroom's window: each change, then 400 ms still, is one episode. */
export async function followChecks(ctx: Ctx): Promise<void> {
  await showWorking(ctx);
  say([
    "\nS9-8. Do these five things in Lightroom, a few seconds apart:",
    "  1. If Lightroom fills the screen, click its Restore button (the middle of the three buttons at the top right).",
    "  2. Drag Lightroom by its title bar to another place and let go. Do it twice.",
    "  3. Drag Lightroom's bottom-right corner to make it bigger or smaller and let go. Do it twice.",
    "  4. Click Lightroom's Minimise button (the left of the three), wait 3 seconds, then click Lightroom in the taskbar.",
    "  5. Click the photo, then press F, wait 3 seconds, and repeat until Lightroom is back in its normal window",
    "     (F cycles the screen modes; Ctrl+Alt+F goes back to Normal at any time).",
    "  Then put Lightroom back as it was at the start (maximise it if it was maximised).",
  ].join("\n"));
  let finishedAt = 0;
  void enterLater("When you have done all five, press Enter here.").then(() => (finishedAt = now()));
  const episodes: Record<string, unknown>[] = [];
  let lr = mainWindow(ctx.lr.pid) || ctx.lr.hwnd;
  const keyOf = (h: number): string => (iconic(h) ? "iconic" : JSON.stringify(rect(h)));
  let lastKey = keyOf(lr);
  let lastChange = 0;
  let lastFind = now();
  let inPlaceSince: number | null = null;
  let open = false;
  const close = (min: boolean, settled: boolean): void => {
    open = false;
    const ms = settled && inPlaceSince !== null ? inPlaceSince - lastChange : null;
    episodes.push({ kind: min ? "minimised" : "moved", settled, ms, lr_rect: min ? null : rect(lr), hud_rect: rect(ctx.hud.hwnd), expected: min ? null : deckRect(lr), hud_visible: visible(ctx.hud.hwnd) });
  };
  // After Enter, an episode still open gets up to 1.5 s to settle; one that does not is kept as unsettled
  // (ms null, so the gate fails) rather than dropped.
  while (!finishedAt || (open && now() - finishedAt < 1500)) {
    await sleep(5);
    const t = now();
    if (t - lastFind > 250) [lr, lastFind] = [mainWindow(ctx.lr.pid) || lr, t];
    const key = keyOf(lr);
    if (key !== lastKey) {
      [lastKey, lastChange, inPlaceSince, open] = [key, t, null, true];
      continue;
    }
    const min = key === "iconic";
    const hudVisible = visible(ctx.hud.hwnd);
    const inPlace = min ? !hudVisible : hudVisible && same(rect(ctx.hud.hwnd), deckRect(lr));
    inPlaceSince = inPlace ? (inPlaceSince ?? t) : null;
    if (open && t - lastChange > 400) close(min, true);
  }
  if (open) close(lastKey === "iconic", false);
  ctx.lr.hwnd = lr;
  const moved = await ask("Each time you moved or resized Lightroom, did the bar end up along Lightroom's bottom part, as wide as the window?");
  const minimised = await ask("While Lightroom was minimised, was the bar gone, and did it come back when you brought Lightroom back?");
  const modes = await ask("In each screen mode (F), did the bar stay along the bottom part of Lightroom?");
  const filmstrip = await ask("(Not a gate, for the layout work) Did the bar sit over the top edge of the filmstrip, leaving the thumbnails visible?");
  ctx.r.s9_8 = { episodes, jim_moved: moved, jim_minimised: minimised, jim_screen_modes: modes, jim_over_filmstrip_top: filmstrip };
  ctx.save();
}

/** S9-11: Lightroom stays responsive with the HUD visible and pulsing. */
export async function responsiveness(ctx: Ctx): Promise<void> {
  await showWorking(ctx);
  await enter("S9-11. The bar shows Claude working, with its ring pulsing. After you press Enter, drag the Exposure slider in Develop's Basic panel slowly to the right and back, for about 5 seconds.\nThen press Ctrl+Z (Edit > Undo) once for each time you let go of the slider, and check in the History panel that the newest step is the one from before.");
  const smooth = await ask("Did the slider move as smoothly as it usually does (no lag you could notice)?");
  ctx.r.s9_11 = { jim_no_difference: smooth, hud_visible: visible(ctx.hud.hwnd), lightroom_in_front: lrFront(ctx) };
  ctx.save();
}

/** S9-9: the HUD survives its launcher's exit and shows the not-connected state with the undo line. */
export async function survives(ctx: Ctx): Promise<void> {
  await showWorking(ctx);
  await enter("S9-9. Click on Lightroom's photo so the bar is in view, then come back here.\nAfter you press Enter, this window stops its stand-in engine, as if Claude Desktop had quit. Then look at the bar.");
  ctx.stub.child.kill();
  await sleep(5000);
  const running = alive(ctx.hud.pid);
  const shows = await ask("Does the bar say \"Claude is not connected. Your edit so far stays.\" followed by \"To undo it: Develop > Snapshots > AVG pre-session ...\"?");
  ctx.r.s9_9 = { hud_running_5s_after: running, hud_visible: visible(ctx.hud.hwnd), jim_not_connected_with_undo: shows };
  ctx.save();
}

/** S9-10: the HUD exits after Lightroom exits. */
export async function exitsWithLightroom(ctx: Ctx): Promise<void> {
  // Every process the HUD had at any point up to its exit, as pid + creation time: WebView2 may start or
  // replace a child while Jim is at the prompt, and Windows may give a dead child's pid to another
  // program, which must not count as a HUD process still running.
  const hudTree = new Map<number, number | null>();
  const collect = (): void => {
    if (alive(ctx.hud.pid)) for (const p of tree(ctx.hud.pid)) if (!hudTree.has(p)) hudTree.set(p, startedAt(p));
  };
  const running = (pid: number, at: number | null): boolean => at !== null && startedAt(pid) === at;
  collect();
  await enter("S9-10, the last step. After you press Enter, quit Lightroom: File > Exit. If Lightroom offers to back up the catalog, answer as you usually do.\nThis window waits up to 3 minutes for Lightroom to close.");
  collect();
  const lrGone = await pollUntil(() => (collect(), !alive(ctx.lr.pid)), 180_000, 50);
  const hostGone = lrGone ? await pollUntil(() => (collect(), !alive(ctx.hud.pid)), 30_000, 20) : null;
  const treeGone = lrGone ? await pollUntil(() => [...hudTree].every(([p, at]) => !running(p, at)), 30_000, 20) : null;
  ctx.r.s9_10 = {
    lightroom_exited: lrGone !== null,
    host_ms: lrGone && hostGone ? hostGone - lrGone : null,
    tree_ms: lrGone && treeGone ? treeGone - lrGone : null,
    tree: [...hudTree.keys()],
  };
  ctx.save();
}
