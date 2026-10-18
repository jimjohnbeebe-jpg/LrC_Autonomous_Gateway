// That the library's intents folder runs the copy from the older folders (issue #180; settings/folders.ts
// intentsDirMigrating) for the default folder only, never for the environment's or the page's, with
// temporary folders standing in for %LOCALAPPDATA% and Documents.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EngineFolders } from "../src/settings/index.js";

let tmp: string;
let env: NodeJS.ProcessEnv;
let documents: string;
let target: string;
let other: string;

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "lrcavg-folders-"));
  env = { LOCALAPPDATA: path.join(tmp, "Local") };
  documents = path.join(tmp, "Documents");
  target = path.join(documents, "LrC-AVG", "intents");
  other = path.join(tmp, "elsewhere", "intents");
  const old = path.join(tmp, "Local", "LrC-AVG", "intents");
  mkdirSync(old, { recursive: true });
  writeFileSync(path.join(old, "old.json"), "old");
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("settings: the intents folder for the library", () => {
  it("copies the older intents into the default folder", () => {
    expect(new EngineFolders(env, () => documents).intentsDirMigrating()).toBe(target);
    expect(existsSync(path.join(target, "old.json"))).toBe(true);
  });

  it("leaves the older intents alone when the environment names the folder", () => {
    const folders = new EngineFolders({ ...env, LRC_AVG_INTENTS_DIR: other }, () => documents);
    expect(folders.intentsDirMigrating()).toBe(other);
    expect([existsSync(other), existsSync(target)]).toEqual([false, false]);
  });

  it.runIf(process.platform === "win32")("leaves the older intents alone when the settings page names the folder", () => {
    const folders = new EngineFolders(env, () => documents);
    folders.update({ read: true, values: { intents_dir: other } });
    expect(folders.intentsDirMigrating()).toBe(other);
    expect([existsSync(other), existsSync(target)]).toEqual([false, false]);
  });
});
