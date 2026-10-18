// Moving the intents of the older default folders into the new default (issue #180; src/intents/migrate.ts),
// with temporary folders standing in for %LOCALAPPDATA% and Documents.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MIGRATION_MARKER, migrateIntents, migrateOnce, takeMigrationNotes } from "../src/intents/index.js";

let tmp: string;
let env: NodeJS.ProcessEnv;
let target: string;

const real = () => path.join(tmp, "Local", "LrC-AVG", "intents");
const packaged = (pkg: string) => path.join(tmp, "Local", "Packages", pkg, "LocalCache", "Local", "LrC-AVG", "intents");
function put(dir: string, file: string, text: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, file), text);
}
const text = (dir: string, file: string): string => readFileSync(path.join(dir, file), "utf8");

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "lrcavg-migrate-"));
  env = { LOCALAPPDATA: path.join(tmp, "Local") };
  target = path.join(tmp, "Documents", "LrC-AVG", "intents");
  takeMigrationNotes();
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("intents migration", () => {
  it("copies the intents the new folder lacks from the real folder and every Claude package, and nothing else", () => {
    put(real(), "from_real.json", "real");
    put(real(), "notes.txt", "not an intent");
    put(packaged("Claude_abc"), "from_package.json", "package");
    put(packaged("claude_lower"), "from_lower.json", "lower");
    put(packaged("Other_app"), "other.json", "other");
    const { copied, problem } = migrateIntents(target, env, new Date("2026-10-18T12:00:00Z"));
    expect(problem).toBeUndefined();
    expect(copied).toEqual([
      { file: "from_real.json", from: real() },
      { file: "from_package.json", from: packaged("Claude_abc") },
      { file: "from_lower.json", from: packaged("claude_lower") },
    ]);
    expect(readdirSync(target).sort()).toEqual(["from_lower.json", "from_package.json", "from_real.json", MIGRATION_MARKER]);
    expect(text(target, "from_real.json")).toBe("real");
  });

  it("never overwrites a file in the new folder and never deletes an old one; the first folder wins a name both hold", () => {
    put(target, "mine.json", "mine, new");
    put(real(), "mine.json", "mine, old");
    put(real(), "both.json", "real");
    put(packaged("Claude_abc"), "both.json", "package");
    migrateIntents(target, env);
    expect(text(target, "mine.json")).toBe("mine, new");
    expect(text(target, "both.json")).toBe("real");
    expect(readdirSync(real()).sort()).toEqual(["both.json", "mine.json"]);
    expect(existsSync(path.join(packaged("Claude_abc"), "both.json"))).toBe(true);
  });

  it("writes a marker that lists each file and where it came from, and copies nothing more while it exists", () => {
    put(real(), "a.json", "a");
    migrateIntents(target, env, new Date("2026-10-18T12:00:00Z"));
    expect(text(target, MIGRATION_MARKER)).toBe(
      `Copied by LrC-AVG on 2026-10-18T12:00:00.000Z (issue #180). The old files were left where they are. Delete this file to copy again.\na.json <- ${real()}\n`,
    );
    put(real(), "later.json", "later");
    expect(migrateIntents(target, env).copied).toEqual([]);
    expect(existsSync(path.join(target, "later.json"))).toBe(false);
    rmSync(path.join(target, MIGRATION_MARKER));
    expect(migrateIntents(target, env).copied).toEqual([{ file: "later.json", from: real() }]);
  });

  it("leaves the new folder alone, marker included, when there is nothing to copy", () => {
    expect(migrateIntents(target, env)).toEqual({ copied: [] });
    expect(existsSync(target)).toBe(false);
    expect(migrateIntents(target, {})).toEqual({ copied: [] });
  });

  it("does not copy a folder onto itself", () => {
    put(real(), "a.json", "a");
    expect(migrateIntents(real(), env).copied).toEqual([]);
  });

  it("reports a failure instead of throwing, and keeps what it copied", () => {
    put(real(), "a.json", "a");
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, "a file where the folder should be");
    const result = migrateIntents(target, env);
    expect(result.copied).toEqual([]);
    expect(result.problem).toContain(`into ${target} stopped`);
  });

  it("runs once per folder in a process and reports what it did once", () => {
    put(real(), "a.json", "a");
    migrateOnce(target, env);
    put(real(), "b.json", "b");
    migrateOnce(target, env);
    expect(existsSync(path.join(target, "b.json"))).toBe(false);
    const notes = takeMigrationNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toBe(`Copied 1 intent file(s) into ${target} from the older folders: a.json (from ${real()}). The old files were left where they are.`);
    expect(takeMigrationNotes()).toEqual([]);
  });
});
