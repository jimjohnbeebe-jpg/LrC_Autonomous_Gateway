// Self-check of lock.ts on a made-up lockfile, then on the repo's own: `node tools/setup/lock-check.ts`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { lockSchema, productionPackages } from "./lock.ts";

const lock = lockSchema.parse({
  lockfileVersion: 3,
  packages: {
    "": { name: "root" },
    engine: { version: "1.0.0", dependencies: { a: "1", sharp: "1" }, devDependencies: { dev: "1" } },
    "node_modules/a": { version: "1.0.0", dependencies: { b: "2" } },
    "node_modules/a/node_modules/b": { version: "2.0.0" },
    "node_modules/b": { version: "1.0.0" },
    "node_modules/dev": { version: "1.0.0" },
    "node_modules/sharp": { version: "1.0.0", optionalDependencies: { "@img/win": "1", "@img/mac": "1" }, peerDependencies: { a: "1" } },
    "node_modules/@img/win": { version: "1.0.0", os: ["win32"], cpu: ["x64"], optional: true },
    "node_modules/@img/mac": { version: "1.0.0", os: ["darwin"], optional: true },
  },
});
assert.deepEqual(
  productionPackages(lock, "engine").map((p) => `${p.to}@${p.version}`),
  ["node_modules/@img/win@1.0.0", "node_modules/a@1.0.0", "node_modules/a/node_modules/b@2.0.0", "node_modules/sharp@1.0.0"],
);
assert.throws(() => productionPackages(lockSchema.parse({ lockfileVersion: 3, packages: { engine: { dependencies: { gone: "1" } } } }), "engine"), /gone/);

const repo = path.resolve(import.meta.dirname, "..", "..");
const real = productionPackages(lockSchema.parse(JSON.parse(readFileSync(path.join(repo, "package-lock.json"), "utf8"))), "engine");
assert.ok(real.some((p) => p.name === "@img/sharp-win32-x64"), "the repo lockfile resolves @img/sharp-win32-x64");
console.log(`lock-check: OK (${real.length} production packages for the engine in package-lock.json)`);
