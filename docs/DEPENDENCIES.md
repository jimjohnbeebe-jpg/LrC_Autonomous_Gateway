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
| `@modelcontextprotocol/sdk` | 1.32.0 | dependency | MIT | `>=18` | https://www.npmjs.com/package/@modelcontextprotocol/sdk/v/1.32.0 |
| `sharp` | 0.35.4 | dependency | Apache-2.0 | `>=20.9.0` | https://www.npmjs.com/package/sharp/v/0.35.4 |
| `zod` | 4.6.5 | dependency | MIT | — | https://www.npmjs.com/package/zod/v/4.6.5 |
| `vitest` | 5.0.1 | devDependency | MIT | `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0` | https://www.npmjs.com/package/vitest/v/5.0.1 |
| `typescript` | 7.0.2 | devDependency | Apache-2.0 | `>=16.20.0` | https://www.npmjs.com/package/typescript/v/7.0.2 |
| `@types/node` | 24.13.6 | devDependency | MIT | — | https://www.npmjs.com/package/@types/node/v/24.13.6 |
| `luaparse` | 0.3.1 | devDependency | MIT | — | https://www.npmjs.com/package/luaparse/v/0.3.1 |

`@modelcontextprotocol/sdk` went from 1.30.1 to 1.32.0 on 2026-10-03 (GitHub issue #60 [stated: Jim, 2026-10-03, "MCP SDK 1.32.0"]), in `engine\package.json` and `spikes\package.json` alike, so npm still keeps one copy. 1.32.0 was the npm `latest` tag, MIT, with `engines.node` `>=18` and `zod` `^3.25 || ^4.0` as dependency and peer [handle: `npm view @modelcontextprotocol/sdk@1.32.0 version license engines dependencies peerDependencies` and `npm view @modelcontextprotocol/sdk dist-tags` → `latest: '1.32.0'`, 2026-10-03]. `npm install` reported 0 vulnerabilities and changed only the SDK's entries in `package-lock.json`; `npm ls @modelcontextprotocol/sdk` shows 1.32.0, `deduped` for the engine.

`luaparse` was added in Phase 1 (2026-09-26) for `engine\tests\lua-plugin.test.ts`, which parses every plugin `.lua` file as Lua 5.1; no Lua runtime runs in the tests. 0.3.1 was the npm `latest` version and its licence is MIT [handle: `npm view luaparse version license` → `0.3.1`, `MIT`, 2026-09-26]. It ships no TypeScript types; `engine\tests\types\luaparse.d.ts` declares the one function the test uses. `npm install -D -E luaparse@0.3.1 -w engine` reported 0 vulnerabilities.

## spikes (`lrc-avg-spikes`, Phase 0 only)

Same pins for `@modelcontextprotocol/sdk`, `sharp`, `zod`, `typescript` and `@types/node`. npm hoists them into one copy (`npm ls` shows `deduped`). No extra packages until spike S9 (below).

### Spike S9 (Phase 7 row 1, 2026-10-04): the Tauri HUD shell

Added to `spikes\package.json` for `spikes\S9\`. Each version was the npm `latest` version, with the licence shown [handle: `npm view <pkg> version` and `npm view <pkg> license`, 2026-10-04]. `npm install -E` (`-D` for the dev dependencies) `-w spikes` installed them. npm 11 did not run koffi's install script (`npm warn install-scripts koffi@3.3.2`); koffi loads its prebuilt `@koromix/koffi-win32-x64` without it [handle: `docs\reports\phase7\S9-prerun\prerun.txt`, every `win32.ts` call in sections 5-8].

| Package | Pinned | Kind | License | npm registry |
|---|---|---|---|---|
| `ws` | 8.22.0 | dependency | MIT | https://www.npmjs.com/package/ws/v/8.22.0 |
| `koffi` | 3.3.2 | devDependency | MIT | https://www.npmjs.com/package/koffi/v/3.3.2 |
| `@tauri-apps/cli` | 2.12.1 | devDependency | Apache-2.0 OR MIT | https://www.npmjs.com/package/@tauri-apps/cli/v/2.12.1 |
| `@tauri-apps/api` | 2.12.1 | devDependency (types only: the UI calls `window.__TAURI__`, `withGlobalTauri`) | Apache-2.0 OR MIT | https://www.npmjs.com/package/@tauri-apps/api/v/2.12.1 |
| `@types/ws` | 8.18.2 | devDependency | MIT | https://www.npmjs.com/package/@types/ws/v/8.18.2 |

Rust crates in `spikes\S9\tauri\src-tauri\Cargo.toml`, resolved in the committed `Cargo.lock`. Licences are from each crate's `Cargo.toml` in the local cargo registry.

| Crate | Version | Pin | License | crates.io |
|---|---|---|---|---|
| `tauri` | 2.12.1 | `=2.12.1` (spec D2: 2.12.x; the index already lists 3.0.0-alpha.4) | Apache-2.0 OR MIT | https://crates.io/crates/tauri/2.12.1 |
| `tauri-build` | 2.7.1 | `=2.7.1` (tauri 2.12.1 asks for `^2.7.1`, crates.io index) | Apache-2.0 OR MIT | https://crates.io/crates/tauri-build/2.7.1 |
| `webview2-com` | 0.39.1 | `=0.39.1`, the version tauri 2.12.1 resolves | MIT | https://crates.io/crates/webview2-com/0.39.1 |
| `windows` | 0.62.2 | `0.62` (tauri 2.12.1 asks for `^0.62`) | MIT OR Apache-2.0 | https://crates.io/crates/windows/0.62.2 |
| `serde_json` | 1.0.151 | `1` | MIT OR Apache-2.0 | https://crates.io/crates/serde_json/1.0.151 |

Toolchain: rustup 1.29.1 (`winget install --id Rustlang.Rustup -e`), rustc 1.99.0 stable-x86_64-pc-windows-msvc, Microsoft C++ Build Tools 2022 [handle: `spikes\S9\prereqs.ps1` output in `docs\reports\phase7\S9-prerun\prerun.txt` section 1]. The first `tauri build --bundles nsis` downloaded NSIS 3.11 and nsis_tauri_utils v0.5.3 from github.com/tauri-apps (tauri-cli output, same file section 2).

## Notes

- **zod 4 with the MCP SDK:** SDK 1.30.1 declares `zod: "^3.25 || ^4.0"` as dependency and peer (`npm view @modelcontextprotocol/sdk@1.30.1 dependencies peerDependencies`), so zod 4.6.5 is supported. SDK 1.32.0 declares the same (`npm view @modelcontextprotocol/sdk@1.32.0 dependencies peerDependencies`, 2026-10-03).
- **TypeScript 7.0.2** is the npm `latest` tag (`npm view typescript dist-tags` → `latest: 7.0.2`). It is the native-compiled `tsc`, installed through platform packages such as `@typescript/typescript-win32-x64`. `tsc --version` → `Version 7.0.2`, and `npm run build` compiles `engine\src` cleanly. Automaat still pins TS 6 for `typescript` and loads TS 7 as `@typescript/native` (`vendor\automaat\server\package.json:60, 65`), apparently for its ESLint tooling. We have no ESLint yet; revisit if we add typed lint rules.
- **sharp** bundles libvips 8.18.6 (`sharp.versions` at runtime). It cannot decode the Z8 NEF fixtures, and it decodes only the 258×172 IFD0 thumbnail of the DxO DNG (see `docs\reports\phase0\S3.md`, "Pre-run findings"). No other decoder is added; this follows the stack rule.
- **Spike scripts run with Node's built-in TypeScript type stripping** (`node file.ts`; confirmed on v24.11.1), so no `tsx`/`ts-node` dependency is needed. This requires erasable-only TS syntax (`erasableSyntaxOnly: true` in both tsconfigs).
- **Workspace layout:** the root `package.json` declares npm workspaces `engine` and `spikes`, so one `npm install` at the repo root installs both.
