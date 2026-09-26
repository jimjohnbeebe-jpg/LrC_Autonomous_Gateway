// Development overrides for the bridge's ports, the lock port and the token file, read from the
// environment by main.ts and the Phase 2 check. They let a smoke test or a dry run talk to a scratch
// plugin while Lightroom holds the real ports and token: the smoke tests of PR #17 connected to Jim's
// running plugin (hello only, no Develop command) because there was no other way to point them
// [handle: %TEMP%\LrC-AVG\bridge.log on Jim's machine, 2026-09-26 14:56:42 and 15:07:20].
// Unset, the defaults apply: 8765, 8766, 8767 and %USERPROFILE%\.lrc-avg\bridge_token.

import { readFileSync } from "node:fs";
import type { BridgeClientOptions } from "../bridge/index.js";

export type DevOverrides = {
  bridge: Pick<BridgeClientOptions, "commandPort" | "eventPort" | "readToken">;
  lockPort?: number;
};

function port(env: NodeJS.ProcessEnv, name: string): number | undefined {
  const raw = env[name];
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`${name} must be a port number from 1 to 65535, not "${raw}"`);
  return n;
}

export function devOverrides(env: NodeJS.ProcessEnv = process.env): DevOverrides {
  const commandPort = port(env, "LRC_AVG_COMMAND_PORT");
  const eventPort = port(env, "LRC_AVG_EVENT_PORT");
  const lockPort = port(env, "LRC_AVG_LOCK_PORT");
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
    ...(lockPort !== undefined ? { lockPort } : {}),
  };
}
