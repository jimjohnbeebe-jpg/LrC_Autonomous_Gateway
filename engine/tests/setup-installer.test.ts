// `lrc-avg-setup --installer` (src/setup/setup-run.ts, setup-result.ts): the Windows setup reads
// setup-result.json/.txt, never the exit code. Fake LOCALAPPDATA and APPDATA in a temp folder.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONFIG_FILE, SERVER_NAME } from "../src/setup/desktop-config.js";
import { runSetup, type SetupContext } from "../src/setup/setup-run.js";
import { RESULT_JSON, RESULT_TXT, plainLine, setupResultSchema, type SetupResult } from "../src/setup/setup-result.js";

const NODE = "C:\\Program Files\\LrC-AVG\\resources\\node\\node.exe";
const FIXED = new Date("2026-10-17T12:00:00.000Z");

describe("setup: --installer", () => {
  let tmp: string;
  let env: NodeJS.ProcessEnv;
  let dataDir: string;
  let claudeData: string;
  let mainJs: string;
  let ctx: SetupContext;
  const result = (): SetupResult => setupResultSchema.parse(JSON.parse(readFileSync(path.join(dataDir, RESULT_JSON), "utf8")));
  const txt = (): string => readFileSync(path.join(dataDir, RESULT_TXT), "utf8");
  const config = (): unknown => JSON.parse(readFileSync(path.join(claudeData, CONFIG_FILE), "utf8"));
  const run = (...argv: string[]) => runSetup(argv, ctx);

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-installer-"));
    env = { LOCALAPPDATA: path.join(tmp, "local"), APPDATA: path.join(tmp, "roaming") };
    dataDir = path.join(tmp, "local", "LrC-AVG");
    claudeData = path.join(tmp, "local", "Claude-Data", "claude_abc");
    mainJs = path.join(tmp, "engine", "dist", "mcp", "main.js");
    mkdirSync(path.dirname(mainJs), { recursive: true });
    writeFileSync(mainJs, "");
    ctx = { mainJs, execPath: NODE, version: "1.0.0", env, now: () => FIXED };
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("added: writes the entry (this Node plus this engine's main.js) and the result record, exit 0", () => {
    mkdirSync(claudeData, { recursive: true });
    writeFileSync(path.join(claudeData, CONFIG_FILE), JSON.stringify({ mcpServers: { github: { command: "gh" } } }));
    const out = run("--installer");
    expect(out.exitCode).toBe(0);
    expect(out.err).toEqual([]);
    expect(config()).toEqual({ mcpServers: { github: { command: "gh" }, [SERVER_NAME]: { command: NODE, args: [mainJs] } } });
    expect(result()).toEqual({
      time: "2026-10-17T12:00:00.000Z",
      version: "1.0.0",
      action: "add",
      outcome: "added",
      config_path: path.join(claudeData, CONFIG_FILE),
      message: expect.stringContaining("was added to Claude Desktop's config"),
    });
    expect(out.out).toEqual([result().message]);
  });

  it("added: also creates the config in the Claude-Data folder when only the folder is there", () => {
    mkdirSync(claudeData, { recursive: true });
    expect(run("--installer").exitCode).toBe(0);
    expect(result()).toMatchObject({ outcome: "added", config_path: path.join(claudeData, CONFIG_FILE) });
    expect(config()).toEqual({ mcpServers: { [SERVER_NAME]: { command: NODE, args: [mainJs] } } });
  });

  it("unchanged: a second run changes nothing; a stale entry is updated and counts as added", () => {
    mkdirSync(claudeData, { recursive: true });
    run("--installer");
    expect(run("--installer").exitCode).toBe(0);
    expect(result()).toMatchObject({ action: "add", outcome: "unchanged" });
    writeFileSync(path.join(claudeData, CONFIG_FILE), JSON.stringify({ mcpServers: { [SERVER_NAME]: { command: "old" } } }));
    run("--installer");
    expect(result().outcome).toBe("added");
  });

  it("unchanged: removing only the retired S3 server leaves lrc-avg as it was", () => {
    mkdirSync(claudeData, { recursive: true });
    run("--installer");
    const text = JSON.parse(readFileSync(path.join(claudeData, CONFIG_FILE), "utf8")) as { mcpServers: Record<string, unknown> };
    text.mcpServers["lrc-avg-spike-s3"] = { command: "node" };
    writeFileSync(path.join(claudeData, CONFIG_FILE), JSON.stringify(text));
    run("--installer");
    expect(result().outcome).toBe("unchanged");
    expect(Object.keys((config() as typeof text).mcpServers)).toEqual([SERVER_NAME]);
  });

  it("removed, then absent: --installer --remove takes the entry out and says so the second time", () => {
    mkdirSync(claudeData, { recursive: true });
    run("--installer");
    expect(run("--installer", "--remove").exitCode).toBe(0);
    expect(result()).toMatchObject({ action: "remove", outcome: "removed", config_path: path.join(claudeData, CONFIG_FILE) });
    expect(config()).toEqual({ mcpServers: {} });
    run("--installer", "--remove");
    expect(result()).toMatchObject({ action: "remove", outcome: "absent" });
  });

  it("not_found: no Claude Desktop folder; exit 0, nothing written but the result, no config_path", () => {
    for (const argv of [["--installer"], ["--installer", "--remove"]]) {
      const out = run(...argv);
      expect(out.exitCode).toBe(0);
      expect(result()).toMatchObject({ outcome: "not_found", config_path: null, action: argv.length === 1 ? "add" : "remove" });
    }
    expect(existsSync(path.join(tmp, "local", "Claude-Data"))).toBe(false);
  });

  it("remove with the folder but no config file: absent, and no config_path for a file that is not there", () => {
    mkdirSync(claudeData, { recursive: true });
    run("--installer", "--remove");
    expect(result()).toMatchObject({ outcome: "absent", config_path: null });
    expect(existsSync(path.join(claudeData, CONFIG_FILE))).toBe(false);
  });

  it("ambiguous: two config files; none is changed and the message names both", () => {
    const classic = path.join(tmp, "roaming", "Claude");
    mkdirSync(claudeData, { recursive: true });
    mkdirSync(classic, { recursive: true });
    writeFileSync(path.join(claudeData, CONFIG_FILE), "{}");
    writeFileSync(path.join(classic, CONFIG_FILE), "{}");
    expect(run("--installer").exitCode).toBe(0);
    const r = result();
    expect(r.outcome).toBe("ambiguous");
    expect(r.message).toContain(path.join(claudeData, CONFIG_FILE));
    expect(r.message).toContain(path.join(classic, CONFIG_FILE));
    expect(readFileSync(path.join(classic, CONFIG_FILE), "utf8")).toBe("{}");
  });

  it("error: a config that is not JSON is left as it is; exit 0", () => {
    mkdirSync(claudeData, { recursive: true });
    writeFileSync(path.join(claudeData, CONFIG_FILE), "{not json");
    expect(run("--installer").exitCode).toBe(0);
    expect(result()).toMatchObject({ outcome: "error", config_path: null, message: expect.stringContaining("not valid JSON") });
    expect(readFileSync(path.join(claudeData, CONFIG_FILE), "utf8")).toBe("{not json");
  });

  it("error: an engine without its main.js, and arguments the command does not know, still exit 0 with a result", () => {
    mkdirSync(claudeData, { recursive: true });
    rmSync(mainJs);
    expect(run("--installer").exitCode).toBe(0);
    expect(result()).toMatchObject({ outcome: "error", message: expect.stringContaining("the engine is incomplete") });
    expect(existsSync(path.join(claudeData, CONFIG_FILE))).toBe(false);
    expect(run("--installer", "--bogus").exitCode).toBe(0);
    expect(result()).toMatchObject({ outcome: "error", message: expect.stringContaining("unknown argument --bogus") });
    expect(run("--installer", "--dry-run").exitCode).toBe(0);
    expect(result().message).toContain("cannot be combined with --dry-run");
  });

  it("error: even a result folder that cannot be written does not fail the command", () => {
    mkdirSync(path.dirname(dataDir), { recursive: true });
    writeFileSync(dataDir, "a file where the folder should be");
    const out = run("--installer");
    expect(out.exitCode).toBe(0);
    expect(out.err.join(" ")).toContain("could not write the setup result");
  });

  it("deletes the previous run's files first, so a file that is there belongs to this run", () => {
    mkdirSync(claudeData, { recursive: true });
    run("--installer");
    expect(result().outcome).toBe("added");
    rmSync(claudeData, { recursive: true });
    run("--installer");
    expect(result().outcome).toBe("not_found");
  });

  it("writes the .txt as one plain ASCII line the setup can show in a MessageBox", () => {
    mkdirSync(claudeData, { recursive: true });
    run("--installer");
    expect(txt()).toBe(plainLine(result().message));
    expect(txt()).not.toMatch(/[\r\n]/);
    expect(plainLine("a\n  b\r\nc \u00e9")).toBe("a b c ?");
    const classic = path.join(tmp, "roaming", "Claude");
    mkdirSync(classic, { recursive: true });
    writeFileSync(path.join(claudeData, CONFIG_FILE), "{}");
    writeFileSync(path.join(classic, CONFIG_FILE), "{}");
    run("--installer");
    expect(txt()).not.toMatch(/[\r\n]/);
    expect(txt()).toMatch(/^[\x20-\x7e]+$/);
  });

  it("without --installer: the old output and exit codes, and no result files", () => {
    mkdirSync(claudeData, { recursive: true });
    const ok = run();
    expect(ok.exitCode).toBe(0);
    expect(ok.out[0]).toBe(`Claude Desktop config: ${path.join(claudeData, CONFIG_FILE)} (new file)`);
    expect(ok.out).toContain(`"lrc-avg" runs: ${NODE} ${mainJs}`);
    expect(ok.out.at(-1)).toContain("quit Claude Desktop");
    expect(existsSync(path.join(dataDir, RESULT_JSON))).toBe(false);
    const bad = run("--bogus");
    expect(bad).toMatchObject({ exitCode: 1, out: [] });
    expect(bad.err).toEqual([expect.stringContaining("FAILED: unknown argument --bogus"), "Claude Desktop's config was not changed."]);
    expect(run("--config").exitCode).toBe(1);
    rmSync(claudeData, { recursive: true });
    expect(run().exitCode).toBe(1);
    expect(run("--dry-run").exitCode).toBe(1);
  });
});
