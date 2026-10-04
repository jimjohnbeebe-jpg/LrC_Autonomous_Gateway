# External sources: where each local copy came from

The spec, the critique and the option notes cite fetched copies as `research/<file>:<line>` (and Microsoft pages as `MS <file>:<line>`). The copies are not in the repo. Each line number refers to the upstream file below, as fetched on 2026-10-04. A `raw.githubusercontent.com` URL on a branch, rather than a tag, may have changed since.

## Microsoft Learn sources (`MS <file>` = `research/md_<file>`)

| Local copy | Upstream |
|---|---|
| `md_evergreen.md` | https://raw.githubusercontent.com/MicrosoftDocs/edge-developer/main/microsoft-edge/webview2/concepts/evergreen-vs-fixed-version.md |
| `md_distribution.md` | https://raw.githubusercontent.com/MicrosoftDocs/edge-developer/main/microsoft-edge/webview2/concepts/distribution.md |
| `md_performance.md` | https://raw.githubusercontent.com/MicrosoftDocs/edge-developer/main/microsoft-edge/webview2/concepts/performance.md |
| `md_process-model.md` | https://raw.githubusercontent.com/MicrosoftDocs/edge-developer/main/microsoft-edge/webview2/concepts/process-model.md |
| `ms_webview2_index.md` (cited as `MS webview2/index.md`) | https://raw.githubusercontent.com/MicrosoftDocs/edge-developer/main/microsoft-edge/webview2/index.md |
| `md_nf-winuser-attachthreadinput.md` | https://raw.githubusercontent.com/MicrosoftDocs/sdk-api/docs/sdk-api-src/content/winuser/nf-winuser-attachthreadinput.md |
| `md_nf-winuser-createwindowexa.md` | https://raw.githubusercontent.com/MicrosoftDocs/sdk-api/docs/sdk-api-src/content/winuser/nf-winuser-createwindowexa.md |
| `md_nf-winuser-setforegroundwindow.md` | https://raw.githubusercontent.com/MicrosoftDocs/sdk-api/docs/sdk-api-src/content/winuser/nf-winuser-setforegroundwindow.md |
| `md_nf-winuser-setparent.md` | https://raw.githubusercontent.com/MicrosoftDocs/sdk-api/docs/sdk-api-src/content/winuser/nf-winuser-setparent.md |
| `md_nf-winuser-setwindowlongptra.md` | https://raw.githubusercontent.com/MicrosoftDocs/sdk-api/docs/sdk-api-src/content/winuser/nf-winuser-setwindowlongptra.md |
| `md_nf-winuser-setwindowpos.md` | https://raw.githubusercontent.com/MicrosoftDocs/sdk-api/docs/sdk-api-src/content/winuser/nf-winuser-setwindowpos.md |
| `md_nf-winuser-setwineventhook.md` | https://raw.githubusercontent.com/MicrosoftDocs/sdk-api/docs/sdk-api-src/content/winuser/nf-winuser-setwineventhook.md |
| `md_nf-winuser-showwindow.md` | https://raw.githubusercontent.com/MicrosoftDocs/sdk-api/docs/sdk-api-src/content/winuser/nf-winuser-showwindow.md |
| `md_event-constants.md` | https://raw.githubusercontent.com/MicrosoftDocs/win32/docs/desktop-src/WinAuto/event-constants.md |
| `md_extended-window-styles.md` | https://raw.githubusercontent.com/MicrosoftDocs/win32/docs/desktop-src/winmsg/extended-window-styles.md |
| `md_window-features.md` | https://raw.githubusercontent.com/MicrosoftDocs/win32/docs/desktop-src/winmsg/window-features.md |
| `dotnet-wpf-Window.xml` | https://raw.githubusercontent.com/dotnet/dotnet-api-docs/main/xml/System.Windows/Window.xml |

## Tauri and tao

| Local copy | Upstream |
|---|---|
| `cfg-2.12.1.rs` | https://raw.githubusercontent.com/tauri-apps/tauri/tauri-v2.12.1/crates/tauri-utils/src/config.rs (tag) |
| `raw_config.rs`, `tauri-config.rs` | https://raw.githubusercontent.com/tauri-apps/tauri/dev/crates/tauri-utils/src/config.rs (branch `dev`) |
| `tag_webview_window.rs` | https://raw.githubusercontent.com/tauri-apps/tauri/tauri-v2.12.1/crates/tauri/src/webview/webview_window.rs (tag) |
| `raw_webview_window.rs` | https://raw.githubusercontent.com/tauri-apps/tauri/dev/crates/tauri/src/webview/webview_window.rs (branch `dev`) |
| `raw_mod.rs` | https://raw.githubusercontent.com/tauri-apps/tauri/dev/crates/tauri/src/window/mod.rs (branch `dev`) |
| `tao_tag_w.rs` | https://raw.githubusercontent.com/tauri-apps/tao/tao-v0.37.1/src/platform_impl/windows/window.rs (tag) |
| `tao_tag_ws.rs` | https://raw.githubusercontent.com/tauri-apps/tao/tao-v0.37.1/src/platform_impl/windows/window_state.rs (tag) |
| `raw_prerequisites.mdx` | https://raw.githubusercontent.com/tauri-apps/tauri-docs/v2/src/content/docs/start/prerequisites.mdx |
| `docs_concept_size.mdx` | https://raw.githubusercontent.com/tauri-apps/tauri-docs/v2/src/content/docs/concept/size.mdx |
| `docs_distribute_windows-installer.mdx` | https://raw.githubusercontent.com/tauri-apps/tauri-docs/v2/src/content/docs/distribute/windows-installer.mdx |
| `docs_plugin_updater.mdx` | https://raw.githubusercontent.com/tauri-apps/tauri-docs/v2/src/content/docs/plugin/updater.mdx |
| `tauriapi/package/…`, `tauri-apps-api-2.12.1.tgz` | `npm pack @tauri-apps/api@2.12.1` |

## Electron, koffi, Node

| Local copy | Upstream |
|---|---|
| `electron/package/…` (`README.md`, `electron.d.ts`, `install.js`), `electron-44.5.1.tgz` | `npm pack electron@44.5.1` |
| `el_process-model.md` (cited as `electron/docs/tutorial/process-model.md`) | https://raw.githubusercontent.com/electron/electron/main/docs/tutorial/process-model.md |
| `el_performance.md` | https://raw.githubusercontent.com/electron/electron/main/docs/tutorial/performance.md |
| `koffi-3.3.2.tgz` | `npm pack koffi@3.3.2` |
| `node-child_process-v22.md` | https://raw.githubusercontent.com/nodejs/node/v22.x/doc/api/child_process.md |
