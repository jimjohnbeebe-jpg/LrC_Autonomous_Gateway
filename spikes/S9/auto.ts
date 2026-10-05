// Spike S9: the hands-off measurements, S9-1 to S9-5 and the programmatic half of S9-6 (spec D2 table).
// Every time is epoch ms from performance.timeOrigin + now() in this process, the stub and the HUD's UI;
// the HUD's own log (log.rs) uses the system clock in ms.
import { cpuMs, foreground, pidOf, privateBytes, processes, tree, visible } from "./win32.ts";
import { hudLog, killTree, now, pollUntil, sleep, type Ev, type Results, type Stub } from "./harness.ts";

export type Ctx = {
  stub: Stub;
  r: Results;
  save: () => string;
  lr: { pid: number; hwnd: number };
  hud: { pid: number; hwnd: number };
};

const lrFront = (ctx: Ctx): boolean => pidOf(foreground()) === ctx.lr.pid;
const num = (e: Ev | null, key: string): number | null => (e && typeof e[key] === "number" ? (e[key] as number) : null);

async function hide(ctx: Ctx): Promise<boolean> {
  ctx.stub.cmd({ cmd: "spike", action: "hide" });
  return (await pollUntil(() => !visible(ctx.hud.hwnd), 2000, 2)) !== null;
}

async function show(ctx: Ctx): Promise<boolean> {
  ctx.stub.cmd({ cmd: "spike", action: "show" });
  return (await pollUntil(() => visible(ctx.hud.hwnd), 2000, 2)) !== null;
}

/** S9-1: process spawn (stub) to first state painted and visible, 5 times. The last HUD is kept. */
export async function coldStarts(ctx: Ctx, n = 5): Promise<void> {
  const runs: Record<string, unknown>[] = [];
  for (let i = 0; i < n; i++) {
    const from = ctx.stub.events.length;
    ctx.stub.cmd({ cmd: "spawn" });
    const spawned = await ctx.stub.waitFor((e) => e.ev === "spawned", 5000, from);
    const pid = num(spawned, "pid") ?? 0;
    let hwnd = 0;
    await pollUntil(() => {
      hwnd = Number(hudLog(pid).find((e) => e.ev === "start")?.hwnd ?? 0);
      return hwnd !== 0;
    }, 15_000, 5);
    const tVisible = hwnd ? await pollUntil(() => visible(hwnd), 15_000, 1) : null;
    const paint = await ctx.stub.waitFor((e) => e.ev === "paint", 15_000, from);
    const hello = await ctx.stub.waitFor((e) => e.ev === "hello", 0, from);
    const tPaint = num(paint, "t_paint");
    const ms = spawned && tVisible && tPaint ? Math.max(tVisible, tPaint) - spawned.t : null;
    runs.push({ pid, hwnd, ms, t_spawn: spawned?.t ?? null, t_hello: hello?.t ?? null, t_visible: tVisible, t_paint: tPaint, lightroom_in_front: lrFront(ctx) });
    if (i < n - 1) await killTree(tree(pid));
    else ctx.hud = { pid, hwnd };
    await sleep(1000);
  }
  ctx.r.s9_1 = { runs, origin: ctx.stub.events.find((e) => e.ev === "hello")?.origin ?? null };
  ctx.save();
}

/** S9-2 and the programmatic half of S9-6: a turn state sent while hidden, 20 times. */
export async function warmShows(ctx: Ctx, n = 20): Promise<void> {
  const shows: Record<string, unknown>[] = [];
  for (let i = 0; i < n; i++) {
    const hidden = await hide(ctx);
    await sleep(300);
    const fgBefore = foreground();
    const from = ctx.stub.events.length;
    ctx.stub.cmd({ cmd: "state", name: i % 2 ? "V" : "C" });
    const sent = await ctx.stub.waitFor((e) => e.ev === "sent", 2000, from);
    const tVisible = await pollUntil(() => visible(ctx.hud.hwnd), 3000, 1);
    const paint = await ctx.stub.waitFor((e) => e.ev === "paint" && e.seq === sent?.seq, 3000, from);
    await sleep(200);
    const fgAfter = foreground();
    const tPaint = num(paint, "t_paint");
    const ms = sent && tVisible && tPaint ? Math.max(tVisible, tPaint) - sent.t : null;
    shows.push({ hidden_before: hidden, ms, t_sent: sent?.t ?? null, t_visible: tVisible, t_paint: tPaint, fg_before: fgBefore, fg_after: fgAfter, fg_unchanged: fgBefore === fgAfter, lightroom_in_front: pidOf(fgBefore) === ctx.lr.pid });
  }
  ctx.r.s9_2 = { shows };
  ctx.save();
}

/** S9-3: state update to paint while visible, 100 times, 150 ms apart. */
export async function updates(ctx: Ctx, n = 100): Promise<void> {
  const visibleAtStart = await show(ctx);
  const ms: (number | null)[] = [];
  for (let i = 0; i < n; i++) {
    const from = ctx.stub.events.length;
    ctx.stub.cmd({ cmd: "state", name: i % 2 ? "W" : "C" });
    const sent = await ctx.stub.waitFor((e) => e.ev === "sent", 2000, from);
    const paint = await ctx.stub.waitFor((e) => e.ev === "paint" && e.seq === sent?.seq, 2000, from);
    const tPaint = num(paint, "t_paint");
    ms.push(sent && tPaint ? tPaint - sent.t : null);
    await sleep(150);
  }
  ctx.r.s9_3 = { visible_at_start: visibleAtStart, ms, lightroom_in_front_at_end: lrFront(ctx) };
  ctx.save();
}

/** CPU over `windowMs` and private bytes at its end, for every process of the HUD's tree. */
async function sample(ctx: Ctx, windowMs: number): Promise<Record<string, unknown>> {
  const before = new Map(tree(ctx.hud.pid).map((p) => [p, cpuMs(p)] as const));
  const t0 = now();
  await sleep(windowMs);
  const t1 = now();
  const names = processes();
  const procs = tree(ctx.hud.pid).map((pid) => {
    const c0 = before.get(pid);
    const c1 = cpuMs(pid);
    return { pid, exe: names.get(pid)?.exe ?? "?", private_bytes: privateBytes(pid), cpu_ms: c0 != null && c1 != null ? c1 - c0 : null };
  });
  const sum = (k: "private_bytes" | "cpu_ms"): number => procs.reduce((a, p) => a + (p[k] ?? 0), 0);
  return {
    window_ms: t1 - t0,
    procs,
    private_bytes_tree: sum("private_bytes"),
    private_bytes_host: procs.find((p) => p.pid === ctx.hud.pid)?.private_bytes ?? null,
    cpu_pct_one_core: (sum("cpu_ms") / (t1 - t0)) * 100,
    new_processes: procs.filter((p) => !before.has(p.pid)).map((p) => p.pid),
  };
}

/** S9-4 and S9-5 hidden: hidden, no update for 60 s (pings go on every 2 s, spec 3.3). */
export async function idle(ctx: Ctx): Promise<void> {
  const hidden = await hide(ctx);
  ctx.r.s9_4_5_hidden = { hidden, ...(await sample(ctx, 60_000)), still_hidden: !visible(ctx.hud.hwnd) };
  ctx.save();
}

/** S9-5 visible: the working state (its ring pulses on a 1.6 s loop) for 60 s. */
export async function pulsing(ctx: Ctx): Promise<void> {
  const from = ctx.stub.events.length;
  ctx.stub.cmd({ cmd: "state", name: "W" });
  await ctx.stub.waitFor((e) => e.ev === "paint", 2000, from);
  const shown = await show(ctx);
  await sleep(1000);
  ctx.r.s9_5_visible = { shown, ...(await sample(ctx, 60_000)), lightroom_in_front_at_end: lrFront(ctx), still_visible: visible(ctx.hud.hwnd) };
  ctx.save();
}
