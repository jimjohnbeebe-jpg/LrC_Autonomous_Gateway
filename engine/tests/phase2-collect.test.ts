// Collecting the Phase 2 chat's logs (src/devtools/phase2-collect.ts) and the development overrides
// (src/mcp/dev-overrides.ts).

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectChatLogs, type CollectPaths } from "../src/devtools/phase2-collect.js";
import { devOverrides } from "../src/mcp/index.js";

let tmp: string;
let paths: CollectPaths;
const home = "C:\\Users\\jim";
const since = new Date("2026-09-27T10:00:00.000Z");

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-collect-"));
  paths = {
    desktopLog: path.join(tmp, "Logs", "mcp-server-lrc-avg.log"),
    engineLogDir: path.join(tmp, "logs"),
    outDir: path.join(tmp, "out"),
    stamp: "S",
    home,
    serverName: "lrc-avg",
  };
  mkdirSync(path.dirname(paths.desktopLog), { recursive: true });
  mkdirSync(paths.engineLogDir, { recursive: true });
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("devtools: Phase 2 chat logs", () => {
  it("keeps Claude Desktop's lines from the chat on, with the engine's stderr lines, and redacts the user folder", () => {
    writeFileSync(
      paths.desktopLog,
      [
        "2026-09-27T09:59:59.000Z [lrc-avg] [info] Message from client: method=\"tools/list\" id=1 params { metadata: undefined }",
        "[lrc-avg] engine 0.2.0 ready on stdio (node v24.11.1); tool log: C:\\Users\\jim\\old",
        "2026-09-27T10:00:05.000Z [lrc-avg] [info] Message from client: method=\"tools/call\" id=2 params { metadata: undefined }",
        "[lrc-avg] bridge: connected; previews: c:\\users\\JIM\\AppData\\Local\\Temp\\LrC-AVG\\previews",
        "2026-09-27T10:00:08.000Z [lrc-avg] [info] Message from server: id=2 result(2 blocks) { metadata: undefined }",
        "2026-09-27T10:00:09.000Z [lrc-avg] [debug] something else",
        "[other] not ours",
      ].join("\r\n"),
    );
    const logs = collectChatLogs(since, paths);
    expect(logs.desktop_log).toEqual({ found: true, saved_as: "p2_desktop_mcp_log_S.txt", lines: 3 });
    const saved = readFileSync(path.join(paths.outDir, "p2_desktop_mcp_log_S.txt"), "utf8");
    expect(saved).toContain('method="tools/call" id=2');
    expect(saved).toContain("result(2 blocks)");
    expect(saved).toContain("previews: %USERPROFILE%\\AppData");
    expect(saved).not.toMatch(/jim/i);
    expect(saved).not.toContain("tools/list");
  });

  it("keeps the engine's tool-log records from the chat on", () => {
    const day = `${since.getFullYear()}${String(since.getMonth() + 1).padStart(2, "0")}${String(since.getDate()).padStart(2, "0")}`;
    writeFileSync(
      path.join(paths.engineLogDir, `engine-${day}.jsonl`),
      [
        JSON.stringify({ ts: "2026-09-27T09:00:00.000Z", tool: "lr_get_preview", ok: true }),
        JSON.stringify({ ts: "2026-09-27T10:00:06.000Z", tool: "lr_get_preview", ok: true, note: "C:\\Users\\jim\\x" }),
        '{"ts": "2026-09-27T10:00:07', // cut off mid-write
        JSON.stringify({ ts: "2026-09-27T10:00:20.000Z", tool: "lr_set_settings", ok: true }),
      ].join("\n") + "\n",
    );
    const logs = collectChatLogs(since, paths, since);
    expect(logs.engine_log.records.map((r) => r["tool"])).toEqual(["lr_get_preview", "lr_set_settings"]);
    const saved = readFileSync(path.join(paths.outDir, "p2_chat_tool_log_S.jsonl"), "utf8");
    expect(saved.trim().split("\n")).toHaveLength(2);
    expect(saved).toContain("%USERPROFILE%");
    expect(saved).not.toMatch(/jim/i);
  });

  it("reports missing logs as not found", () => {
    expect(collectChatLogs(since, paths)).toEqual({
      desktop_log: { found: false, saved_as: null, lines: 0 },
      engine_log: { found: false, saved_as: null, records: [] },
    });
  });
});

describe("mcp: development overrides", () => {
  it("uses nothing when nothing is set", () => {
    expect(devOverrides({})).toEqual({ bridge: {} });
  });

  it("reads the ports and the token file", () => {
    const token = path.join(tmp, "token");
    writeFileSync(token, " abc \n");
    const dev = devOverrides({ LRC_AVG_COMMAND_PORT: "18765", LRC_AVG_EVENT_PORT: "18766", LRC_AVG_LOCK_PORT: "18767", LRC_AVG_TOKEN_FILE: token });
    expect(dev).toMatchObject({ bridge: { commandPort: 18765, eventPort: 18766 }, lockPort: 18767 });
    expect(dev.bridge.readToken?.()).toBe("abc");
    expect(devOverrides({ LRC_AVG_TOKEN_FILE: path.join(tmp, "missing") }).bridge.readToken?.()).toBeNull();
  });

  it("refuses a port that is not a port", () => {
    expect(() => devOverrides({ LRC_AVG_LOCK_PORT: "99999" })).toThrow(/LRC_AVG_LOCK_PORT must be a port number/);
  });
});
