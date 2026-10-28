// `npm run lua:lint` / `npm run lua:test` (issue #213): runs selene or busted on the plugin's Lua when the tool is on
// PATH, and says how to get it when it is not (docs\DEVELOPMENT.md "Lua lint and specs"). CI runs both (lua.yml).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const HOW: Record<string, string> = {
  selene: "selene 0.32.0 is not on PATH. Download selene-0.32.0-windows.zip from https://github.com/Kampfkarren/selene/releases/tag/0.32.0, unzip selene.exe into a folder on PATH, then run this again.",
  busted: "busted is not on PATH. It needs Lua 5.1 and LuaRocks (docs\\DEVELOPMENT.md \"Lua lint and specs\"); CI runs the specs on every PR that touches plugin\\ (.github\\workflows\\lua.yml).",
};

const [tool, ...args] = process.argv.slice(2);
if (tool === undefined || !(tool in HOW)) {
  console.error("usage: node tools/lua-tool.ts selene|busted [args]");
  process.exit(2);
}

// The first match on PATH, with Windows' executable extensions (busted from LuaRocks is a .bat).
const exts = process.platform === "win32" ? (process.env["PATHEXT"] ?? ".EXE;.BAT;.CMD").split(";") : [""];
const found = (process.env["PATH"] ?? "").split(path.delimiter).flatMap((dir) => exts.map((ext) => path.join(dir, tool + ext))).find((f) => existsSync(f));
if (found === undefined) {
  console.error(HOW[tool]);
  process.exit(1);
}
// A .bat or .cmd runs only through the shell; the arguments here are fixed by package.json.
const shell = /\.(bat|cmd)$/i.test(found);
const run = spawnSync(shell ? `"${found}"` : found, args, { stdio: "inherit", shell });
process.exit(run.status ?? 1);
