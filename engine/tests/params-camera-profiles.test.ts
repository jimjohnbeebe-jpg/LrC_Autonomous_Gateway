// The committed profile pairs pinned by spikes/S5/pin-profiles.ts from the S5 recordings
// (docs/reports/phase0/S5.md; Phase 0, P-07 and P-17).

import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  isEmptyLook,
  readCameraProfilesFile,
  UnknownCameraProfileError,
} from "../src/params/camera-profiles.js";

const pinnedPath = fileURLToPath(new URL("../src/params/camera-profiles.lrc15.json", import.meta.url));

describe("params: pinned camera profile pairs (S5)", () => {
  const profiles = readCameraProfilesFile(pinnedPath);

  it("holds the 7 Adobe Raw and 15 Nikon Camera Matching profiles S5 captured, and the 2 rendered ones S10 captured", () => {
    const names = profiles.names();
    expect(names).toHaveLength(24);
    expect(names.filter((n) => profiles.get(n).family === "rendered")).toEqual(["Color", "Monochrome"]);
    expect(names.filter((n) => profiles.get(n).family === "adobe").sort()).toEqual([
      "Adobe Color",
      "Adobe Landscape",
      "Adobe Monochrome",
      "Adobe Neutral",
      "Adobe Portrait",
      "Adobe Standard",
      "Adobe Vivid",
    ]);
    expect(names.filter((n) => profiles.get(n).family === "nikon")).toHaveLength(15);
    // "Camera Standard" without "Group: " is the base of Nikon's creative Looks, not a profile.
    expect(names.map((n) => profiles.get(n).camera_profile)).not.toContain("Camera Standard");
  });

  it("writes an Adobe profile as Adobe Standard plus its Look table, without the recorded Camera Raw version (issue #67)", () => {
    const pair = profiles.toSdk("Adobe Landscape");
    expect(pair.CameraProfile).toBe("Adobe Standard");
    expect(pair.Look["Name"]).toBe("Adobe Landscape");
    expect(pair.Look["UUID"]).toBe("6F9C877E84273F4E8271E6B91BEB36A1");
    const params = pair.Look["Parameters"] as Record<string, unknown>;
    expect(params["LookTable"]).toBeTypeOf("string");
    expect(params).not.toHaveProperty("Version");
    expect(profiles.get("Adobe Landscape").look?.Parameters["Version"]).toBe("18.5.1");
  });

  it("writes a Nikon profile as its stored string plus an empty Look", () => {
    expect(profiles.toSdk("Camera Landscape")).toEqual({ CameraProfile: "Camera Landscape", Look: {} });
    expect(profiles.toSdk("Camera Standard")).toEqual({ CameraProfile: "Group: Camera Standard", Look: {} });
    expect(profiles.toSdk("Adobe Standard")).toEqual({ CameraProfile: "Adobe Standard", Look: {} });
  });

  it("returns a copy of the Look, so callers cannot change the pinned table", () => {
    const pair = profiles.toSdk("Adobe Vivid");
    pair.Look["Name"] = "changed";
    expect(profiles.toSdk("Adobe Vivid").Look["Name"]).toBe("Adobe Vivid");
  });

  it("hands out frozen entries from get(), down to the Look parameters", () => {
    const entry = profiles.get("Adobe Landscape");
    expect(Object.isFrozen(entry)).toBe(true);
    expect(() => {
      (entry as { camera_profile: string }).camera_profile = "Camera Vivid";
    }).toThrow(TypeError);
    const parameters = entry.look?.Parameters as Record<string, unknown>;
    expect(() => {
      parameters["Clarity2012"] = 99;
    }).toThrow(TypeError);
    expect(profiles.toSdk("Adobe Landscape").CameraProfile).toBe("Adobe Standard");
  });

  it("marks only the pairs a write test verified: two from S5, both rendered ones from S10", () => {
    const verified = profiles.names().filter((n) => profiles.get(n).write_verified !== null);
    expect(verified.sort()).toEqual(["Adobe Landscape", "Camera Landscape", "Color", "Monochrome"]);
  });

  describe("rendered pipeline (S10)", () => {
    it("writes Color as Embedded, no Look, ConvertToGrayscale false, and Monochrome with it true", () => {
      expect(profiles.toSdk("Color")).toEqual({ CameraProfile: "Embedded", Look: {}, ConvertToGrayscale: false });
      expect(profiles.toSdk("Monochrome")).toEqual({ CameraProfile: "Embedded", Look: {}, ConvertToGrayscale: true });
      expect(profiles.toSdk("Camera Landscape")).not.toHaveProperty("ConvertToGrayscale");
    });

    it("identifies Embedded by the photo's ConvertToGrayscale, and as Color when it is not given", () => {
      expect(profiles.identify("Embedded", [], false).name).toBe("Color");
      expect(profiles.identify("Embedded", {}, true).name).toBe("Monochrome");
      expect(profiles.identify("Embedded", undefined).name).toBe("Color");
      expect(profiles.identify("Embedded", profiles.toSdk("Adobe Color").Look, true).name).toBeNull();
    });

    it("names a raw pair whatever ConvertToGrayscale says: raw profiles do not key on it", () => {
      expect(profiles.identify("Adobe Standard", profiles.toSdk("Adobe Monochrome").Look, true).name).toBe("Adobe Monochrome");
      expect(profiles.identify("Group: Camera Flat", {}, true).name).toBe("Camera Flat");
    });
  });

  it("rejects an unknown profile name with a structured error", () => {
    expect(() => profiles.toSdk("Adobe Landscap")).toThrow(UnknownCameraProfileError);
    expect(() => profiles.get("Camera Toy")).toThrow(
      expect.objectContaining({ code: "unknown_camera_profile", recoverable: false }),
    );
  });

  describe("identify", () => {
    it("names a pinned Adobe pair by CameraProfile and Look UUID", () => {
      const look = profiles.toSdk("Adobe Portrait").Look;
      expect(profiles.identify("Adobe Standard", look)).toEqual({
        name: "Adobe Portrait",
        camera_profile: "Adobe Standard",
        look_name: "Adobe Portrait",
        look_uuid: "D6496412E06A83789C499DF9540AA616",
      });
    });

    it("names a Nikon profile whose Look is absent, [] or {}", () => {
      for (const look of [undefined, null, [], {}]) {
        expect(profiles.identify("Group: Camera Flat", look).name).toBe("Camera Flat");
      }
    });

    it("gives no name to a Nikon profile with an Adobe Look still attached", () => {
      const look = profiles.toSdk("Adobe Color").Look;
      const id = profiles.identify("Camera Landscape", look);
      expect(id.name).toBeNull();
      expect(id.look_name).toBe("Adobe Color");
    });

    it("gives no name to a Look name with an unpinned UUID (the part-1 Adobe Color)", () => {
      const id = profiles.identify("Adobe Standard", { Name: "Adobe Color", UUID: "04FCF287E683E34103866891D7BC669D" });
      expect(id).toEqual({
        name: null,
        camera_profile: "Adobe Standard",
        look_name: "Adobe Color",
        look_uuid: "04FCF287E683E34103866891D7BC669D",
      });
    });
  });

  it("isEmptyLook treats absent, null, [] and {} as no Look", () => {
    expect([undefined, null, [], {}].every(isEmptyLook)).toBe(true);
    expect(isEmptyLook({ Name: "x" })).toBe(false);
  });
});
