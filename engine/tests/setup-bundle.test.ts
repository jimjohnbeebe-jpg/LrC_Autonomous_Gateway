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
  "@hono/node-server@2.1.1",
  "@img/colour@1.1.0",
  "@img/sharp-win32-x64@0.35.5",
  "@modelcontextprotocol/sdk@1.32.0",
  "accepts@2.0.0",
  "ajv@8.20.0",
  "ajv-formats@3.0.1",
  "body-parser@2.3.0",
  "body-parser/node_modules/content-type@2.1.0",
  "bytes@3.1.2",
  "call-bind-apply-helpers@1.0.2",
  "call-bound@1.0.4",
  "content-disposition@1.1.0",
  "content-type@1.0.5",
  "cookie@0.7.2",
  "cookie-signature@1.2.2",
  "cors@2.8.6",
  "cross-spawn@7.0.6",
  "debug@4.4.3",
  "depd@2.0.0",
  "detect-libc@2.1.2",
  "dunder-proto@1.0.1",
  "ee-first@1.1.1",
  "encodeurl@2.0.0",
  "es-define-property@1.0.1",
  "es-errors@1.3.0",
  "es-object-atoms@1.1.2",
  "escape-html@1.0.3",
  "etag@1.8.1",
  "eventsource@3.0.7",
  "eventsource-parser@3.1.1",
  "express@5.2.1",
  "express-rate-limit@8.7.0",
  "fast-deep-equal@3.1.3",
  "fast-uri@3.1.8",
  "finalhandler@2.1.1",
  "forwarded@0.2.0",
  "fresh@2.0.0",
  "function-bind@1.1.2",
  "get-intrinsic@1.3.0",
  "get-proto@1.0.1",
  "gopd@1.2.0",
  "has-symbols@1.1.0",
  "hasown@2.0.4",
  "hono@4.13.9",
  "http-errors@2.0.1",
  "iconv-lite@0.7.3",
  "inherits@2.0.4",
  "ip-address@10.7.2",
  "ipaddr.js@1.9.1",
  "is-promise@4.0.0",
  "isexe@2.0.0",
  "jose@6.2.12",
  "json-schema-traverse@1.0.0",
  "json-schema-typed@8.0.2",
  "math-intrinsics@1.1.0",
  "media-typer@1.1.1",
  "merge-descriptors@2.0.0",
  "mime-db@1.54.0",
  "mime-types@3.0.2",
  "ms@2.1.3",
  "negotiator@1.1.0",
  "negotiator/node_modules/content-type@2.1.0",
  "object-assign@4.1.1",
  "object-inspect@1.13.4",
  "on-finished@2.4.1",
  "once@1.4.0",
  "parseurl@1.3.3",
  "path-key@3.1.1",
  "path-to-regexp@8.4.2",
  "pkce-challenge@5.0.1",
  "proxy-addr@2.0.8",
  "qs@6.16.0",
  "range-parser@1.3.0",
  "raw-body@3.0.2",
  "require-from-string@2.0.2",
  "router@2.2.0",
  "safer-buffer@2.1.2",
  "semver@7.8.5",
  "send@1.2.1",
  "serve-static@2.2.1",
  "setprototypeof@1.2.0",
  "sharp@0.35.5",
  "shebang-command@2.0.0",
  "shebang-regex@3.0.0",
  "side-channel@1.1.1",
  "side-channel-list@1.0.1",
  "side-channel-map@1.0.1",
  "side-channel-weakmap@1.0.2",
  "statuses@2.0.2",
  "toidentifier@1.0.1",
  "type-is@2.1.0",
  "type-is/node_modules/content-type@2.1.0",
  "unpipe@1.0.0",
  "vary@1.1.2",
  "which@2.0.2",
  "wrappy@1.0.2",
  "ws@8.22.0",
  "zod@4.6.5",
  "zod-to-json-schema@3.25.2",
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
