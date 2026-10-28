// The pure parts of `npm run presets:check` (devtools\presets-check.ts; issue #215).

import { describe, expect, it } from "vitest";
import { countKinds, pickLightroomPreset, verdict } from "../src/devtools/presets-check.js";

const list = [
  { name: "Warm", folder: "User Presets", scope: "lightroom", uuid: "1", file: "C:\\Users\\a\\AppData\\Roaming\\Adobe\\CameraRaw\\Settings\\Warm.xmp" },
  { name: "Blue Sky", folder: "Adaptive: Sky", scope: "lightroom", uuid: "2" },
  { name: "x v1", folder: "Plugin Develop Presets", scope: "plugin", uuid: "3" },
];

describe("presets:check", () => {
  it("prefers an adaptive sky preset, counts user presets by their folder", () => {
    expect(pickLightroomPreset(list)?.uuid).toBe("2");
    expect(pickLightroomPreset(list.slice(0, 1))?.uuid).toBe("1");
    expect(pickLightroomPreset([])).toBeNull();
    expect(countKinds(list)).toEqual({ lightroom: 2, user: 1, plugin: 1 });
  });

  it("works only with every row and both pass/fail answers y; findings never decide it", () => {
    const rows = [{ step: "a", ok: true, detail: "" }];
    expect(verdict(rows, ["y", "y"], { history: "n" }).worked).toBe(true);
    expect(verdict(rows, ["y", "n"], {}).worked).toBe(false);
    expect(verdict([...rows, { step: "b", ok: false, detail: "" }], ["y", "y"], {}).worked).toBe(false);
    expect(verdict(rows, ["y", "y"], { history: "n" }).lines).toContain("    finding, history: n");
  });
});
