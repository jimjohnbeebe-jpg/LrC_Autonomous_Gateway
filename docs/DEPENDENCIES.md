---
document_type: dependency_record
project: LrC_Autonomous_Gateway
authored_by: Claude Code (Opus 5.5), Phase 0 session 2026-09-23
---

# Dependencies (pinned)

Versions are pinned exactly (no `^`/`~`) in `engine\package.json` and `spikes\package.json`. They were chosen on 2026-09-23 as the npm `latest` dist-tag, except `@types/node`, which is held to the Node 24 line to match the runtime. Handle for each "latest": `npm view <pkg> version` on 2026-09-23. Installed versions were confirmed with `npm ls --depth=0 --all` after `npm install` (0 vulnerabilities reported).

Runtime this was built and tested on: Node `v24.11.1`, npm `11.19.1` (Windows 11).

## engine (`lrc-avg`)

| Package | Pinned | Kind | License | `engines.node` | npm registry |
|---|---|---|---|---|---|
| `@modelcontextprotocol/sdk` | 1.30.1 | dependency | MIT | `>=18` | https://www.npmjs.com/package/@modelcontextprotocol/sdk/v/1.30.1 |
| `sharp` | 0.35.4 | dependency | Apache-2.0 | `>=20.9.0` | https://www.npmjs.com/package/sharp/v/0.35.4 |
| `zod` | 4.6.5 | dependency | MIT | — | https://www.npmjs.com/package/zod/v/4.6.5 |
| `vitest` | 5.0.1 | devDependency | MIT | `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0` | https://www.npmjs.com/package/vitest/v/5.0.1 |
| `typescript` | 7.0.2 | devDependency | Apache-2.0 | `>=16.20.0` | https://www.npmjs.com/package/typescript/v/7.0.2 |
| `@types/node` | 24.13.6 | devDependency | MIT | — | https://www.npmjs.com/package/@types/node/v/24.13.6 |
| `luaparse` | 0.3.1 | devDependency | MIT | — | https://www.npmjs.com/package/luaparse/v/0.3.1 |

`luaparse` was added in Phase 1 (2026-09-26) for `engine\tests\lua-plugin.test.ts`, which parses every plugin `.lua` file as Lua 5.1; no Lua runtime runs in the tests. 0.3.1 was the npm `latest` version and its licence is MIT [handle: `npm view luaparse version license` → `0.3.1`, `MIT`, 2026-09-26]. It ships no TypeScript types; `engine\tests\types\luaparse.d.ts` declares the one function the test uses. `npm install -D -E luaparse@0.3.1 -w engine` reported 0 vulnerabilities.

## spikes (`lrc-avg-spikes`, Phase 0 only)

Same pins for `@modelcontextprotocol/sdk`, `sharp`, `zod`, `typescript` and `@types/node`. npm hoists them into one copy (`npm ls` shows `deduped`). No extra packages.

## Notes

- **zod 4 with the MCP SDK:** SDK 1.30.1 declares `zod: "^3.25 || ^4.0"` as dependency and peer (`npm view @modelcontextprotocol/sdk@1.30.1 dependencies peerDependencies`), so zod 4.6.5 is supported.
- **TypeScript 7.0.2** is the npm `latest` tag (`npm view typescript dist-tags` → `latest: 7.0.2`). It is the native-compiled `tsc`, installed through platform packages such as `@typescript/typescript-win32-x64`. `tsc --version` → `Version 7.0.2`, and `npm run build` compiles `engine\src` cleanly. Automaat still pins TS 6 for `typescript` and loads TS 7 as `@typescript/native` (`vendor\automaat\server\package.json:60, 65`), apparently for its ESLint tooling. We have no ESLint yet; revisit if we add typed lint rules.
- **sharp** bundles libvips 8.18.6 (`sharp.versions` at runtime). It cannot decode the Z8 NEF fixtures, and it decodes only the 258×172 IFD0 thumbnail of the DxO DNG (see `docs\reports\phase0\S3.md`, "Pre-run findings"). No other decoder is added; this follows the stack rule.
- **Spike scripts run with Node's built-in TypeScript type stripping** (`node file.ts`; confirmed on v24.11.1), so no `tsx`/`ts-node` dependency is needed. This requires erasable-only TS syntax (`erasableSyntaxOnly: true` in both tsconfigs).
- **Workspace layout:** the root `package.json` declares npm workspaces `engine` and `spikes`, so one `npm install` at the repo root installs both.
