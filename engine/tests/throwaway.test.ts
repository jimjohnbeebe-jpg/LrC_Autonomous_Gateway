import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BridgeClient } from "../src/bridge/index.js";
import { I_KNOW, MARKER, throwawayPreflight, throwawayRefusal } from "../src/devtools/throwaway.js";
import type { BridgeGate } from "../src/mcp/index.js";

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

  // Greptile, PR #247: a bridge that connects only after the preflight gave up must not reach the check unguarded.
  it("refuses when Lightroom does not connect, and gives the lock back", async () => {
    fresh();
    let released = 0;
    const gate = { ready: () => Promise.reject(new Error("no hello")), release: async () => void released++ } as unknown as BridgeGate;
    const client = { hello: () => ({ catalog_path: catalog() }) } as unknown as BridgeClient;
    expect(await throwawayPreflight(gate, client)).toMatch(/did not connect \(no hello\).*Nothing was written/);
    expect(released).toBe(1);
  });

  // Greptile, PR #247: the probes' catch puts back a pending record, so a refusal thrown inside it would write.
  it("keeps the refusal out of the put-back catch of the probes", () => {
    fresh();
    const dir = path.join(import.meta.dirname, "..", "src", "devtools");
    const probes = readdirSync(dir).filter((f) => f.endsWith("-cli.ts") && readFileSync(path.join(dir, f), "utf8").includes("await back(client, left)"));
    expect(probes.length).toBeGreaterThanOrEqual(4);
    for (const f of probes) expect(readFileSync(path.join(dir, f), "utf8"), f).not.toContain("requireThrowaway(");
  });
});
