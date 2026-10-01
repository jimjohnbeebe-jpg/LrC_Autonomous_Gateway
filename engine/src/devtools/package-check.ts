// What the engine package must hold (PHASE6_PLAN row 1, decision D3): worked out from the engine's
// own files, so adding a module needs no list kept by hand. `npm run package` (package-cli.ts)
// checks the real `npm pack --json` list against it and keeps no package that differs.
// The package is the built engine and what it reads at run time: every dist\ module outside
// devtools\ (the check harnesses stay in the repo), the param map's JSON files (imported at
// params\index.ts:3-5, so tsc emits them [handle: docs\reports\phase6\package-smoke\smoke.txt, the
// installed list]), the bundled intents (intents\loader.ts bundledIntentsDir), the published JSON
// Schemas, the licence and the third-party notices. No sources, tests or source maps.

const ALWAYS = ["package.json", "LICENSE", "THIRD_PARTY_NOTICES.md"];

/** The package's files, from the engine's file list (paths relative to engine\, with / separators). */
export function expectedPackFiles(engineFiles: string[]): string[] {
  const out = new Set(ALWAYS);
  for (const file of engineFiles) {
    if (file.startsWith("src/devtools/")) continue;
    const src = /^src\/(.+)\.(ts|json)$/.exec(file);
    if (src) out.add(`dist/${src[1] ?? ""}.${src[2] === "ts" ? "js" : "json"}`);
    else if (/^(intents|schemas)\/[^/]+\.json$/.test(file)) out.add(file);
  }
  return [...out].sort();
}

/** Every difference between the packed list and the expected one, as "extra: x" / "missing: y". */
export function packProblems(packed: string[], expected: string[]): string[] {
  const have = new Set(packed);
  const want = new Set(expected);
  return [
    ...[...have].filter((f) => !want.has(f)).sort().map((f) => `extra: ${f}`),
    ...[...want].filter((f) => !have.has(f)).sort().map((f) => `missing: ${f}`),
  ];
}
