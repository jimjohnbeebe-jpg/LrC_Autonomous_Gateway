// The committed key file pinned by spike S5 from live getDevelopSettings() dumps
// (docs/reports/phase0/S5.md). This guards the file against accidental edits: it must load
// through the same validation the engine uses, and keep the keys the S5 run observed. Its third source
// (engine 0.16.0, GitHub issue #59) is Jim's masks capture 1 dump, docs\reports\phase6\masks-capture\3_dump-1.json,
// given to spikes\S5\pin.ts in the S5 shape ({ meta: { spike: "S5", filename, lr_version: "15.6" }, settings }) as
// masks-capture_3_dump-1.json; it adds one key, MaskGroupBasedCorrections (the mask table, params\mask-table.ts).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readSdkKeysFile } from "../src/params/sdk-keys.js";

const pinnedPath = fileURLToPath(new URL("../src/params/sdk-keys.lrc15.json", import.meta.url));

describe("params: pinned LrC 15.5.1 key file (spike S5)", () => {
  const map = readSdkKeysFile(pinnedPath);

  it("loads with 179 keys: the S5 run's 178 and the mask table", () => {
    expect(map.size).toBe(179);
  });

  it("pins the mask table from the masks capture's committed dump", () => {
    const dump = JSON.parse(readFileSync(fileURLToPath(new URL("../../docs/reports/phase6/masks-capture/3_dump-1.json", import.meta.url)), "utf8")) as Record<string, unknown>;
    const entry = map.get("MaskGroupBasedCorrections");
    expect(entry.type).toBe("array");
    expect(entry.sample).toEqual(dump["MaskGroupBasedCorrections"]);
    expect(entry.seen_in).toEqual(["masks-capture_3_dump-1.json"]);
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
