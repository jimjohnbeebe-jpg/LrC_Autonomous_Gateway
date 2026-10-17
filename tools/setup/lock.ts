// The engine's production packages, read from the root package-lock.json (Phase 9 plan D2): the setup ships
// exactly the versions the lockfile pins, copied from the repo's installed node_modules, no new download.
// Resolution walks node_modules folders upward from the requiring package, as Node does [handle:
// https://nodejs.org/api/modules.html#loading-from-node_modules-folders]. Optional packages for another
// os/cpu are left out (sharp lists one per platform). Check: `node tools/setup/lock-check.ts`.
import { z } from "zod";

const entrySchema = z.looseObject({
  version: z.string().optional(),
  link: z.boolean().optional(),
  os: z.array(z.string()).optional(),
  cpu: z.array(z.string()).optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  optionalDependencies: z.record(z.string(), z.string()).optional(),
  peerDependencies: z.record(z.string(), z.string()).optional(),
  peerDependenciesMeta: z.record(z.string(), z.object({ optional: z.boolean().optional() })).optional(),
});
export const lockSchema = z.looseObject({ lockfileVersion: z.number().min(2), packages: z.record(z.string(), entrySchema) });
export type Lock = z.infer<typeof lockSchema>;

/** One package to stage: where it is in the lockfile (and the repo), where it goes under the staged engine, its version. */
export type Staged = { from: string; to: string; name: string; version: string };

const parentOf = (location: string): string => {
  const i = location.lastIndexOf("node_modules/");
  return i <= 0 ? "" : location.slice(0, i - 1);
};

/** The lockfile location `name` resolves to from package `location`, or null. */
function resolve(lock: Lock, location: string, name: string): string | null {
  for (let at = location; ; at = parentOf(at)) {
    const candidate = at === "" ? `node_modules/${name}` : `${at}/node_modules/${name}`;
    if (lock.packages[candidate]) return candidate;
    if (at === "") return null;
  }
}

const fits = (list: string[] | undefined, value: string): boolean => !list || list.includes(value);

/**
 * Every production package of workspace `root` (e.g. "engine"), for `os`/`cpu`. Throws on a missing
 * required package, a workspace link, or two packages that would land in one staged folder.
 */
export function productionPackages(lock: Lock, root: string, os = "win32", cpu = "x64"): Staged[] {
  const out = new Map<string, Staged>();
  const byTarget = new Map<string, string>();
  const visit = (location: string): void => {
    const entry = lock.packages[location];
    if (!entry) throw new Error(`no lockfile entry ${location}`);
    const wanted: [string, boolean][] = [
      ...Object.keys(entry.dependencies ?? {}).map((n): [string, boolean] => [n, true]),
      ...Object.keys(entry.optionalDependencies ?? {}).map((n): [string, boolean] => [n, false]),
      ...Object.keys(entry.peerDependencies ?? {}).map((n): [string, boolean] => [n, !entry.peerDependenciesMeta?.[n]?.optional]),
    ];
    for (const [name, required] of wanted) {
      const at = resolve(lock, location, name);
      const dep = at ? lock.packages[at] : undefined;
      if (!at || !dep) {
        if (required) throw new Error(`${location || "root"} needs ${name}, which the lockfile does not hold`);
        continue;
      }
      if (!fits(dep.os, os) || !fits(dep.cpu, cpu) || out.has(at)) continue;
      if (dep.link) throw new Error(`${at} is a workspace link; the setup cannot ship it`);
      const to = at.startsWith(`${root}/`) ? at.slice(root.length + 1) : at;
      const clash = byTarget.get(to);
      if (clash) throw new Error(`${at} and ${clash} would both be staged at ${to}`);
      byTarget.set(to, at);
      out.set(at, { from: at, to, name, version: dep.version ?? "" });
      visit(at);
    }
  };
  visit(root);
  return [...out.values()].sort((a, b) => a.to.localeCompare(b.to));
}
