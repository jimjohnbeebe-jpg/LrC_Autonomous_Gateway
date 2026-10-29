// The node_modules the setup bundles (Phase 9 plan row 2, "a test pins the bundled file list"): every
// production package of the engine, at its lockfile version, for win32 x64, as tools/setup/lock.ts
// resolves it from the repo package-lock.json and tools/setup/stage.ts copies it. A dependency added,
// bumped or removed changes this list on purpose: update it in the same PR. The rest of the bundle is
// pinned elsewhere: the engine files by package-check.test.ts (stage.ts unpacks the same npm pack),
// node.exe by tools/setup/node-pin.json (SHA-256), the plugin folder is copied whole.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { lockSchema, productionPackages } from "../../tools/setup/lock.ts";

const lockfile = fileURLToPath(new URL("../../package-lock.json", import.meta.url));

const BUNDLED = [
  "@img/colour@1.1.0",
  "@img/sharp-win32-x64@0.35.5",
  "@modelcontextprotocol/core@2.4.0",
  "@modelcontextprotocol/server@2.4.0",
  "detect-libc@2.1.2",
  "semver@7.8.5",
  "sharp@0.35.5",
  "ws@8.22.0",
  "zod@4.6.6",
];

describe("setup: the bundled engine packages", () => {
  it("are exactly the pinned production packages of the lockfile, no dev packages, no other platform", () => {
    const lock = lockSchema.parse(JSON.parse(readFileSync(lockfile, "utf8")));
    const staged = productionPackages(lock, "engine").map((p) => `${p.to.replace(/^node_modules\//, "")}@${p.version}`);
    expect(staged).toEqual(BUNDLED);
  });

  it("resolves nested copies, drops other platforms and fails on a missing package (made-up lockfile)", () => {
    const lock = lockSchema.parse({
      lockfileVersion: 3,
      packages: {
        engine: { version: "1.0.0", dependencies: { a: "1", sharp: "1" } },
        "node_modules/a": { version: "1.0.0", dependencies: { b: "2" } },
        "node_modules/a/node_modules/b": { version: "2.0.0" },
        "node_modules/b": { version: "1.0.0" },
        "node_modules/dev": { version: "1.0.0" },
        "node_modules/sharp": { version: "1.0.0", optionalDependencies: { "@img/win": "1", "@img/mac": "1" } },
        "node_modules/@img/win": { version: "1.0.0", os: ["win32"], cpu: ["x64"] },
        "node_modules/@img/mac": { version: "1.0.0", os: ["darwin"] },
      },
    });
    expect(productionPackages(lock, "engine").map((p) => `${p.to}@${p.version}`)).toEqual(["node_modules/@img/win@1.0.0", "node_modules/a@1.0.0", "node_modules/a/node_modules/b@2.0.0", "node_modules/sharp@1.0.0"]);
    expect(() => productionPackages(lockSchema.parse({ lockfileVersion: 3, packages: { engine: { dependencies: { gone: "1" } } } }), "engine")).toThrow(/gone/);
  });
});
