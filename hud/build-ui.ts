// Builds hud\ui-dist\ (gitignored), the Deck's frontend, with no bundler, as spike S9 did: Node's own
// type stripping turns ui\*.ts into JavaScript, the engine's channel schemas come from engine\dist (built
// first by `npm run deck:build`), and zod's ESM files are copied beside them, so the Deck validates with
// the engine's own schemas and zod version (spec 2.7 "From S9").
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire, stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "ui-dist");
const repo = join(here, "..");

function write(dest: string, js: string, imports: Record<string, string>): void {
  for (const [from, to] of Object.entries(imports)) js = js.replaceAll(`from "${from}"`, `from "${to}"`);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, js);
}
const strip = (file: string): string => stripTypeScriptTypes(readFileSync(join(here, "ui", file), "utf8"), { mode: "strip" });
const engine = (file: string): string => readFileSync(join(repo, "engine", "dist", file), "utf8");

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "fonts"), { recursive: true });
copyFileSync(join(here, "ui", "index.html"), join(out, "index.html"));
copyFileSync(join(here, "ui", "style.css"), join(out, "style.css"));
copyFileSync(join(repo, "docs", "hud", "fonts", "inter.woff2"), join(out, "fonts", "inter.woff2"));
write(join(out, "deck.js"), strip("deck.ts"), { "../../engine/src/hud/channel-protocol.ts": "./engine/hud/channel-protocol.js", "./visibility.ts": "./visibility.js" });
write(join(out, "visibility.js"), strip("visibility.ts"), {});
write(join(out, "engine", "hud", "channel-protocol.js"), engine("hud/channel-protocol.js"), { zod: "../../vendor/zod/index.js" });
write(join(out, "engine", "bridge", "hud-protocol.js"), engine("bridge/hud-protocol.js"), { zod: "../../vendor/zod/index.js" });

// zod's ESM entry is index.js, which imports v4\classic (package.json "exports" ".": "import").
const zodDir = dirname(createRequire(import.meta.url).resolve("zod/package.json"));
mkdirSync(join(out, "vendor", "zod"), { recursive: true });
copyFileSync(join(zodDir, "index.js"), join(out, "vendor", "zod", "index.js"));
cpSync(join(zodDir, "v4"), join(out, "vendor", "zod", "v4"), { recursive: true, filter: (src) => !/\.(ts|cts|cjs|map)$/.test(src) });
console.log(`ui-dist written: ${out}`);
