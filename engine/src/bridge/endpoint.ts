// Where the bridge client connects and what it carries: the plugin's token file, its ports file,
// and opening a socket to one port. Both files are in %USERPROFILE%\.lrc-avg\, written by the plugin
// at start (plugin\LrC-AVG.lrplugin\Endpoint.lua), and the client reads both before each connection:
//   bridge_token        C-8: every command carries it (protocol.ts)
//   bridge_ports.json   the ports the bridge listens on, from its settings page (PHASE5_PLAN decision
//                       2e, row 3). An explicit port (an option, from the LRC_AVG_*_PORT variables,
//                       mcp\dev-overrides.ts) wins over the file, and the file over 8765/8766.
//                       The file is used only when its token_check is the start of the token the
//                       client just read: a file from an earlier start (an older plugin that writes
//                       none, or a write that failed) is not taken for this one's (Greptile, PR #44).
// Moved out of client.ts in PHASE5_PLAN row 3, which took client.ts off the size rule's list.

import { readFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

export const DEFAULT_COMMAND_PORT = 8765;
export const DEFAULT_EVENT_PORT = 8766;

/** The plugin's two listening ports: `receive` takes the engine's commands, `send` carries the replies. */
export type BridgePorts = { receive: number; send: number };

/** How many leading characters of the token the ports file carries (Endpoint.lua TOKEN_CHECK_CHARS). */
export const TOKEN_CHECK_CHARS = 16;

const port = z.number().int().min(1).max(65535);
const portsFileSchema = z
  .looseObject({ receive: port, send: port, token_check: z.string().length(TOKEN_CHECK_CHARS) })
  .refine((p) => p.receive !== p.send, "receive and send are the same port");

function lrcAvgDir(): string {
  return path.join(os.homedir(), ".lrc-avg");
}

/** Where the plugin writes its token: %USERPROFILE%\.lrc-avg\bridge_token. */
export function defaultTokenPath(): string {
  return path.join(lrcAvgDir(), "bridge_token");
}

/** Where the plugin writes its ports: %USERPROFILE%\.lrc-avg\bridge_ports.json. */
export function defaultPortsPath(): string {
  return path.join(lrcAvgDir(), "bridge_ports.json");
}

export function readTokenFile(file: string = defaultTokenPath()): string | null {
  try {
    const token = readFileSync(file, "utf8").trim();
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

/**
 * The ports in the plugin's ports file for the start that wrote `token`, or null (with why) when
 * there is no file, it does not hold two different ports, or it is from another start; the client
 * then uses 8765/8766, as before the file existed.
 */
export function readPortsFile(token: string, file: string = defaultPortsPath()): { ports: BridgePorts | null; problem: string | null } {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return { ports: null, problem: null }; // no file: a plugin older than 0.5.0, or not started yet
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ports: null, problem: `${file} is not JSON` };
  }
  const parsed = portsFileSchema.safeParse(json);
  if (!parsed.success) return { ports: null, problem: `${file}: ${parsed.error.issues.map((i) => i.message).join("; ")}` };
  if (parsed.data.token_check !== token.slice(0, TOKEN_CHECK_CHARS)) {
    return { ports: null, problem: `${file} is from an earlier plugin start (its token_check is not the token file's)` };
  }
  return { ports: { receive: parsed.data.receive, send: parsed.data.send }, problem: null };
}

/** The ports of one connection attempt, and where they came from. */
export type PortsChoice = { command: number; event: number; from: "options" | "ports file" | "default" };

/**
 * The ports for the next connection: each given one (an option) first, then the ports file, then
 * 8765/8766. The file is read only when a port is missing.
 */
export function choosePorts(given: { command: number | undefined; event: number | undefined }, read: () => BridgePorts | null): PortsChoice {
  if (given.command !== undefined && given.event !== undefined) return { command: given.command, event: given.event, from: "options" };
  const file = read();
  return {
    command: given.command ?? file?.receive ?? DEFAULT_COMMAND_PORT,
    event: given.event ?? file?.send ?? DEFAULT_EVENT_PORT,
    from: file ? "ports file" : given.command !== undefined || given.event !== undefined ? "options" : "default",
  };
}

/**
 * A reader of the ports file for one client: logs a file it cannot use once, not at every
 * connection attempt (every 2 s while Lightroom is closed: client.ts DEFAULTS reconnectMs).
 */
export function portsFileReader(log: (message: string) => void, file?: string): (token: string) => BridgePorts | null {
  let lastProblem: string | null = null;
  return (token) => {
    const { ports, problem } = readPortsFile(token, file);
    if (problem && problem !== lastProblem) log(`bridge: ignoring the ports file (${problem}); using 8765/8766`);
    lastProblem = problem;
    return ports;
  };
}

export function openSocket(host: string, port: number, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    socket.setNoDelay(true);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`connect to ${host}:${port} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.removeAllListeners("error");
      resolve(socket);
    });
    socket.once("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      socket.destroy();
      reject(new Error(`${host}:${port}: ${err.code ?? err.message}`));
    });
  });
}
