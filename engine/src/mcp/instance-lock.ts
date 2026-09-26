// One engine per Lightroom bridge. The plugin serves one client at a time and rebinds its send
// socket for each new one (Phase 0, P-13), so a second engine (a second Claude Desktop server
// process, or the Phase 2 check while Desktop runs) would take the bridge from the first. The lock
// file holds the owner's PID; a lock whose PID is gone is stale and is replaced.
//
// Derived from Automaat's server/src/instance-lock.ts (MIT, see engine/THIRD_PARTY_NOTICES.md).
// Changes: the caller gets { ok: false, pid } instead of an exception, so the engine can keep
// serving MCP and answer ENGINE_BUSY; it registers no signal handlers (main.ts owns shutdown).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type InstanceLock = { file: string; release: () => void };
export type LockResult = { ok: true; lock: InstanceLock } | { ok: false; pid: number; file: string };

/** %USERPROFILE%\.lrc-avg\engine-<command port>-<event port>.lock, next to the bridge token. */
export function defaultLockFile(commandPort = 8765, eventPort = 8766): string {
  return path.join(os.homedir(), ".lrc-avg", `engine-${commandPort}-${eventPort}.lock`);
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readPid(file: string): number | null {
  try {
    const parsed = Number(fs.readFileSync(file, "utf8").trim());
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function acquireInstanceLock(file: string = defaultLockFile(), isAlive: (pid: number) => boolean = pidIsAlive): LockResult {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (;;) {
    let fd: number | null = null;
    try {
      fd = fs.openSync(file, "wx");
      fs.writeFileSync(fd, `${process.pid}\n`, "utf8");
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const owner = readPid(file);
      if (owner !== null && owner !== process.pid && isAlive(owner)) return { ok: false, pid: owner, file };
      try {
        fs.unlinkSync(file); // stale: its process is gone (or the file is unreadable)
      } catch (unlinkErr) {
        if ((unlinkErr as NodeJS.ErrnoException).code !== "ENOENT") throw unlinkErr;
      }
    } finally {
      if (fd !== null) fs.closeSync(fd);
    }
  }

  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    process.off("exit", release);
    try {
      if (readPid(file) === process.pid) fs.unlinkSync(file);
    } catch {
      // Already gone.
    }
  };
  process.once("exit", release);
  return { ok: true, lock: { file, release } };
}
