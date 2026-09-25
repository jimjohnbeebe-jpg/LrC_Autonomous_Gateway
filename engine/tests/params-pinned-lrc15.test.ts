// The committed key file pinned by spike S5 from live getDevelopSettings() dumps
// (docs/reports/phase0/S5.md). This guards the file against accidental edits: it must load
// through the same validation the engine uses, and keep the keys the S5 run observed.

import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readSdkKeysFile } from "../src/params/sdk-keys.js";

const pinnedPath = fileURLToPath(new URL("../src/params/sdk-keys.lrc15.json", import.meta.url));

describe("params: pinned LrC 15.5.1 key file (spike S5)", () => {
  const map = readSdkKeysFile(pinnedPath);

  it("loads with 178 keys", () => {
    expect(map.size).toBe(178);
  });

  it("keeps the keys and types observed in the S5 dumps", () => {
    expect(map.get("Exposure2012").type).toBe("number");
    expect(map.get("CameraProfile").type).toBe("string");
    expect(map.get("Look").type).toBe("object");
    expect(map.get("EnableLensCorrections").type).toBe("boolean");
    expect(map.get("LensProfileEnable").type).toBe("number");
    expect(map.get("ProcessVersion").sample).toBe("15.4");
  });

  it("does not contain the SDK-doc typos", () => {
    for (const typo of ["HueAdjustmentMagenha", "LuminanceAdjustmentAque", "Parametriclights"]) {
      expect(map.has(typo)).toBe(false);
    }
  });
});
