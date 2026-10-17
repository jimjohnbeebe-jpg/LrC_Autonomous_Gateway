// The client probe's simulated Lightroom (ISSUE155_PLAN R5): a scratch folder, the fake plugin on
// fixed probe ports with the simulator behind it, and the env that points the built engine at both,
// so a client run never reaches Jim's Lightroom (its plugin listens on 8765/8766, mcp\dev-overrides.ts)
// nor his logs, previews, intents or presets. The engine's temp, home and app-data folders are under
// the scratch folder too: it reads previews and exports only under os.tmpdir()\LrC-AVG
// (preview\service.ts, library\files.ts), and os.tmpdir() follows TEMP [handle: preview\service.ts:17-18].
// The self-checks below run with no client at all.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import sharp from "sharp";
import { baseEnv, clientEntry, type McpEntry } from "../../src/devtools/clients-launch.js";
import { FakePlugin } from "../helpers/fake-plugin.js";
import { LightroomSim } from "../helpers/lightroom-sim.js";
import { overlayWord, wordBox, type Img } from "../helpers/lightroom-sim-word.js";

/** Fixed ports nothing else of the project uses; the lock is the event port + 1 (mcp\dev-overrides.ts). */
export const PROBE_PORTS = { command: 47651, event: 47652, lock: 47653 } as const;
export const TOOL_COUNT = 36;

export type Harness = {
  scratch: string;
  plugin: FakePlugin;
  lr: LightroomSim;
  logDir: string;
  /** The folder the export test (T5) writes into. */
  outDir: string;
  /** The env the engine runs with: baseEnv() plus the overrides below. */
  env: Record<string, string>;
  entry: McpEntry;
  close: () => Promise<void>;
};

function listening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("error", () => resolve(false));
  });
}

/** The probe ports something listens on; waits up to `waitMs` for them to free (an engine exiting). */
export async function busyPorts(waitMs = 0): Promise<number[]> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const busy: number[] = [];
    for (const p of Object.values(PROBE_PORTS)) if (await listening(p)) busy.push(p);
    if (busy.length === 0 || Date.now() >= deadline) return busy;
    await new Promise((r) => setTimeout(r, 500));
  }
}

export async function startHarness(o: { waitMs?: number } = {}): Promise<Harness> {
  const busy = await busyPorts(o.waitMs ?? 0);
  if (busy.length > 0) throw new Error(`probe ports in use: ${busy.join(", ")}; close what listens there and run again`);
  const scratch = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-probe-"));
  const dir = (...p: string[]): string => {
    const d = path.join(scratch, ...p);
    mkdirSync(d, { recursive: true });
    return d;
  };
  const temp = dir("temp");
  const plugin = await FakePlugin.start({ command: PROBE_PORTS.command, event: PROBE_PORTS.event });
  const lr = new LightroomSim(dir("temp", "LrC-AVG", "previews"));
  lr.files.exportDir = dir("temp", "LrC-AVG", "exports");
  lr.install(plugin);
  const tokenFile = path.join(scratch, "bridge_token");
  writeFileSync(tokenFile, plugin.token);
  const logDir = dir("logs");
  const overrides = {
    LRC_AVG_COMMAND_PORT: String(PROBE_PORTS.command),
    LRC_AVG_EVENT_PORT: String(PROBE_PORTS.event),
    LRC_AVG_TOKEN_FILE: tokenFile,
    LRC_AVG_LOG_DIR: logDir,
    LRC_AVG_INTENTS_DIR: dir("intents"),
    LRC_AVG_PRESET_DIR: dir("presets"),
    LRC_AVG_HUD_EXE: path.join(scratch, "no-deck.exe"),
    TEMP: temp,
    TMP: temp,
    USERPROFILE: dir("home"),
    LOCALAPPDATA: dir("local"),
    APPDATA: dir("roaming"),
  };
  const entry = clientEntry(overrides);
  const close = async (): Promise<void> => {
    await plugin.close();
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
  return { scratch, plugin, lr, logDir, outDir: dir("out"), env: { ...baseEnv(), ...overrides }, entry, close };
}

/** Self-check (a): the word's box against the same box of plain noise (mean and darkest pixel). */
export async function wordSelfCheck(word: string): Promise<{ word: string; noise: { mean: number; min: number }; printed: { mean: number; min: number }; ok: boolean }> {
  const [width, height] = [1600, 1067];
  const b = wordBox(width, height);
  const noise = (): Img => sharp({ create: { width, height, channels: 3, background: { r: 118, g: 118, b: 118 }, noise: { type: "gaussian", mean: 118, sigma: 12 } } });
  const boxStats = async (img: Img): Promise<{ mean: number; min: number }> => {
    const jpeg = await img.jpeg({ quality: 85 }).toBuffer();
    // stats() reads its input, not the pipeline's result, so the box is cut out first.
    const box = await sharp(jpeg).extract({ left: b.left, top: b.top, width: b.width, height: b.height }).greyscale().png().toBuffer();
    const s = await sharp(box).stats();
    const c = s.channels[0]!;
    return { mean: Math.round(c.mean), min: c.min };
  };
  const plain = await boxStats(noise());
  const printed = await boxStats(overlayWord(noise(), word, width, height));
  // The box (235) lifts the mean far above the noise (118); dark text (20) leaves pixels near black.
  return { word, noise: plain, printed, ok: printed.mean > plain.mean + 50 && printed.min < 80 && printed.mean < 230 };
}

/** Self-check (b): the built engine, with exactly the harness env, answers initialize and lists the tools; one preview through the sim. */
export async function engineSelfCheck(h: Harness): Promise<{ server: { name: string; version: string } | null; tools: number; preview_image: boolean; ok: boolean }> {
  const transport = new StdioClientTransport({ command: h.entry.command, args: h.entry.args, env: h.entry.env, stderr: "ignore" });
  const client = new Client({ name: "lrc-avg-probe-selfcheck", version: "1.0.0" });
  await client.connect(transport);
  try {
    const server = client.getServerVersion() ?? null;
    const tools = (await client.listTools()).tools.length;
    const preview = await client.callTool({ name: "lr_get_preview", arguments: {} });
    const content = (preview.content ?? []) as Array<{ type: string }>;
    const preview_image = content.some((c) => c.type === "image");
    return { server: server ? { name: server.name, version: server.version } : null, tools, preview_image, ok: tools === TOOL_COUNT && preview_image };
  } finally {
    await client.close();
  }
}
