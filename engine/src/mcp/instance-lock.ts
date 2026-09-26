// One engine per Lightroom bridge. The plugin serves one client at a time and rebinds its send
// socket for each new one (Phase 0, P-13), so a second engine (a second Claude Desktop server
// process, or the Phase 2 check while Desktop runs) would take the bridge from the first. Claude
// Desktop has started a server twice within 2 s [handle: docs\reports\phase0\S3\desktop-mcp-log-excerpt.txt,
// two "Server started" lines at 17:21:36 and 17:21:38].
//
// The lock is a TCP listener on 127.0.0.1 (PRD NFR-4) at a fixed port, next to the bridge's two:
// only one process can listen on it, and the OS frees it when the process ends, however it ends.
// On Windows a second listen on the same port fails with EADDRINUSE [handle: Claude Code, 2026-09-26,
// Node v24.11.1 on win32: two net.Server.listen calls on one 127.0.0.1 port -> "EADDRINUSE"].
// This replaces a PID lock file (Automaat's server/src/instance-lock.ts pattern): two engines that
// both found the same stale file could each break it and both take the bridge (Greptile, PR #17).
// The listener answers a connection with its PID, so the engine that finds the lock taken can say
// which process holds it.

import net from "node:net";

/** 8767: the port after the bridge's 8765 (commands) and 8766 (events). */
export const DEFAULT_LOCK_PORT = 8767;
const HOST = "127.0.0.1";
const PID_TIMEOUT_MS = 500;

/** release() frees the port; its promise settles once the listener has closed. */
export type InstanceLock = { port: number; release: () => Promise<void> };
export type LockResult = { ok: true; lock: InstanceLock } | { ok: false; port: number; pid: number | null };

/** The PID the lock holder reports, or null if it does not answer in time. */
function holderPid(port: number): Promise<number | null> {
  return new Promise((resolve) => {
    let text = "";
    const socket = net.connect({ host: HOST, port });
    const done = (pid: number | null): void => {
      clearTimeout(timer);
      socket.destroy();
      resolve(pid);
    };
    const timer = setTimeout(() => done(null), PID_TIMEOUT_MS);
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => (text += chunk));
    socket.on("end", () => {
      const pid = Number(text.trim());
      done(Number.isInteger(pid) && pid > 0 ? pid : null);
    });
    socket.on("error", () => done(null));
  });
}

export function acquireInstanceLock(port: number = DEFAULT_LOCK_PORT): Promise<LockResult> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      socket.on("error", () => {});
      socket.end(`${process.pid}\n`);
    });
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code !== "EADDRINUSE") return reject(err);
      void holderPid(port).then((pid) => resolve({ ok: false, port, pid }));
    });
    server.listen({ host: HOST, port, exclusive: true }, () => {
      server.unref(); // the lock alone does not keep the engine running
      let closed: Promise<void> | null = null;
      resolve({
        ok: true,
        lock: {
          port,
          release: () => (closed ??= new Promise<void>((done) => server.close(() => done()))),
        },
      });
    });
  });
}
