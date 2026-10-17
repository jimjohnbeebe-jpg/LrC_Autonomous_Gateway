// THIRD_PARTY_NOTICES.txt and LICENSE.txt for the setup (Phase 9 plan, row 2 "notices file"): the
// project's own notices, Node.js, every staged npm package, sharp's libvips and its libraries, and the
// Rust crates linked into the Deck. Identical license texts are printed once, with the packages using them.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Staged } from "./lock.ts";
import { REPO, RESOURCES } from "./stage.ts";

const LICENSE_FILE = /^(licen[cs]e|copying|notice|copyright)/i;
type Item = { name: string; version: string; license: string; texts: string[] };

/** The texts of a package's license files in `dir` (top level only). */
function licenseTexts(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => LICENSE_FILE.test(f) && !f.endsWith(".rs"))
    .sort()
    .map((f) => readFileSync(path.join(dir, f), "utf8").trim());
}

function npmItems(engine: string, packages: Staged[]): Item[] {
  return packages.map((p) => {
    const dir = path.join(engine, p.to);
    const pkg = z.looseObject({ license: z.string().optional() }).parse(JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")));
    return { name: p.name, version: p.version, license: pkg.license ?? "(not stated)", texts: licenseTexts(dir) };
  });
}

const metaSchema = z.object({
  packages: z.array(z.object({ id: z.string(), name: z.string(), version: z.string(), license: z.string().nullable(), license_file: z.string().nullable(), repository: z.string().nullable(), manifest_path: z.string(), targets: z.array(z.object({ kind: z.array(z.string()) })) })),
  resolve: z.object({ root: z.string(), nodes: z.array(z.object({ id: z.string(), deps: z.array(z.object({ pkg: z.string(), dep_kinds: z.array(z.object({ kind: z.string().nullable() })) })) })) }),
});

/**
 * The crates linked into the Deck: normal dependencies, walked from the Deck's crate for the Windows x64
 * target. Build and dev dependencies and proc-macro crates run only at compile time [inference: Cargo
 * links neither into the binary], so they are not listed.
 */
function rustItems(): Item[] {
  const out = execFileSync("cargo", ["metadata", "--format-version", "1", "--locked", "--filter-platform", "x86_64-pc-windows-msvc", "--manifest-path", path.join(REPO, "hud", "src-tauri", "Cargo.toml")], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const meta = metaSchema.parse(JSON.parse(out));
  const byId = new Map(meta.packages.map((p) => [p.id, p]));
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const todo = [meta.resolve.root];
  for (let id = todo.pop(); id !== undefined; id = todo.pop()) {
    for (const d of nodes.get(id)?.deps ?? []) {
      const p = byId.get(d.pkg);
      if (!p || seen.has(d.pkg) || !d.dep_kinds.some((k) => k.kind === null) || p.targets.some((t) => t.kind.includes("proc-macro"))) continue;
      seen.add(d.pkg);
      todo.push(d.pkg);
    }
  }
  return [...seen].map((id) => byId.get(id)).filter((p) => p !== undefined).sort((a, b) => a.name.localeCompare(b.name)).map((p) => {
    const dir = path.dirname(p.manifest_path);
    const texts = licenseTexts(dir);
    if (p.license_file && existsSync(path.join(dir, p.license_file))) texts.push(readFileSync(path.join(dir, p.license_file), "utf8").trim());
    if (texts.length === 0 && p.repository) texts.push(`(no license file in the crate; see ${p.repository})`);
    return { name: p.name, version: p.version, license: p.license ?? "(not stated)", texts: [...new Set(texts)] };
  });
}

const rule = (title: string): string => `\n\n${"=".repeat(78)}\n${title}\n${"=".repeat(78)}\n\n`;

/** One section: a line per package, then each distinct license text once with the packages that carry it. */
function section(title: string, items: Item[]): string {
  const users = new Map<string, string[]>();
  for (const i of items) for (const t of i.texts) users.set(t, [...(users.get(t) ?? []), `${i.name} ${i.version}`]);
  const ids = new Map([...users.keys()].map((t, n) => [t, n + 1]));
  const lines = items.map((i) => `${i.name} ${i.version}  ${i.license}${i.texts.length ? `  [text ${i.texts.map((t) => ids.get(t)).join(", ")}]` : ""}`);
  const texts = [...users].map(([t, who]) => `--- text ${ids.get(t)}, used by: ${who.join(", ")}\n\n${t}`);
  return rule(title) + lines.join("\n") + "\n\n" + texts.join("\n\n");
}

/** Writes resources\THIRD_PARTY_NOTICES.txt and resources\LICENSE.txt. */
export function writeNotices(version: string, nodeVersion: string, packages: Staged[], cache: Map<string, string>): void {
  const read = (file: string): string => readFileSync(cache.get(file) ?? path.join(REPO, file), "utf8").trim();
  const engine = path.join(RESOURCES, "engine");
  const vips = readFileSync(path.join(engine, "node_modules", "@img", "sharp-win32-x64", "versions.json"), "utf8").trim();
  const parts = [
    `LrC-AVG ${version}: third-party notices\n\nLrC-AVG itself is MIT-licensed (LICENSE.txt). It ships the software below, each under its own license.`,
    rule("1. Parts of the LrC-AVG engine (engine\\THIRD_PARTY_NOTICES.md)") + read(path.join("engine", "THIRD_PARTY_NOTICES.md")),
    rule("2. Parts of the LrC-AVG Lightroom plugin (plugin\\LrC-AVG.lrplugin\\THIRD_PARTY_NOTICES.md)") + read(path.join("plugin", "LrC-AVG.lrplugin", "THIRD_PARTY_NOTICES.md")),
    rule(`3. Node.js ${nodeVersion} (resources\\node\\node.exe)`) + read("node-LICENSE.txt"),
    section("4. npm packages (resources\\engine\\node_modules)", npmItems(engine, packages)),
    // sharp's Windows package is "Apache-2.0 AND LGPL-3.0-or-later" and holds libvips and its libraries as
    // DLLs; the package carries the Apache text only [handle: node_modules\@img\sharp-win32-x64\package.json,
    // its LICENSE file]. Their notices come from the sharp-libvips release sharp 0.35.4 pins (1.3.3,
    // node_modules\sharp\package.json optionalDependencies) [inference: the win32 DLLs are built from it].
    rule("5. libvips and the libraries in @img/sharp-win32-x64 (lib\\*.dll)") +
      `Library versions (versions.json in the package):\n${vips}\n\n` +
      read("sharp-libvips-THIRD-PARTY-NOTICES.md") +
      "\n\nThe GNU Lesser General Public License, version 3, and the GNU General Public License, version 3, which it extends:\n\n" +
      read("lgpl-3.0.txt") + "\n\n" + read("gpl-3.0.txt"),
    section("6. Rust crates linked into LrC-AVG Deck.exe", rustItems()),
  ];
  writeFileSync(path.join(RESOURCES, "THIRD_PARTY_NOTICES.txt"), parts.join("").replace(/\r?\n/g, "\r\n") + "\r\n");
  copyFileSync(path.join(REPO, "LICENSE"), path.join(RESOURCES, "LICENSE.txt"));
}
