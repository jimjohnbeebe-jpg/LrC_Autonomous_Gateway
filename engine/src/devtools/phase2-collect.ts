// Collecting the Phase 2 chat's evidence (used by phase2-check-cli.ts; tested in
// tests/phase2-collect.test.ts): Claude Desktop's MCP log for the lrc-avg server and the engine's tool
// log, both cut to the time of the chat and with the user folder redacted, saved next to the check's
// results so Claude Code can commit them.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { redactHome, type ChatLogs } from "./phase2-check.js";

export type CollectPaths = {
  /** %LOCALAPPDATA%\Claude\Logs\mcp-server-<server name>.log */
  desktopLog: string;
  /** Where the Desktop engine writes its tool log (LRC_AVG_LOG_DIR; the repo's logs\ folder). */
  engineLogDir: string;
  outDir: string;
  stamp: string;
  home: string;
  serverName: string;
};

const ISO_AT_START = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/;

function localDay(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

export function collectChatLogs(since: Date, paths: CollectPaths, now: Date = new Date()): ChatLogs {
  mkdirSync(paths.outDir, { recursive: true });
  const redact = (text: string) => redactHome(text, paths.home);

  // Claude Desktop's log: its timestamped lines from the chat on [handle: the line format in
  // docs\reports\phase0\S3\desktop-mcp-log-excerpt.txt], plus the engine's own stderr lines
  // ("[lrc-avg] ...", which carry no timestamp) once the chat's lines have started.
  let desktop: ChatLogs["desktop_log"] = { found: false, saved_as: null, lines: 0 };
  if (existsSync(paths.desktopLog)) {
    const kept: string[] = [];
    let inWindow = false;
    for (const line of readFileSync(paths.desktopLog, "utf8").split(/\r?\n/)) {
      const ts = ISO_AT_START.exec(line)?.[1];
      if (ts) {
        inWindow = new Date(ts).getTime() >= since.getTime();
        if (inWindow && /Server started|Message from|\[error\]|\[warn\]/.test(line)) kept.push(line);
      } else if (inWindow && line.startsWith(`[${paths.serverName}] `)) {
        kept.push(line);
      }
    }
    const saved = path.join(paths.outDir, `p2_desktop_mcp_log_${paths.stamp}.txt`);
    const header = [
      `# Excerpt of Claude Desktop's MCP log for the ${paths.serverName} server, collected by npm run phase2:check.`,
      `# Source: %LOCALAPPDATA%\\Claude\\Logs\\${path.basename(paths.desktopLog)}, lines from ${since.toISOString()} on.`,
      `# Filter: timestamped lines matching Server started|Message from|[error]|[warn], and the engine's [${paths.serverName}] lines; user folder redacted.`,
      "",
    ];
    writeFileSync(saved, redact([...header, ...kept].join("\n")) + "\n");
    desktop = { found: true, saved_as: path.basename(saved), lines: kept.length };
  }

  // The engine's tool log: one file per local day (log/tool-log.ts), records from the chat on.
  const records: Array<Record<string, unknown>> = [];
  let found = false;
  for (const day of new Set([localDay(since), localDay(now)])) {
    const file = path.join(paths.engineLogDir, `engine-${day}.jsonl`);
    if (!existsSync(file)) continue;
    found = true;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as Record<string, unknown>;
        if (typeof record["ts"] === "string" && new Date(record["ts"]).getTime() >= since.getTime()) records.push(record);
      } catch {
        // A line cut off mid-write; skip it.
      }
    }
  }
  let savedAs: string | null = null;
  if (found) {
    const saved = path.join(paths.outDir, `p2_chat_tool_log_${paths.stamp}.jsonl`);
    writeFileSync(saved, records.map((r) => redact(JSON.stringify(r)) + "\n").join(""));
    savedAs = path.basename(saved);
  }
  return { desktop_log: desktop, engine_log: { found, saved_as: savedAs, records } };
}
