import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { I_KNOW, MARKER, throwawayRefusal } from "../src/devtools/throwaway.js";

describe("throwaway-catalog guard (issue #213)", () => {
  let dir = "";
  const catalog = (): string => path.join(dir, "Checks.lrcat");
  const fresh = (): void => {
    dir = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-throwaway-"));
  };
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("refuses a catalog without the marker, and names --i-know", () => {
    fresh();
    expect(throwawayRefusal(catalog(), [])).toMatch(/Checks\.lrcat is not marked.*--i-know/);
  });

  it("runs on a catalog whose marker names it, case aside", () => {
    fresh();
    writeFileSync(path.join(dir, MARKER), JSON.stringify({ catalog: "checks.LRCAT" }));
    expect(throwawayRefusal(catalog(), [])).toBeNull();
  });

  it("refuses when the marker names another catalog in the folder, or is not JSON", () => {
    fresh();
    writeFileSync(path.join(dir, MARKER), JSON.stringify({ catalog: "Other.lrcat" }));
    expect(throwawayRefusal(catalog(), [])).not.toBeNull();
    writeFileSync(path.join(dir, MARKER), "{not json");
    expect(throwawayRefusal(catalog(), [])).not.toBeNull();
  });

  it("asks for a plugin reload when hello has no catalog path, and lets --i-know through either way", () => {
    fresh();
    expect(throwawayRefusal(undefined, [])).toMatch(/Reload Plug-in/);
    expect(throwawayRefusal(undefined, ["node", "x.js", I_KNOW])).toBeNull();
    expect(throwawayRefusal(catalog(), [I_KNOW])).toBeNull();
  });
});
