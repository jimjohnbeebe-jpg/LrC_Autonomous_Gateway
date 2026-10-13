// Architecture boundary gate for the TS core, engine\src (issue #148). `npm run arch:check` runs it,
// `npm run arch:graph` draws it. MODULES is the CLAUDE.md "Module Map" as data: each top-level folder of
// engine\src and the modules it may import ("mcp/errors" is the one file of mcp other modules may use).
// Loading this file fails when the two disagree, so the map and the rules cannot drift apart.
// Known violations (existing file cycles) live in .dependency-cruiser-known-violations.json.
const fs = require("node:fs");
const path = require("node:path");

const MODULES = {
  bridge: [],
  params: [],
  metrics: [],
  log: [],
  setup: [],
  intents: ["params"],
  preview: ["bridge", "metrics"],
  settings: ["bridge", "intents", "log", "session"],
  library: ["bridge", "mcp/errors", "preview", "sync"],
  sync: ["bridge", "library", "log", "mcp/errors", "params", "preview", "session"],
  presets: ["bridge", "mcp/errors", "params", "sync"],
  session: ["bridge", "intents", "log", "mcp/errors", "metrics", "params", "preview", "settings"],
  hud: ["bridge", "log", "mcp/errors", "params", "session"],
  mcp: ["bridge", "hud", "intents", "library", "log", "metrics", "params", "presets", "preview", "session", "settings", "sync"],
  devtools: ["bridge", "hud", "intents", "library", "log", "mcp", "metrics", "params", "presets", "preview", "session", "settings", "setup", "sync"],
};

const target = (m) => (m === "mcp/errors" ? "^engine/src/mcp/errors\\.ts$" : `^engine/src/${m}/`);

/** The Module Map table in CLAUDE.md: rows "| `name` | responsibility | `a`, `b` |" ("—" for none). */
function readModuleMap() {
  const text = fs.readFileSync(path.join(__dirname, "CLAUDE.md"), "utf8");
  const section = text.split(/^## Module Map\s*$/m)[1]?.split(/^## /m)[0];
  if (!section) throw new Error("CLAUDE.md has no '## Module Map' section");
  const map = {};
  for (const line of section.split(/\r?\n/)) {
    const cells = line.split("|").map((c) => c.trim());
    const name = /^`([^`]+)`$/.exec(cells[1] ?? "")?.[1];
    if (name) map[name] = [...(cells[3] ?? "").matchAll(/`([^`]+)`/g)].map((x) => x[1]);
  }
  return map;
}

function checkModuleMap() {
  const map = readModuleMap();
  const show = (deps) => (deps ? [...deps].sort().join(", ") || "—" : "(no row)");
  const diff = [...new Set([...Object.keys(map), ...Object.keys(MODULES)])]
    .filter((m) => show(map[m]) !== show(MODULES[m]))
    .map((m) => `  ${m}: CLAUDE.md ${show(map[m])} | config ${show(MODULES[m])}`);
  if (diff.length > 0) {
    throw new Error(
      `CLAUDE.md "Module Map" and .dependency-cruiser.cjs MODULES disagree; update both in the same PR.\n${diff.join("\n")}`,
    );
  }
}

/** Every entry of engine\src is a folder named in MODULES: a module that imports only Node built-ins or npm
 *  packages, or a file directly under engine\src, would otherwise pass the import rules below. */
function checkSourceFolders() {
  const entries = fs.readdirSync(path.join(__dirname, "engine", "src"), { withFileTypes: true });
  const stray = entries.filter((e) => !e.isDirectory() || !Object.hasOwn(MODULES, e.name)).map((e) => e.name);
  if (stray.length > 0) {
    throw new Error(
      `engine/src entries not in the Module Map: ${stray.join(", ")}. A new module needs a CLAUDE.md "Module Map" row ` +
        `and a MODULES entry in .dependency-cruiser.cjs (same PR); files belong inside a module folder.`,
    );
  }
}

checkModuleMap();
checkSourceFolders();

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      comment: "No import cycles between files.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "mcp-errors-only",
      comment: "Outside mcp and devtools, the only part of mcp a module may import is mcp/errors.ts (ToolError).",
      severity: "error",
      from: { path: "^engine/src/", pathNot: "^engine/src/(mcp|devtools)/" },
      to: { path: "^engine/src/mcp/", pathNot: "^engine/src/mcp/errors\\.ts$" },
    },
    {
      name: "no-devtools-import",
      comment: "devtools (dev harnesses, left out of the npm package) is imported by nothing.",
      severity: "error",
      from: { path: "^engine/src/", pathNot: "^engine/src/devtools/" },
      to: { path: "^engine/src/devtools/" },
    },
  ],
  allowed: [
    { comment: "Node built-ins and npm packages.", from: {}, to: { pathNot: "^engine/src/" } },
    ...Object.entries(MODULES).map(([m, deps]) => ({
      comment: `Module Map: ${m}`,
      from: { path: `^engine/src/${m}/` },
      to: { path: [m, ...deps].map(target).join("|") },
    })),
  ],
  allowedSeverity: "error",
  options: {
    // dependency-cruiser 18.6.0 reads .ts only through typescript <7 (we pin 7.0.2); swc parses it and
    // records type-only imports. No tsConfig: the relative ".js" imports resolve the same 1286 edges
    // without it [handle: the PR for issue #148, "Checks run"], and with
    // it dependency-cruiser warns "missing-typescript-transpiler".
    parser: "swc",
    doNotFollow: { path: "node_modules" },
  },
};
