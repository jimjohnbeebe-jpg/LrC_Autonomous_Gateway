// Staging for `npm run setup:build` (Phase 9 plan D2): the pinned downloads in build\cache\ and the
// setup's resources in build\setup\resources\ (node\, engine\, plugin\), which tauri.setup.conf.json
// bundles as $INSTDIR\resources\.
import { execFileSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { lockSchema, productionPackages, type Staged } from "./lock.ts";

export const REPO = path.resolve(import.meta.dirname, "..", "..");
export const CACHE = path.join(REPO, "build", "cache");
export const SETUP = path.join(REPO, "build", "setup");
export const RESOURCES = path.join(SETUP, "resources");

const pinSchema = z.object({
  node_version: z.string(),
  downloads: z.array(z.object({ file: z.string().regex(/^[\w.-]+$/), url: z.url(), sha256: z.string().regex(/^[0-9a-f]{64}$/) })),
});

export const sha256 = (file: string): string => createHash("sha256").update(readFileSync(file)).digest("hex");

/** Every pinned file in build\cache\, downloaded when missing, each checked against its hash. Returns file -> path. */
export async function fetchPinned(): Promise<{ nodeVersion: string; files: Map<string, string> }> {
  const pin = pinSchema.parse(JSON.parse(readFileSync(path.join(import.meta.dirname, "node-pin.json"), "utf8")));
  mkdirSync(CACHE, { recursive: true });
  const files = new Map<string, string>();
  for (const d of pin.downloads) {
    const file = path.join(CACHE, d.file);
    if (!existsSync(file) || sha256(file) !== d.sha256) {
      console.log(`download ${d.url}`);
      const res = await fetch(d.url);
      if (!res.ok) throw new Error(`${d.url}: HTTP ${res.status}`);
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    }
    const got = sha256(file);
    if (got !== d.sha256) throw new Error(`${d.file}: SHA-256 ${got}, tools\\setup\\node-pin.json pins ${d.sha256}`);
    files.set(d.file, file);
  }
  // node.exe also against the release's own list (SHASUMS256.txt is itself pinned above).
  const sums = readFileSync(files.get("SHASUMS256.txt") ?? "", "utf8");
  const listed = /^([0-9a-f]{64})\s+win-x64\/node\.exe$/m.exec(sums)?.[1];
  if (!listed || listed !== sha256(files.get("node.exe") ?? "")) throw new Error("node.exe does not match win-x64/node.exe in SHASUMS256.txt");
  return { nodeVersion: pin.node_version, files };
}

/** The engine as `npm pack` packs it (engine\package.json "files"), unpacked to resources\engine\. */
function stageEnginePack(): string {
  const work = path.join(SETUP, "work");
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const packed = z.array(z.object({ filename: z.string() })).length(1).parse(
    JSON.parse(execSync(`npm pack --json --pack-destination "${work}"`, { cwd: path.join(REPO, "engine"), encoding: "utf8" })),
  );
  const tar = path.join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "tar.exe"); // bsdtar; Git Bash's GNU tar comes first on PATH (engine\src\devtools\package-cli.ts)
  execFileSync(tar, ["-xf", path.join(work, packed[0]?.filename ?? ""), "-C", work]);
  const engine = path.join(RESOURCES, "engine");
  cpSync(path.join(work, "package"), engine, { recursive: true }); // npm pack puts everything under package\
  return engine;
}

/** The engine's production node_modules, copied from the repo's installed tree, each at its lockfile version. */
function stageEngineModules(engine: string): Staged[] {
  const lock = lockSchema.parse(JSON.parse(readFileSync(path.join(REPO, "package-lock.json"), "utf8")));
  const packages = productionPackages(lock, "engine");
  for (const p of packages) {
    const src = path.join(REPO, p.from);
    const onDisk = z.object({ version: z.string() }).parse(JSON.parse(readFileSync(path.join(src, "package.json"), "utf8"))).version;
    if (onDisk !== p.version) throw new Error(`${p.from} is ${onDisk} on disk, the lockfile pins ${p.version}: run npm ci first`);
    // Its own nested node_modules are staged as packages of their own, production ones only.
    cpSync(src, path.join(engine, p.to), { recursive: true, filter: (f) => path.relative(src, f).split(path.sep)[0] !== "node_modules" });
  }
  if (!packages.some((p) => p.name === "@img/sharp-win32-x64")) throw new Error("@img/sharp-win32-x64 is not staged");
  return packages;
}

/** Stages node.exe, the engine and the plugin; returns the staged npm packages for the notices. */
export function stageResources(nodeExe: string): Staged[] {
  rmSync(RESOURCES, { recursive: true, force: true });
  mkdirSync(path.join(RESOURCES, "node"), { recursive: true });
  cpSync(nodeExe, path.join(RESOURCES, "node", "node.exe"));
  const engine = stageEnginePack();
  const packages = stageEngineModules(engine);
  cpSync(path.join(REPO, "plugin", "LrC-AVG.lrplugin"), path.join(RESOURCES, "plugin", "LrC-AVG.lrplugin"), { recursive: true });
  // Smoke check with the bundled node: sharp loads from the staged tree (its win32 binary and libvips DLLs).
  const vips = execFileSync(path.join(RESOURCES, "node", "node.exe"), ["-e", "process.stdout.write(require('sharp').versions.vips)"], { cwd: engine, encoding: "utf8" });
  console.log(`staged: node.exe, engine (${packages.length} packages, sharp with libvips ${vips}), plugin`);
  return packages;
}

