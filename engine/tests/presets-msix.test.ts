import { mkdirSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { chatPrompt, judge, presetFolders, presetName, type Place } from "../src/devtools/presets-msix.js";

const place = (kind: Place["kind"], files: string[]): Place => ({ kind, dir: kind === "real" ? "R" : "P", exists: true, files });

describe("presets:msix", () => {
  it("names the preset with 6 hex and puts the name in the prompt", () => {
    expect(presetName()).toMatch(/^AVG msix check [0-9a-f]{6}$/);
    expect(chatPrompt("AVG msix check abc123")).toContain('lr_create_preset_from_active to save the selected photo\'s settings as a Develop preset named "AVG msix check abc123"');
  });

  it("judges where the file landed", () => {
    expect(judge([place("real", ["a.xmp"]), place("package", [])], "a").where).toBe("NOT REDIRECTED");
    expect(judge([place("real", []), place("package", ["a.xmp"])], "a").where).toBe("REDIRECTED");
    expect(judge([place("real", ["a.xmp"]), place("package", ["a.xmp"])], "a").where).toBe("IN BOTH");
    const none = judge([place("real", [])], "a");
    expect([none.where, none.found]).toEqual(["NOT FOUND", false]);
  });

  it("lists the real folder and each Claude package's Roaming copy", () => {
    const local = mkdtempSync(path.join(os.tmpdir(), "presets-msix-"));
    mkdirSync(path.join(local, "Packages", "Claude_abc"), { recursive: true });
    mkdirSync(path.join(local, "Packages", "Other_x"), { recursive: true });
    const dirs = presetFolders({ APPDATA: "A", LOCALAPPDATA: local });
    expect(dirs).toEqual([
      { kind: "real", dir: path.join("A", "Adobe", "CameraRaw", "Settings") },
      { kind: "package", dir: path.join(local, "Packages", "Claude_abc", "LocalCache", "Roaming", "Adobe", "CameraRaw", "Settings") },
    ]);
    expect(presetFolders({ APPDATA: "A", LOCALAPPDATA: path.join(local, "missing") })).toHaveLength(1);
  });
});
