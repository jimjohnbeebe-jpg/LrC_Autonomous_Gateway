// Helpers for the Deck shell probe (Phase 7 row 4b; probe.ts): Jim's y/n questions in PowerShell, the
// stand-in engine (the engine's own HudChannel and HudLauncher from engine\dist), the edits' states,
// installing the Deck, and reading the Deck's log (%TEMP%\LrC-AVG\hud\hud_<pid>_<start>.jsonl,
// hud\src-tauri\src\log.rs).
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { HudChannel } from "../../engine/dist/hud/channel.js";
import { hudChannelStateSchema, hudEndpointSchema } from "../../engine/dist/hud/channel-protocol.js";

export const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DECK_LOGS = path.join(tmpdir(), "LrC-AVG", "hud");
export const WINDOW_JSON = path.join(process.env["LOCALAPPDATA"] ?? "", "LrC-AVG", "hud", "window.json");
export const ENDPOINT = path.join(homedir(), ".lrc-avg", "hud_endpoint.json");
export const DECK_IMAGE = "LrC-AVG HUD.exe";
const LR_IMAGE = process.env["LRC_AVG_HUD_LR_EXE"] ?? "Lightroom.exe";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// --- Jim's answers -------------------------------------------------------------------------------
const rl = createInterface({ input: process.stdin });
const lines: string[] = [];
const waiters: ((line: string) => void)[] = [];
rl.on("line", (line) => (waiters.length ? waiters.shift()?.(line) : lines.push(line)));
const nextLine = (): Promise<string> => (lines.length ? Promise.resolve(lines.shift() ?? "") : new Promise((r) => waiters.push(r)));

export async function enter(text: string): Promise<void> {
  process.stdout.write(`\n${text}\nPress Enter when done. `);
  await nextLine();
}

/** A y/n question phrased so that "y" is the good answer. */
export async function yes(text: string): Promise<boolean> {
  for (;;) {
    process.stdout.write(`\n${text}\nType y or n, then Enter: `);
    const a = (await nextLine()).trim().toLowerCase();
    if (a === "y" || a === "n") return a === "y";
  }
}

export function closeInput(): void {
  rl.close();
}

// --- Processes ----------------------------------------------------------------------------------
export function running(image: string): boolean {
  const out = execFileSync("tasklist", ["/FI", `IMAGENAME eq ${image}`, "/NH"], { encoding: "utf8" });
  return out.toLowerCase().includes(image.toLowerCase());
}

export const lightroomRunning = (): boolean => running(LR_IMAGE);

export function stopDeck(): void {
  if (running(DECK_IMAGE)) execFileSync("taskkill", ["/IM", DECK_IMAGE, "/F"], { stdio: "ignore" });
}

/** The endpoint file of an engine that is still running (Claude Desktop's), or null. */
export function liveEngine(): number | null {
  try {
    const ep = hudEndpointSchema.parse(JSON.parse(readFileSync(ENDPOINT, "utf8")));
    process.kill(ep.pid, 0);
    return ep.pid;
  } catch {
    return null;
  }
}

/** The installer `npm run deck:build` made (Tauri's NSIS bundle folder). */
export function installer(): string | null {
  const dir = path.join(REPO, "hud", "src-tauri", "target", "release", "bundle", "nsis");
  const file = existsSync(dir) ? readdirSync(dir).find((f) => f.endsWith("-setup.exe")) : undefined;
  return file ? path.join(dir, file) : null;
}

/** Runs the per-user installer silently (NSIS `/S`); throws when it fails. */
export function install(setup: string): void {
  execFileSync(setup, ["/S"], { stdio: "ignore", timeout: 120_000 });
}

/**
 * Removes the Deck again with its uninstaller beside the executable (the name uninstall.exe is
 * [inference]; the probe's C2 line checks it). Until row 4c gives the Deck its buttons, an installed
 * Deck would replace the classic HUD in Jim's real edits (engine\src\hud\sinks.ts: the classic HUD
 * opens only when no Deck connects). True when the executable is gone.
 */
export function uninstall(exe: string): boolean {
  const remover = path.join(path.dirname(exe), "uninstall.exe");
  if (existsSync(remover)) execFileSync(remover, ["/S"], { stdio: "ignore", timeout: 120_000 });
  for (let i = 0; i < 50 && existsSync(exe); i++) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  return !existsSync(exe);
}

// --- The stand-in engine -------------------------------------------------------------------------
export type Edit = { id: string; seq: number };

export class StandIn {
  readonly channel: HudChannel;
  edit: Edit | null = null;
  clientAt: number | null = null;

  constructor() {
    this.channel = new HudChannel({
      engineVersion: "deck-probe",
      welcome: () => ({ session_id: this.edit?.id ?? null, lightroom: "connected" }),
      onClient: (connected: boolean) => {
        if (connected) this.clientAt = Date.now();
      },
    });
  }

  /** A new edit, working on pass 1. */
  begin(n: number): void {
    this.edit = { id: `deck-probe-${Date.now().toString(36)}-${n}`, seq: 0 };
    this.state("awaiting_claude");
  }

  /** The edit's next state; an end stage carries close_after 10, as the engine's (publisher.ts END_CLOSE_S). */
  state(stage: "awaiting_claude" | "accepted"): boolean {
    const edit = this.edit;
    if (!edit) return false;
    const state = hudChannelStateSchema.parse({
      session_id: edit.id, stage, mode: "converge", pass: 1, max_passes: 6,
      target: { uuid: "DECK-PROBE-PHOTO", filename: "deck-probe.NEF" }, snapshot: "AVG pre-session (Deck probe: nothing was edited)",
      lightroom: "connected", ...(stage === "accepted" ? { close_after: 10 } : {}),
    });
    edit.seq += 1;
    return this.channel.send({ type: "state", seq: edit.seq, state });
  }

  async waitClient(ms: number): Promise<boolean> {
    const end = Date.now() + ms;
    while (!this.channel.connected() && Date.now() < end) await sleep(50);
    return this.channel.connected();
  }
}

// --- The Deck's log ------------------------------------------------------------------------------
export type DeckEvent = { ev: string; t: number; [k: string]: unknown };

/** The newest Deck log started at or after `since` (epoch ms), or null. */
export function deckLog(since: number): string | null {
  if (!existsSync(DECK_LOGS)) return null;
  const files = readdirSync(DECK_LOGS)
    .filter((f) => /^hud_\d+_\d+\.jsonl$/.test(f) && Number(f.split(/[_.]/)[2]) >= since - 1000)
    .map((f) => path.join(DECK_LOGS, f));
  return files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null;
}

export function events(file: string | null): DeckEvent[] {
  if (!file) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((line) => {
    try {
      return [JSON.parse(line) as DeckEvent];
    } catch {
      return []; // a line the Deck is still writing
    }
  });
}

/** The first event after `after` that `match` accepts, waiting up to `ms`. */
export async function waitEvent(file: () => string | null, after: number, match: (e: DeckEvent) => boolean, ms: number): Promise<DeckEvent | null> {
  const end = Date.now() + ms;
  for (;;) {
    const found = events(file()).find((e) => e.t >= after && match(e));
    if (found || Date.now() >= end) return found ?? null;
    await sleep(100);
  }
}
