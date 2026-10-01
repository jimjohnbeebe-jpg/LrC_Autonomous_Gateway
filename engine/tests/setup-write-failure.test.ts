// A config write that fails part-way (src/setup/apply-config.ts) must not leave a truncated config.
// node:fs is mocked for this file only, so writeFileSync can truncate the file and then throw.

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyDesktopConfig } from "../src/setup/apply-config.js";
import { engineEntry } from "../src/setup/desktop-config.js";

const failWrite = vi.hoisted(() => ({ on: false }));
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  const writeFileSync = (...args: Parameters<typeof fs.writeFileSync>): void => {
    if (failWrite.on) {
      fs.writeFileSync(args[0], '{"mcpServers": {');
      throw new Error("ENOSPC: no space left on device");
    }
    fs.writeFileSync(...args);
  };
  return { ...fs, writeFileSync, default: { ...fs, writeFileSync } };
});

describe("setup: a failed config write", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-writefail-"));
  });
  afterEach(() => {
    failWrite.on = false;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("puts the original back and says so", () => {
    const file = path.join(tmp, "config.json");
    const original = JSON.stringify({ mcpServers: { github: { command: "gh" } } });
    writeFileSync(file, original);
    failWrite.on = true;
    expect(() => applyDesktopConfig({ entry: engineEntry("main.js", "node.exe"), configPath: file })).toThrow(
      /writing the config failed \(ENOSPC: no space left on device\); the original was put back\./,
    );
    expect(readFileSync(file, "utf8")).toBe(original);
    expect(readdirSync(tmp).filter((f) => f.startsWith("config.json.backup-"))).toHaveLength(1);
  });
});
