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
| `sharp` | 0.35.5 | dependency | Apache-2.0 | `>=20.9.0` | https://www.npmjs.com/package/sharp/v/0.35.5 |
| `zod` | 4.6.5 | dependency | MIT | — | https://www.npmjs.com/package/zod/v/4.6.5 |
| `vitest` | 5.0.1 | devDependency | MIT | `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0` | https://www.npmjs.com/package/vitest/v/5.0.1 |
| `typescript` | 7.0.2 | devDependency | Apache-2.0 | `>=16.20.0` | https://www.npmjs.com/package/typescript/v/7.0.2 |
| `@types/node` | 24.13.6 | devDependency | MIT | — | https://www.npmjs.com/package/@types/node/v/24.13.6 |
| `luaparse` | 0.3.1 | devDependency | MIT | — | https://www.npmjs.com/package/luaparse/v/0.3.1 |
| `ws` | 8.22.0 | dependency | MIT | `>=10.0.0` | https://www.npmjs.com/package/ws/v/8.22.0 |
| `@types/ws` | 8.18.2 | devDependency | MIT | — | https://www.npmjs.com/package/@types/ws/v/8.18.2 |

`ws` and `@types/ws` were added in Phase 7 row 3 (2026-10-05) for the HUD channel the engine hosts for the Deck (`engine\src\hud\channel.ts`; vault AVG-014), at the versions spike S9 pinned (below), so npm keeps one copy. 8.22.0 was still the npm `latest` tag [handle: `npm view ws@8.22.0 version license engines` → `8.22.0`, `MIT`, `{ node: '>=10.0.0' }`; `npm view ws dist-tags.latest` → `8.22.0`; `npm view @types/ws@8.18.2 version license` → `8.18.2`, `MIT`; 2026-10-05]. `npm install -E ws@8.22.0 -w engine` and `npm install -E -D @types/ws@8.18.2 -w engine`; `npm ls ws @types/ws` shows both `deduped` for the engine.

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
| `windows` | 0.62.2 | `=0.62.2` (tauri 2.12.1 asks for `^0.62`) | MIT OR Apache-2.0 | https://crates.io/crates/windows/0.62.2 |
| `serde_json` | 1.0.151 | `=1.0.151` | MIT OR Apache-2.0 | https://crates.io/crates/serde_json/1.0.151 |

Toolchain: rustup 1.29.1 (`winget install --id Rustlang.Rustup -e`), rustc 1.99.0 stable-x86_64-pc-windows-msvc, Microsoft C++ Build Tools 2022 [handle: `spikes\S9\prereqs.ps1` output in `docs\reports\phase7\S9-prerun\prerun.txt` section 1]. The first `tauri build --bundles nsis` downloaded NSIS 3.11 and nsis_tauri_utils v0.5.3 from github.com/tauri-apps (tauri-cli output, same file section 2).

## hud (`lrc-avg-hud`, the Deck; Phase 7 row 4b, 2026-10-05)

No new package or crate: the `hud` workspace pins the versions already in the repo. npm: `zod` 4.6.5 (dependency, as the engine), and as devDependencies `@tauri-apps/cli` 2.12.1, `@tauri-apps/api` 2.12.1 (types only, as in S9), `@types/node` 24.13.6, `typescript` 7.0.2 and `vitest` 5.0.1 (as the engine and spikes); links in the tables above. Rust (`hud\src-tauri\Cargo.toml`, `Cargo.lock` committed): the S9 crates and versions above. The `windows` crate gains the `Win32_Security` feature, needed by `CreateMutexW` (the one-Deck mutex, `main.rs`) [handle: rustc error "the item is gated behind the `Win32_Security` feature", windows-0.62.2 `src\Windows\Win32\System\Threading\mod.rs:299-301`], and drops `Win32_UI_Input_KeyboardAndMouse` (S9's drag code only). The tauri-plugin-single-instance crate (spec 3.2) is not added: the named mutex does that job.

**Phase 8.5, fix/deck-relaunch (2026-10-10):** `koffi` 3.3.2 is added to the hud workspace's devDependencies, the version spikes already pins (link in the S9 table above). It is used by the hidden-Deck input probe, `hud\probe\input.ts`: SetCursorPos, mouse_event and WindowFromPoint. As in S9, npm 11 did not run koffi's install script (`npm warn install-scripts koffi@3.3.2` from `npm install`, 2026-10-10). The prebuilt binary loads without it [handle: `node -e "import('./hud/probe/input.ts')…"` printed `dpi true`, the cursor position and a pid, 2026-10-10]. No crate is added: the wake event (`wake.rs`) uses `CreateEventW`, `OpenEventW`, `SetEvent` and `WaitForSingleObject`, all behind the `Win32_System_Threading` feature already enabled [handle: `cargo test` builds and passes `wake::tests`].

## workspace root (`lrc-avg-workspace`; architecture gate, issue #148, 2026-10-12)

| Package | Pinned | Kind | License | `engines.node` | npm registry |
|---|---|---|---|---|---|
| `dependency-cruiser` | 18.6.0 | devDependency | MIT | `^22\|\|^24\|\|>=26` | https://www.npmjs.com/package/dependency-cruiser/v/18.6.0 |
| `@swc/core` | 1.16.18 | devDependency | Apache-2.0 | `>=10` | https://www.npmjs.com/package/@swc/core/v/1.16.18 |

Both were the npm `latest` tag [handle: `npm view dependency-cruiser@18.6.0 version license engines dist-tags.latest` → `18.6.0`, `MIT`, `{ node: '^22||^24||>=26' }`, `18.6.0`; `npm view @swc/core@1.16.18 version license engines dist-tags.latest` → `1.16.18`, `Apache-2.0`, `{ node: '>=10' }`, `1.16.18`; 2026-10-12]. `npm install -D -E` at the root; `npm ls dependency-cruiser @swc/core --depth=0` shows both. They run `npm run arch:check` and `npm run arch:graph` (`.dependency-cruiser.cjs`, CLAUDE.md "Module Map"). dependency-cruiser was set by Jim's directive (issue #148). `@swc/core` is its parser, since dependency-cruiser 18.6.0 reads `.ts` only through `typescript` `>=2.0.0 <7.0.0` and the repo pins 7.0.2. Without a parser it cruised 0 files [handle: `npx depcruise engine/src --no-config --output-type json` → `totalCruised: 0`, typescript `available: false`, 2026-10-12]. Jim chose swc over a second `typescript` 6.0.3 or cruising `engine\dist` [stated: Jim, 2026-10-12, "go with recommendations"]. `@swc/core` loads a prebuilt platform package from its `optionalDependencies` (all twelve are in `package-lock.json`), so CI runs `npm ci --ignore-scripts`.

## setup build downloads (Phase 9 PR 1, 2026-10-17)

No new npm package or crate: `tools\setup\*.ts` use `zod` 4.6.5 from the root `node_modules`, Node built-ins and the existing `@tauri-apps/cli` 2.12.1. `npm run setup:build` downloads these files into `build\cache\` (gitignored) and refuses any whose SHA-256 differs from `tools\setup\node-pin.json`. The hashes were taken 2026-10-17 with `sha256sum` after one download each; node.exe's also equals its `win-x64/node.exe` line in the release's SHASUMS256.txt [handle: `tools\setup\node-pin.json` `_comment`, https://nodejs.org/dist/v24.11.1/SHASUMS256.txt].

| File | Pinned | Used for | URL | SHA-256 |
|---|---|---|---|---|
| `node.exe` | Node 24.11.1 win-x64 | the bundled runtime, `resources\node\node.exe` | https://nodejs.org/dist/v24.11.1/win-x64/node.exe | `f13ac3ca23248dc389507e8fe38c34489ab7edb3e6d6700eb6da6a0b7e128eaf` |
| `SHASUMS256.txt` | Node 24.11.1 | cross-check of node.exe | https://nodejs.org/dist/v24.11.1/SHASUMS256.txt | `ed0ec6c5c648a0489edebf2f21f5913e3d6e469c77d19cb4f50a729b66e77883` |
| `node-LICENSE.txt` | Node 24.11.1 | THIRD_PARTY_NOTICES.txt | https://raw.githubusercontent.com/nodejs/node/v24.11.1/LICENSE | `537308465103a306d0e3eecf42632b4ff1b48aaaec044e9fc10a78c81fd00b34` |
| `lgpl-3.0.txt` | gnu.org | THIRD_PARTY_NOTICES.txt (libvips) | https://www.gnu.org/licenses/lgpl-3.0.txt | `e3a994d82e644b03a792a930f574002658412f62407f5fee083f2555c5f23118` |
| `gpl-3.0.txt` | gnu.org | THIRD_PARTY_NOTICES.txt (LGPL refers to it) | https://www.gnu.org/licenses/gpl-3.0.txt | `3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986` |
| `sharp-libvips-THIRD-PARTY-NOTICES.md` | sharp-libvips v1.3.4 | THIRD_PARTY_NOTICES.txt | https://raw.githubusercontent.com/lovell/sharp-libvips/v1.3.4/THIRD-PARTY-NOTICES.md | `6f0d5086e3bcbee12bcdacf5878b31d1104002aeecaeb241d3fff466108082fe` |

## Notes

- **zod 4 with the MCP SDK:** SDK 1.30.1 declares `zod: "^3.25 || ^4.0"` as dependency and peer (`npm view @modelcontextprotocol/sdk@1.30.1 dependencies peerDependencies`), so zod 4.6.5 is supported. SDK 1.32.0 declares the same (`npm view @modelcontextprotocol/sdk@1.32.0 dependencies peerDependencies`, 2026-10-03).
- **TypeScript 7.0.2** is the npm `latest` tag (`npm view typescript dist-tags` → `latest: 7.0.2`). It is the native-compiled `tsc`, installed through platform packages such as `@typescript/typescript-win32-x64`. `tsc --version` → `Version 7.0.2`, and `npm run build` compiles `engine\src` cleanly. Automaat still pins TS 6 for `typescript` and loads TS 7 as `@typescript/native` (`vendor\automaat\server\package.json:60, 65`), apparently for its ESLint tooling. We have no ESLint yet; revisit if we add typed lint rules.
- **sharp** bundles libvips 8.18.7 since 0.35.5 (`sharp.versions` at runtime, 2026-10-17; 8.18.6 in 0.35.4). With 0.35.4 it could not decode the Z8 NEF fixtures, and it decoded only the 258×172 IFD0 thumbnail of the DxO DNG (see `docs\reports\phase0\S3.md`, "Pre-run findings"). Not rerun on 0.35.5 [unverified]; the engine measures only JPEGs Lightroom rendered, so it does not depend on it. No other decoder is added; this follows the stack rule. 0.35.4 → 0.35.5 on 2026-10-17 for GHSA-wq5f-xc86-pv6w (high, librsvg in libvips) [handle: https://github.com/advisories/GHSA-wq5f-xc86-pv6w, Dependabot alerts #4-#6].
- **Spike scripts run with Node's built-in TypeScript type stripping** (`node file.ts`; confirmed on v24.11.1), so no `tsx`/`ts-node` dependency is needed. This requires erasable-only TS syntax (`erasableSyntaxOnly: true` in both tsconfigs).
- **Workspace layout:** the root `package.json` declares npm workspaces `engine` and `spikes`, so one `npm install` at the repo root installs both.
