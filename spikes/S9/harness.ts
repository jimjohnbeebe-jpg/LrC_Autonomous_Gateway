// Spike S9: the shared parts of measure.ts: the stub engine as a child process, waiting for its
// events, the HUD's own log, polling, the PowerShell y/n questions, and the results file.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface as lines } from "node:readline";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { processes } from "./win32.ts";

export const here = dirname(fileURLToPath(import.meta.url));
export const OUT = join(tmpdir(), "LrC-AVG", "S9");
export const HUD_EXE = join(here, "tauri", "src-tauri", "target", "release", "lrc-avg-s9-hud.exe");
export const now = (): number => performance.timeOrigin + performance.now();
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export type Ev = { ev: string; t: number } & Record<string, unknown>;

export type Stub = {
  child: ChildProcess;
  events: Ev[];
  cmd: (c: Record<string, unknown>) => void;
  /** The first event from index `from` on that matches, or null after `timeoutMs`. */
  waitFor: (pred: (e: Ev) => boolean, timeoutMs: number, from?: number) => Promise<Ev | null>;
};

export async function startStub(): Promise<Stub> {
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", join(here, "stub-engine.ts"), HUD_EXE], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  const events: Ev[] = [];
  const waiters = new Set<() => void>();
  lines({ input: child.stdout! }).on("line", (line) => {
    try {
      events.push(JSON.parse(line) as Ev);
    } catch {
      events.push({ ev: "unparsed", t: now(), line });
    }
    for (const w of waiters) w();
  });
  const waitFor: Stub["waitFor"] = (pred, timeoutMs, from = 0) =>
    new Promise((resolve) => {
      let i = from;
      const check = (): boolean => {
        for (; i < events.length; i++) {
          const e = events[i];
          if (e && pred(e)) return done(e);
        }
        return false;
      };
      const timer = setTimeout(() => done(null), timeoutMs);
      const done = (e: Ev | null): true => {
        clearTimeout(timer);
        waiters.delete(check);
        resolve(e);
        return true;
      };
      if (!check()) waiters.add(check);
    });
  const stub = { child, events, cmd: (c: Record<string, unknown>) => child.stdin!.write(JSON.stringify(c) + "\n"), waitFor };
  if (!(await waitFor((e) => e.ev === "listening", 10_000))) throw new Error("the stub engine did not start listening");
  return stub;
}

/**
 * The HUD's own log lines (src-tauri\src\log.rs), %TEMP%\LrC-AVG\S9\hud_<pid>_<start ms>.jsonl: the
 * newest file of that pid started after `since` (epoch ms, with 1 s of clock slack), so a log left by
 * an earlier process with the same pid is never read.
 */
export function hudLog(pid: number, since: number): Ev[] {
  const name = new RegExp(`^hud_${pid}_(\\d+)\\.jsonl$`);
  const starts = existsSync(OUT)
    ? readdirSync(OUT).flatMap((f) => {
        const start = Number(name.exec(f)?.[1] ?? NaN);
        return start >= since - 1000 ? [{ f, start }] : [];
      })
    : [];
  const newest = starts.sort((a, b) => b.start - a.start)[0];
  if (!newest) return [];
  return readFileSync(join(OUT, newest.f), "utf8").split("\n").filter(Boolean).flatMap((l) => {
    try {
      return [JSON.parse(l) as Ev];
    } catch {
      return [];
    }
  });
}

/** Polls `fn` every `everyMs` until true; returns the time it first held, or null. */
export async function pollUntil(fn: () => boolean, timeoutMs: number, everyMs = 1): Promise<number | null> {
  const end = now() + timeoutMs;
  for (;;) {
    if (fn()) return now();
    if (now() > end) return null;
    await sleep(everyMs);
  }
}

export const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Ends a HUD and waits until every process of its tree is gone. */
export async function killTree(pids: number[]): Promise<boolean> {
  for (const pid of pids) if (alive(pid)) try { process.kill(pid); } catch { /* gone */ }
  return (await pollUntil(() => pids.every((p) => !alive(p)), 10_000, 50)) !== null;
}

export const hudPids = (): number[] => [...processes()].filter(([, p]) => p.exe.toLowerCase() === "lrc-avg-s9-hud.exe").map(([pid]) => pid);

const rl = createInterface({ input: process.stdin, output: process.stdout });
// readline takes Ctrl+C itself and, with no listener, only pauses; pass it on to measure.ts's handler.
rl.on("SIGINT", () => process.emit("SIGINT", "SIGINT"));
export const say = (text: string): void => console.log(text);
export const beep = (): void => void process.stdout.write("\x07");
export async function enter(text: string): Promise<void> {
  await rl.question(`\n${text}\nPress Enter here when ready. `);
}
export async function ask(question: string): Promise<boolean> {
  for (;;) {
    const a = (await rl.question(`  ${question} (y/n) `)).trim().toLowerCase();
    if (a === "y" || a === "n") return a === "y";
  }
}
/** Resolves when Jim presses Enter, without blocking the polling loops that run meanwhile. */
export const enterLater = (text: string): Promise<string> => rl.question(`\n${text}\n`);
export const closePrompts = (): void => rl.close();

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] ?? null) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
}
/** Nearest-rank percentile. */
export function pct(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] ?? null;
}

export type Results = Record<string, unknown> & { run_id: string; errors: string[] };
export function saver(results: Results): () => string {
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, `s9_${results.run_id}.json`);
  return () => {
    writeFileSync(file, JSON.stringify(results, null, 2));
    return file;
  };
}
