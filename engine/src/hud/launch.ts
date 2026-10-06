// Starting the Deck (Phase 7 row 3, E8; spec docs\hud\lrc-avg-hud-spec-v2.md 3.2): at an edit's begin,
// when no Deck is connected, the engine starts the Deck's executable detached, so it outlives the engine
// (spike S9-9 passed with a detached stub parent [handle: docs\reports\phase7\S9.md "Numbers"]).
// Without `windowsHide`, as S9's stub started it (S9.md "Design points") [stated: Jim, 2026-10-05, row 3
// decision 2]. At most MAX_STARTS per edit: the start at begin and one restart after a crash (3.2).
// No executable found: nothing starts, and the classic HUD opens at once, as before Phase 7 (row 3
// decision 1).
// Where: LRC_AVG_HUD_EXE, else `%LOCALAPPDATA%\LrC-AVG HUD\LrC-AVG HUD.exe`, where the Deck's per-user
// installer puts it (row 4b). Tauri's NSIS per-user folder is `$LOCALAPPDATA\${PRODUCTNAME}` [inference:
// the string in @tauri-apps/cli-win32-x64-msvc 2.12.1; the row 4b probe checks it]; the product and
// executable are named in hud\src-tauri\tauri.conf.json. The final install path is Phase 8's (spec Q10).
// [handle: tests\hud-launch.test.ts]

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export const HUD_EXE_NAME = "LrC-AVG HUD.exe";
/** The start at begin, and one restart after a crash (spec 3.2). */
const MAX_STARTS = 2;

/** The Deck's executable, or null when it is not there. */
export function findHudExe(env: NodeJS.ProcessEnv = process.env): string | null {
  const exe = env["LRC_AVG_HUD_EXE"] ?? (env["LOCALAPPDATA"] ? path.join(env["LOCALAPPDATA"], "LrC-AVG HUD", HUD_EXE_NAME) : null);
  return exe && existsSync(exe) ? exe : null;
}

/** Start `exe` detached, its output nowhere; an error after the start (e.g. it cannot run) is logged. */
function startDetached(exe: string, log: (message: string) => void): void {
  const child = spawn(exe, [], { detached: true, stdio: "ignore" });
  child.on("error", (err) => log(`the HUD did not start: ${err.message}`));
  child.unref();
}

export type HudLauncherOptions = {
  /** The executable (findHudExe when absent). */
  exe?: () => string | null;
  /** How it is started (startDetached when absent); tests start a simulated Deck. */
  start?: (exe: string) => void;
  log?: (message: string) => void;
};

export class HudLauncher {
  private readonly exe: () => string | null;
  private readonly startExe: (exe: string) => void;
  private readonly log: (message: string) => void;
  private sessionId: string | null = null;
  private starts = 0;

  constructor(options: HudLauncherOptions = {}) {
    this.log = options.log ?? (() => {});
    this.exe = options.exe ?? (() => findHudExe());
    this.startExe = options.start ?? ((exe) => startDetached(exe, this.log));
  }

  /** Start the Deck for edit `sessionId`; false when it is not there, failed to start, or was started MAX_STARTS times for this edit. */
  start(sessionId: string): boolean {
    if (sessionId !== this.sessionId) {
      this.sessionId = sessionId;
      this.starts = 0;
    }
    if (this.starts >= MAX_STARTS) return false;
    const exe = this.exe();
    if (!exe) return false;
    this.starts++;
    try {
      this.startExe(exe);
      return true;
    } catch (err) {
      this.log(`the HUD did not start: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }
}
