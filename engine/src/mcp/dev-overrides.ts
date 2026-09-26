// Development overrides for the bridge's ports and the token file, read from the environment by
// main.ts and the Phase 2 check. They let a smoke test or a dry run talk to a scratch plugin while
// Lightroom holds the real ports and token: the smoke tests of PR #17 connected to Jim's running
// plugin (hello only, no Develop command) because there was no other way to point them
// [handle: %TEMP%\LrC-AVG\bridge.log on Jim's machine, 2026-09-26 14:56:42 and 15:07:20].
// Unset, the defaults apply: 8765, 8766 and %USERPROFILE%\.lrc-avg\bridge_token.
// The lock port is never set on its own: it is always the event port + 1 (lockPortFor), so two
// engines on the same bridge always compete for the same lock (Greptile, PR #18).

import { readFileSync } from "node:fs";
import type { BridgeClientOptions } from "../bridge/index.js";
import { lockPortFor } from "./instance-lock.js";

export type DevOverrides = {
  bridge: Pick<BridgeClientOptions, "commandPort" | "eventPort" | "readToken">;
  /** The instance-lock port for the bridge these overrides point at. */
  lockPort: number;
};

function port(env: NodeJS.ProcessEnv, name: string): number | undefined {
  const raw = env[name];
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  // 65534 at most, so the lock port (event port + 1) is a port too.
  if (!Number.isInteger(n) || n < 1 || n > 65534) throw new Error(`${name} must be a port number from 1 to 65534, not "${raw}"`);
  return n;
}

export function devOverrides(env: NodeJS.ProcessEnv = process.env): DevOverrides {
  const commandPort = port(env, "LRC_AVG_COMMAND_PORT");
  const eventPort = port(env, "LRC_AVG_EVENT_PORT");
  const tokenFile = env["LRC_AVG_TOKEN_FILE"];
  const readToken = tokenFile
    ? (): string | null => {
        try {
          const token = readFileSync(tokenFile, "utf8").trim();
          return token.length > 0 ? token : null;
        } catch {
          return null;
        }
      }
    : undefined;
  return {
    bridge: {
      ...(commandPort !== undefined ? { commandPort } : {}),
      ...(eventPort !== undefined ? { eventPort } : {}),
      ...(readToken ? { readToken } : {}),
    },
    lockPort: lockPortFor(eventPort),
  };
}
