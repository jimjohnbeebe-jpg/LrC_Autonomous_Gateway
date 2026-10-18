// Where the user intents folder is (issue #180; src/intents/folder.ts): the Documents folder from the
// registry text, the default folder, whether the engine runs virtualized (MSIX) and where a folder under
// AppData really is. Nothing here reads the real registry or touches the real %LOCALAPPDATA%.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectVirtualization, expandEnv, locateFolder, parseRegValue } from "../src/intents/index.js";

// What `reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders" /v Personal` prints.
const REG_OUTPUT = "\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders\r\n    Personal    REG_EXPAND_SZ    %USERPROFILE%\\OneDrive\\Documents\r\n\r\n";

describe("intents folder: the Documents folder from the registry text", () => {
  it("reads a REG_EXPAND_SZ and a REG_SZ value, whatever the letter case of the name", () => {
    expect(parseRegValue(REG_OUTPUT, "Personal")).toBe("%USERPROFILE%\\OneDrive\\Documents");
    expect(parseRegValue("    personal    REG_SZ    D:\\My Docs\\Files  \r\n", "Personal")).toBe("D:\\My Docs\\Files");
  });

  it("finds no value in an error, in another value or in nothing", () => {
    expect(parseRegValue("ERROR: The system was unable to find the specified registry key or value.\r\n", "Personal")).toBeNull();
    expect(parseRegValue("    Desktop    REG_EXPAND_SZ    %USERPROFILE%\\Desktop\r\n", "Personal")).toBeNull();
    expect(parseRegValue("    Personal    REG_DWORD    0x1\r\n", "Personal")).toBeNull();
    expect(parseRegValue("", "Personal")).toBeNull();
  });

  it("expands %NAME% from the variables, whatever their letter case, and gives up on one that is not set", () => {
    expect(expandEnv("%USERPROFILE%\\OneDrive\\Documents", { UserProfile: "C:\\Users\\U" })).toBe("C:\\Users\\U\\OneDrive\\Documents");
    expect(expandEnv("%A%-%B%-%A%", { A: "1", B: "2" })).toBe("1-2-1");
    expect(expandEnv("D:\\Docs", {})).toBe("D:\\Docs");
    expect(expandEnv("%NOPE%\\Documents", { USERPROFILE: "C:\\Users\\U" })).toBeNull();
  });
});

describe("intents folder: virtualization", () => {
  let tmp: string;
  let local: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "lrcavg-folder-"));
    local = path.join(tmp, "Local");
    mkdirSync(local, { recursive: true });
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  /** What Windows does to a packaged engine: the file lands in the package's private folder. */
  const redirected = (pkg: string) => (file: string) => {
    const there = path.join(local, "Packages", pkg, "LocalCache", "Local", "LrC-AVG");
    mkdirSync(there, { recursive: true });
    writeFileSync(path.join(there, path.basename(file)), "");
  };
  const leftovers = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).filter((n) => n.startsWith(".probe-")) : []);

  it("finds the package whose private folder received the probe file, and deletes the probe there", () => {
    mkdirSync(path.join(local, "Packages", "Other_1"), { recursive: true });
    expect(detectVirtualization(local, redirected("Claude_abc123"))).toEqual({ virtualized: true, package: "Claude_abc123" });
    expect(leftovers(path.join(local, "LrC-AVG"))).toEqual([]);
    expect(leftovers(path.join(local, "Packages", "Claude_abc123", "LocalCache", "Local", "LrC-AVG"))).toEqual([]);
  });

  it("finds no virtualization when the probe stays where it was written, and deletes it", () => {
    mkdirSync(path.join(local, "Packages", "Claude_abc123"), { recursive: true });
    expect(detectVirtualization(local)).toEqual({ virtualized: false });
    expect(leftovers(path.join(local, "LrC-AVG"))).toEqual([]);
  });

  it("is not virtualized, and does not throw, when there is no Packages folder or the probe cannot be written", () => {
    expect(detectVirtualization(local)).toEqual({ virtualized: false });
    const other = path.join(tmp, "Other");
    expect(
      detectVirtualization(other, () => {
        throw new Error("denied");
      }),
    ).toEqual({ virtualized: false });
  });

  it("does not throw when the probe file cannot be deleted", () => {
    // a directory where the file should be: rmSync(dir, { force: true }) still throws [handle: node 24.11.1, 2026-10-18, a one-line script printed "throws ERR_FS_EISDIR"]
    expect(detectVirtualization(local, (file) => mkdirSync(file))).toEqual({ virtualized: false });
  });

  it("asks once per process and folder", () => {
    let probes = 0;
    const count = (file: string): void => {
      probes++;
      writeFileSync(file, "");
    };
    detectVirtualization(local, count);
    detectVirtualization(local, count);
    expect(probes).toBe(1);
  });

  describe.runIf(process.platform === "win32")("where a folder really is", () => {
    const env = (): NodeJS.ProcessEnv => ({ LOCALAPPDATA: local, APPDATA: path.join(tmp, "Roaming") });

    it("puts a folder under %LOCALAPPDATA% or %APPDATA% into the package and warns", () => {
      detectVirtualization(local, redirected("Claude_abc123"));
      const cache = path.join(local, "Packages", "Claude_abc123", "LocalCache");
      const inLocal = locateFolder(path.join(local, "LrC-AVG", "intents"), env());
      expect(inLocal).toMatchObject({ real_path: path.join(cache, "Local", "LrC-AVG", "intents"), virtualized: true, package: "Claude_abc123" });
      expect(inLocal.warning).toContain(path.join(cache, "Local", "LrC-AVG", "intents"));
      expect(inLocal.warning).toContain("outside AppData");
      expect(locateFolder(path.join(tmp, "Roaming", "X", "intents"), env()).real_path).toBe(path.join(cache, "Roaming", "X", "intents"));
    });

    it("leaves a folder outside AppData where it says, still saying that the engine is virtualized", () => {
      detectVirtualization(local, redirected("Claude_abc123"));
      const documents = path.join(tmp, "Documents", "LrC-AVG", "intents");
      expect(locateFolder(documents, env())).toEqual({ real_path: documents, virtualized: true, package: "Claude_abc123" });
    });

    it("leaves every folder where it says when the engine is not virtualized", () => {
      detectVirtualization(local);
      const dir = path.join(local, "LrC-AVG", "intents");
      expect(locateFolder(dir, env())).toEqual({ real_path: dir, virtualized: false });
    });
  });
});
