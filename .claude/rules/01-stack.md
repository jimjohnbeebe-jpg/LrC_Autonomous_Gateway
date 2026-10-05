# 01 — Stack

Source: AVG-001 (`C:\Users\jimbe\Documents\Obsidian Vault\Projects\LrC_Autonomous_Gateway\DECISIONS\AVG-001-fork-automaat-no-python.md`), PRD header (`C:\Users\jimbe\Documents\Obsidian Vault\Projects\LrC_Autonomous_Gateway\PRD.md`), ARCHITECTURE §1 (`C:\Users\jimbe\Documents\Obsidian Vault\Projects\LrC_Autonomous_Gateway\ARCHITECTURE.md`).

## Languages

- **Plugin:** Lua (Lightroom Classic SDK), in `plugin\`. Lightroom embeds Lua 5.1 [upstream claim: `vendor\automaat\plugin\LightroomMCP.lrplugin\JSON.lua:22`], so no `goto`, no `//`, no `utf8` library.
- **Engine and every tool script:** TypeScript on Node ≥ 22 (dev machine: v24.11.1).
- **Rust, for the HUD shell only:** the Tauri window (spec `docs\hud\lrc-avg-hud-spec-v2.md` D2; spike `spikes\S9\tauri\src-tauri\`, later `hud\src-tauri\`) [stated: Jim, 2026-10-04, D2: "I am not concerned about the additional language"; vault AVG-013]. Rust owns the window only; the HUD's UI and its channel client are TypeScript. Pin `tauri` to 2.12.x and commit `Cargo.lock`.
- **No Python anywhere** — not in the product, not in tests, not in tooling scripts, not in one-off helpers. If a task seems to need Python, stop and say so. The vendored `vendor\automaat\**\*.py` files are excluded from git and are never run.

## TypeScript

- `strict: true` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `erasableSyntaxOnly` (see `engine\tsconfig.json`).
- **ESM only** (`"type": "module"`, `module`/`moduleResolution: NodeNext`). Relative imports in `engine\src` end in `.js`. Spike scripts that import TS source directly use `.ts` (`allowImportingTsExtensions`, no emit).
- Erasable syntax only: no `enum`, no `namespace`, no constructor parameter properties. That lets Node's type stripping run the scripts directly (`node spikes\S1\measure.ts`).
- Validate every external input (MCP tool args, plugin responses, JSON files) with `zod` at the boundary.
- Tests: `vitest` in `engine\tests\`. `npm run build` (tsc) and `npm test` must pass before every commit.
- Dependencies are pinned exactly. Record every addition or bump in `docs\DEPENDENCIES.md` with its npm registry URL.

## Module size

Source: `C:\Users\jimbe\Documents\Obsidian Vault\Projects\LrC_Autonomous_Gateway\PHASE4_PLAN.md` decisions 6 and 8 [stated: Jim, 2026-09-27].

- **Target:** 300 lines per file and 50 lines per function, the ESLint defaults [handle: https://eslint.org/docs/latest/rules/max-lines, https://eslint.org/docs/latest/rules/max-lines-per-function].
- **Enforced:** `engine\tests\module-size.test.ts` fails any `.ts`, `.js`, `.mjs`, `.lua` or `.rs` file in `engine\src`, `engine\tests`, `plugin\` or `spikes\` over 400 lines (counted as `wc -l` counts). Files already over 400 are listed in that test at their size then: a listed file may not grow, and the next PR that changes it splits it and removes it from the list.
- **Functions over 80 lines** need a stated reason in the PR description. Review checks this, not a test: TypeScript 7 ships no compiler API for a reliable scan [handle: `node -e "console.log(Object.keys(require('typescript')))"` in `engine\` with typescript 7.0.2 printed `[ 'version', 'versionMajorMinor' ]`, 2026-09-27].
- Split a large module before adding to it. Build new modules, check scripts included, small from the start.

## Images

- **`sharp` for all image work:** decode, resize, crop, composite, histograms/metrics, JPEG encode. No other image library, no native decoder, no shelling out to ImageMagick/ExifTool/dcraw.
- sharp cannot read Z8 NEFs (`node spikes\S3\probe-decoders.ts`). Raw decoding is Lightroom's job: the engine only ever measures JPEGs that Lightroom rendered.

## Runtime

- The engine is a stdio MCP server started by Claude Desktop (AVG-002, AVG-004). No network egress; sockets bind to `127.0.0.1` only (PRD NFR-4).
