// Spike S9: builds tauri\ui-dist\ (gitignored), the HUD's frontend, with no bundler: Node's own
// type stripping turns ui.ts and ..\channel.ts into JavaScript, and zod's ESM files are copied beside
// them, so the UI validates with the same zod 4.6.5 as the stub. Run by `npm run s9:build -w spikes`.
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire, stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "ui-dist");
const repo = join(here, "..", "..", "..");
const ZOD = "./vendor/zod/index.js";

function strip(src: string, dest: string, imports: Record<string, string>): void {
  let js = stripTypeScriptTypes(readFileSync(src, "utf8"), { mode: "strip" });
  for (const [from, to] of Object.entries(imports)) js = js.replaceAll(`from "${from}"`, `from "${to}"`);
  writeFileSync(dest, js);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "fonts"), { recursive: true });
copyFileSync(join(here, "ui", "index.html"), join(out, "index.html"));
copyFileSync(join(here, "ui", "style.css"), join(out, "style.css"));
copyFileSync(join(repo, "docs", "hud", "fonts", "inter.woff2"), join(out, "fonts", "inter.woff2"));
strip(join(here, "ui", "ui.ts"), join(out, "ui.js"), { "../../channel.ts": "./channel.js" });
strip(join(here, "..", "channel.ts"), join(out, "channel.js"), { zod: ZOD });

// zod's ESM entry is index.js, which imports v4\classic (package.json "exports" ".": "import").
const zodDir = dirname(createRequire(import.meta.url).resolve("zod/package.json"));
mkdirSync(join(out, "vendor", "zod"), { recursive: true });
copyFileSync(join(zodDir, "index.js"), join(out, "vendor", "zod", "index.js"));
cpSync(join(zodDir, "v4"), join(out, "vendor", "zod", "v4"), { recursive: true, filter: (src) => !/\.(ts|cts|cjs|map)$/.test(src) });
console.log(`ui-dist written: ${out}`);
