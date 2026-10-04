# LrC-AVG HUD: specification v2

| | |
|---|---|
| Status | Draft. D1-D4 decided by Jim on 2026-10-04, D5 deferred, Q14-Q16 answered the same day (section 2, 13.1). **Nothing is built. Implementation waits for Jim's "go"** [stated: Jim, 2026-10-04, "don't start until I say go, there is a session already in progress in Claude code cli"]. Open: Q17. |
| Replaces | The Grok draft, kept for reference at `docs/hud/source/grok-draft-2026-10-04.md` |
| Written by | Claude Code, 2026-10-04, in a cloud session Jim asked for. The gateway repo was only read. |
| Readers | The Claude Code session that implements this in the LrC-AVG repo, and Jim |

---

## 1. Purpose, scope, sources

### 1.1 Purpose

The HUD is the Lightroom-side view of an edit Claude is making. Photographers glance at it between the photo and the Claude Desktop chat, and use it to step in when the edit needs them: pick, approve, accept or abort (`PRODUCT.md:13`).

Today's HUD is an LrView floating dialog titled "LrC-AVG - Vision Gateway" (`plugin/LrC-AVG.lrplugin/Hud.lua:39`, `:99-116`). In Jim's screenshot it is a light-gray window over the photo. All seven of its buttons have the same weight, and its face carries a settings block and an empty four-column grid.

This spec replaces that surface with a small window in its own process. It keeps three things unchanged:

- the engine's HUD state (`engine/src/hud/payload.ts:28`);
- the four HUD events (`engine/src/bridge/hud-protocol.ts:48`);
- the single control path, `userAction` (`engine/src/session/hud-actions.ts:58`).

Lua stays the only code that writes to the catalog. The HUD sends events; it never calls the SDK.

### 1.2 Scope

**In scope:**

- the window and its behaviour;
- the data channel from the engine;
- the layout choice;
- states, actions, the Changes view, the visual system and copy;
- performance budgets and the S9 spike that measures them;
- acceptance criteria.

**Out of scope:** see section 12.

**Platform:** Windows only. The product is "a Lightroom Classic (Windows) plugin" (`CLAUDE.md:3`).

### 1.3 Sources

- **Gateway repo.** This repository. The spec was written against `main` at 75369b7. `git log --oneline -1` printed `75369b7 feat(catalog): keyword paths, lr_list_keywords, lr_set_gps, MCP SDK 1.32.0 from upstream Automaat (#60; plugin 0.10.0, engine 0.15.0) (#71)`. Section 1.6 lists what changed on `main` up to c2752bc.
- **`PRODUCT.md`.** Jim's answers, 2026-10-03 (`PRODUCT.md:3`).
- **Jim's screenshot** (2026-10-04). It is not in the repo, because it shows family photos. It was used only for Lightroom's chrome, the old HUD's strings and the colour samples in section 8 (`docs/hud/tools/sample.cjs`, `sample2.cjs`). Its photos, names and keywords are not reproduced here.
- **Option notes and mockups:**
  - `docs/hud/option-a/NOTES.md`, `docs/hud/option-b/NOTES.md` and `docs/hud/option-c/NOTES.md`;
  - `docs/hud/mockups/option-{a,b,c}-*.png`.

  They are drawn over a mockup stage (`docs/hud/stage/stage.js`), not over Lightroom, so their geometry is tagged [stage].
- **External sources.** The fetched copies are not in the repo. `docs/hud/research/SOURCES.md` gives each copy's upstream URL, so a handle such as `docs/hud/research/md_evergreen.md:68` resolves to a line of that URL's file.
- **Checks run for this spec:**
  - contrast: `node docs/hud/tools/contrast.cjs '<pairs>'` (section 8);
  - glyph coverage: `node docs/hud/spec-checks/glyphs.cjs` (section 8).

### 1.4 Legend

| Marker | Meaning |
|---|---|
| `(path:line)` | Handle into this repo at 75369b7, or at c2752bc where marked (section 1.6) |
| `[handle: …]` | Any other reproducible handle: a command and its output, a URL, or a file in `docs/hud/` |
| `docs/hud/` | This spec's folder: the mockups, option notes, stage, tools and checks, and `research/SOURCES.md` |
| `MS <file>:n` | Line n of the MicrosoftDocs source of a learn.microsoft.com page. The local copy is `docs/hud/research/md_<file>`. The URL is given at first use. |
| [inference] | Claude's reasoning, not an observation |
| [unverified] | Not confirmed. Must not be relied on until a spike, test or Jim's check confirms it. |
| [stated: Jim, date] | Jim said it |
| [community] | An Adobe forum report, not Adobe documentation |
| [stage] | Measured on the mockup stage, not in Lightroom |
| **proposed** | A new design element of this spec (copy, field or behaviour). It is a proposal, not a fact. |

### 1.5 Corrections to the Grok draft

| Grok draft | Fact | Handle |
|---|---|---|
| Title "LRC-MCP - Vision Gateway", product "LRC-MCP" | "LrC-AVG - Vision Gateway"; product LrC-AVG | `Hud.lua:39`; `CLAUDE.md:1` |
| "Yet connected to Claude." | "Not connected to Claude." | `HudText.lua:67` |
| "50mm" in the identity line | The HUD payload has no focal length. `get_context` reads `focal_length`, but the session keeps only ISO, shutter, aperture and lens. | `hud-protocol.ts:58-67`; `plugin/LrC-AVG.lrplugin/Develop.lua:98`; `engine/src/session/begin.ts:82` |
| "1000 px preview"; "reuse the existing preview export" | The default is 1600 px, quality 75. The engine deletes each preview after reading it. | `plugin/LrC-AVG.lrplugin/Prefs.lua:37-38`; `engine/src/preview/service.ts:5-7` |
| Decay "1, 0.8, 0.4, 0.25" | The default is "1.0, 0.6, 0.4, 0.25" | `Prefs.lua:41` |
| Approve pass = "Keep this pass, becomes the baseline" | The approve_each_pass gate that releases Claude's next `lr_step`. It never lights in autonomous mode, which is the default. | `engine/src/session/approval.ts:1-17`, `:56`; `Prefs.lua:34` |
| Put back = "Revert preview" | No such event exists, and no such button exists on `main` | `hud-protocol.ts:48`; `HudView.lua:200-207` |
| Variant card ringed "In Lightroom" | Variants are separate virtual copies. Pick chooses which copy the edit continues on. | `engine/src/session/variants.ts:1-6`; `hud-actions.ts:12-13` |
| Autonomous treated as an edge case | It is the default and Jim's current setting | `Prefs.lua:34`; Jim's screenshot (not in the repo) settings line |
| "Revert must work on the last applied pass" | There is no per-pass revert. Abort applies the pre-session snapshot. Each pass is a named History step. | `hud-actions.ts:5-9`; `engine/src/session/io.ts:150-151` |
| Hold-to-compare | No event or engine support | `hud-protocol.ts:48` |
| "HUD listens, Lua reconnects, token mode 0600" | Lightroom listens and the engine connects. The token file already exists. 0600 is a POSIX mode [inference: Windows uses ACLs]. | `engine/src/bridge/client.ts:3-6`; `plugin/LrC-AVG.lrplugin/Endpoint.lua:1-10` |
| `requestJpegThumbnail` as the HUD path | Previews come from an LrExportSession export | `preview/service.ts:3-4` |
| Message contract with `bridge`, `claude`, `selectionMatches`, `impact`, `thumb` | The contract is `HudUpdatePayload` | `hud-protocol.ts:83-108` |
| Esc = Stop | In this spec Esc never aborts (section 4.6; A15) | proposed |
| Status dot carries the state | Meaning must never be carried by colour alone | `PRODUCT.md:45` |
| A settings sheet in the HUD | Settings live on the Plug-in Manager page | `CLAUDE.md:18` (AVG-006); `plugin/LrC-AVG.lrplugin/PluginInfoProvider.lua:53-104` |
| Top-right default placement | Covers the Histogram and the Basic panel, where Claude's slider moves show | `docs/hud/mockups/option-a-context-open.png` [stage] |
| "Pinned above Lightroom only" | There is no config or JS option: `parent` takes only another Tauri window. The Rust builder's `owner_raw(HWND)` could make Lightroom's window the owner (`parent_raw(HWND)` is beside it), but that is the cross-process owner relationship rejected in 4.3: it attaches the two threads' input queues. | `@tauri-apps/api` 2.12.1 `window.d.ts:2178-2190` (`npm pack`, `docs/hud/research/tauriapi/`); `raw.githubusercontent.com/tauri-apps/tauri/tauri-v2.12.1/crates/tauri/src/webview/webview_window.rs:718`, `:730` (local copy `docs/hud/research/tag_webview_window.rs`); https://devblogs.microsoft.com/oldnewthing/20130412-00/?p=4683 ("Creating a cross-thread parent/child or owner/owned window relationship implicitly attaches the input queues", read through Tavily on 2026-10-04) |
| macOS parity | The product is Windows-only | `CLAUDE.md:3` |
| "Lightroom is a dark charcoal tool" (#1C1C1C) | Jim's panels are #424242-#474747 with #292929 headers, and his loupe surround is light gray (#d3d3d3) | `docs/hud/tools/sample.cjs`, `docs/hud/tools/sample2.cjs` on Jim's screenshot (not in the repo) |
| "Idle memory under 80 MB" | No source for this figure | [unverified]: no Microsoft or Tauri figure found (`MS performance.md:15`, `:242-244`) |
| Omitted | Guardrail status, the undo path, click-pending feedback, the unknown and "gone" state, and most of the 13 stages | `payload.ts:119-135`; `hud-protocol.ts:24-29`, `:40-43` |

---

### 1.6 Changes on `main` since 75369b7 (checked at c2752bc)

`main` moved on while this spec was written. `git log --oneline -2` printed `c2752bc feat(masks): masks inside editing sessions, AI masks that cannot leave Lightroom stuck (#59; engine 0.16.0, plugin 0.16.0) (#72)`, then 75369b7. The HUD-related changes, all at c2752bc:

| Change | Handle (at c2752bc) | Effect on this spec |
|---|---|---|
| **Put back** (plugin 0.13.0). It is enabled once the open edit's engine has been away 10 s, or the edit is no longer open in Claude. The plugin applies the pre-session snapshot itself, then reports `hud_put_back { outcome }` to the engine. | `plugin/LrC-AVG.lrplugin/Hud.lua:20-25`; `HudState.lua:41` (AWAY_SECONDS = 10), `:198-202` (canPutBack); `engine/src/session/put-back.ts:1-8` | D5 "Put back" and Q14 (answered: keep both). The new HUD's handling of Put back is in D5. |
| New event `hud_put_back` and new payload fields `put_back { photo_uuid, snapshot_id, snapshot_name }` and `close_after` | `engine/src/bridge/hud-protocol.ts:52`, `:117`, `:122`, `:149` | The channel (3.3) carries the same fields. `HUD_PLUGIN` is now 0.13.0 (`engine/src/hud/publisher.ts:35`). |
| **Every end closes the HUD after 10 s**, whoever ended the edit. This supersedes "stays open". | `engine/src/hud/publisher.ts:38` (END_CLOSE_S = 10) [stated: Jim, 2026-10-04, "the HUD did not close automatically after the test"] | 3.2 "End stage" row and Q8: Done shows for 10 s, then the HUD hides. |
| Abort is refused while Lightroom computes an AI mask, with a note | `engine/src/session/hud-actions.ts:136` (ABORT_WAITS) | Shown as an engine note (10.3). No new state. |
| New headlines `stopped`, `putting_back`, and the `PUT_BACK` lines | `plugin/LrC-AVG.lrplugin/HudText.lua:45-46`, `:81` | Copy deck 10.1: these strings are used verbatim. |

Handles elsewhere in this spec still point at 75369b7 unless they say c2752bc. A file that #72 changed may have moved lines (`git diff --stat 75369b7 c2752bc` lists `hud-protocol.ts`, `payload.ts`, `publisher.ts`, `hud-actions.ts`, `Hud.lua`, `HudClick.lua`, `HudState.lua`, `HudText.lua`, `HudView.lua`). The implementer re-reads those files at the then-current `main` before relying on a line number.
## 2. Decisions

Jim decided D1-D4 and deferred D5 on 2026-10-04 [stated: Jim, 2026-10-04]. Each decision below keeps its original options for the record, then says what was decided.

| # | Decision | Status |
|---|---|---|
| D1 | Out-of-process HUD; the classic LrView HUD stays as a fallback, now also a selectable layout (D4) | **Decided: yes** |
| D2 | Runtime: **Tauri v2**, pinned to 2.12.x; spike S9 validates it rather than choosing between runtimes | **Decided** (re-evaluated below) |
| D3 | The engine hosts the HUD channel | **Decided: yes** |
| D4 | All three layouts, chosen on the plugin's settings page; **C "Deck" is the default** | **Decided** (evaluation below) |
| D5 | Engine additions | **Deferred** to a later feature push, except what D3 and the default layout need to work at all (Q15) |
| — | Put back | **Decided: keep both Abort and Put back, using existing functionality** (Q14). See D5. |

The repo rule for decisions: "When a decision belongs to Jim … lay out the options with a recommendation and stop" (`.claude/rules/04-workflow.md`, "STOP markers and decisions").

### D1. Leave LrView for an out-of-process HUD?

| Option | What it means | For | Against |
|---|---|---|---|
| **A. Out-of-process HUD** (recommended) | A separate Windows app window draws the HUD. The classic LrView HUD stays in the plugin, untouched, as the fallback until the new HUD passes section 11. | Placement, size, type, thumbnails and slider rows are all ours. It can show without taking focus (section 4.2). Its data path needs no plugin release (section 3.4); keeping the menu items from opening the classic window does (see "Known conflict" below). | A new runtime and a second process to install (D2). PRODUCT.md principle 5 and its accessibility line must change, and that is Jim's text. |
| B. Stay in LrView and rework the dialog | Reorder the window, take the settings block off the face, show the copies with `catalog_photo` (SDK 4.0), and pass `save_frame` | No new runtime, native controls, and PRODUCT.md stays as written | See the list below. |

What stays wrong with B:

- **No position or no-activate argument.** `presentFloatingDialog` takes only `title`, `contents`, `blockTask`, `save_frame`, `onShow`, `windowWillClose`, `selectionChangeObserver` and `sourceChangeObserver` (`docs/reports/phase5/S8.md:70`; https://lrc.mcor.dev/modules/LrDialogs.html, read through Tavily on 2026-10-04).
- **It takes the keyboard when it opens.** `\` did not reach the main window, in one observation (`S8.md:122`).
- **Slider rows are only partly native.** LrView has a native slider, `viewFactory:slider` (SDK 1.3; `value`, `min`, `max`), that could show a row's after value in Lightroom's own rendering (https://lrc.mcor.dev/modules/LrView.html, read through Tavily on 2026-10-04). Whether it can be shown read-only is [unverified]. The page lists no canvas control [inference: none found on that page], so the before tick and the change segment of section 7 cannot be drawn. So the case against B on slider rows is narrower than the first draft said. The points that still decide against B are focus at open and position (above and below) [inference].
- **Button emphasis.** Whether a `push_button` can be filled or emphasised is [unverified].
- **Floating-dialog z-order changes by version on Windows** [community]:
  - always behind in Full Screen: marked fixed, then reported back. In the same thread drtonyb wrote on Apr 26, 2026 that it was "back again in LrC 15.3 after being fixed in 15.2", and on Apr 27 corrected that to "fixed in LrC 15.1, but back in LrC 15.2", after johnrellis retested 15.1, 15.2 and 15.3 on Windows 11 (https://community.adobe.com/bug-reports-674/p-sdk-floating-dialogs-always-in-back-never-in-front-in-screen-mode-full-screen-on-windows-664457, read through Tavily on 2026-10-04). Behaviour on Jim's LrC 15.6 (`docs/reports/phase6/hud-p1-check/check.txt:116`) is [unverified];
  - forced topmost over other apps from 15.2 (https://community.adobe.com/questions-675/lrdialogs-presentfloatingdialog-forced-topmost-on-windows-starting-in-15-2-regression-vs-15-1-1-macos-unaffected-1559160);
  - will not come to the front in Develop, Book or Print (https://community.adobe.com/questions-675/floating-dialog-will-not-come-to-the-front-when-develop-book-or-print-modules-are-active-1617359).

**Recommendation: A.**

Amendment to `PRODUCT.md`, applied in the PR that adds this spec (Q16), tagged [stated: Jim, 2026-10-04]. The wording below was first proposed here:

- **Principle 5, now** (`PRODUCT.md:40`): "Native first. Use Lightroom's own controls and layout conventions; brevity and order carry the hierarchy, not decoration."
- **Principle 5, proposed:** "**Lightroom-native conventions.** Use Lightroom's words, panel order, slider rendering and panel tones, and sit where Lightroom has free space; brevity and order carry the hierarchy, not decoration."
- **Accessibility line, now** (`PRODUCT.md:45`): "Native LrView controls and Lightroom's text sizes; meaning is never carried by colour alone."
- **Accessibility line, proposed:** "Lightroom's conventions; text at 12 px or larger (11 px only for key hints and captions); every action usable from the keyboard; meaning is never carried by colour alone."

Consequences of A:

- The classic HUD loses no code. It opens by itself, at begin, only when the new HUD is not connected (section 3.4). A menu item also opens it (next bullet).
- **Known conflict: the File > Plug-in Extras items open the classic HUD.** They act on the plugin's own copy of the state (`plugin/LrC-AVG.lrplugin/HudClick.lua:104-132`; `plugin/LrC-AVG.lrplugin/Info.lua:22-34`), and every HUD item opens the classic window to show its outcome:
  - "The HUD opens if it is closed" (`plugin/LrC-AVG.lrplugin/MenuAbort.lua:3`);
  - `Hud.menuEvent` passes `Hud.show` to `HudClick.menuEvent` (`Hud.lua:199-200`), which calls it after every item (`HudClick.lua:130`), because the outcome goes "to the HUD's feedback line (opening the HUD)" (`HudClick.lua:95-96`);
  - "Show Vision Gateway HUD" runs `Hud.show()` (`plugin/LrC-AVG.lrplugin/MenuHud.lua:9`).

  That window takes the keyboard when it opens (`docs/reports/phase5/S8.md:122`, `:185`). So while the new HUD is connected, a menu item pops up a second, focus-taking HUD, and the menu items are not a keyboard path that leaves focus alone.
  - **Fix (proposed, a plugin release):** while the engine reports a connected channel client, the menu items send their event but do not open the classic window. The outcome line goes to the plugin log, and the new HUD shows the resulting state. How the engine tells the plugin is part of the change: a new `hud_update` field needs the lockstep release of section 3.4, or a separate bridge command does the same. Q4 asks whether the "Show Vision Gateway HUD" item should also focus the new HUD.
  - **Recommendation:** take the fix with the first release of the new HUD [inference: without it, using the menu breaks "Never in the way" and "Interrupting", `PRODUCT.md:38`, `:31`]. The alternative is to ship without it and accept the second window as a known issue.

Independent of D1: the classic HUD passes no `save_frame` (`Hud.lua:99-116`), so its position is not kept [inference]. The SDK documents what it stores: "If supplied, a unique key to be used to automatically save the position of the dialog as one of the plug-in settings" (https://lrc.mcor.dev/modules/LrDialogs.html, read through Tavily on 2026-10-04). Adding it is a small plugin change. Whether it works for the floating dialog on Jim's LrC 15.6 on Windows is [unverified]. See open question Q1.

**Decided: A** [stated: Jim, 2026-10-04, "D1: yes, that is fine. See D4."]. The classic HUD becomes one of the layouts on the settings page ("Classic window", D4), so it stays both the fallback and a choice. The menu-item fix above comes with the first plugin release of the new HUD (section 2.6) [proposed; D4 ties it to the layout setting].

### D2. Runtime for the HUD window: Tauri v2 (decided), validated by spike S9

The original comparison, kept for the record (the Contract reuse row is corrected):

| | Tauri v2 (2.12.1) | Electron (44.5.1) | C# shell (WPF or WinUI 3) |
|---|---|---|---|
| Latest version | 2.12.1 [handle: `npm view @tauri-apps/api version` printed 2.12.1; `curl https://index.crates.io/ta/ur/tauri` lists 2.12.1, then 3.0.0-alpha.4] | 44.5.1 [handle: `npm view electron version`] | WPF in .NET [unverified: which .NET the build would target] |
| Languages added to the repo | **Rust.** Stack rule 01 lists Lua and TypeScript only (`.claude/rules/01-stack.md`, "Languages"). | None: the main process runs Node (`raw.githubusercontent.com/electron/electron/main/docs/tutorial/process-model.md:44-45`) | **C#** |
| Show without taking focus | Only the first show, at creation, skips activation. A later `show()` uses SW_SHOW, which activates. So a Rust `ShowWindow(SW_SHOWNA)` is needed [handle: `raw.githubusercontent.com/tauri-apps/tao/tao-v0.37.1/src/platform_impl/windows/window.rs:1265`, `:1415-1419`; `…/window_state.rs:459-465`] | `showInactive()` (`electron.d.ts:3646` in electron 44.5.1, `npm pack`) | `ShowActivated = false` applies to the first show only (`raw.githubusercontent.com/dotnet/dotnet-api-docs/main/xml/System.Windows/Window.xml:2142-2175`); later shows are [unverified] |
| Window handle for Win32 calls | `hwnd()`, Rust only (`raw.githubusercontent.com/tauri-apps/tauri/tauri-v2.12.1/crates/tauri/src/webview/webview_window.rs:1966`) | `getNativeWindowHandle()` (`electron.d.ts:2859`). Win32 calls go through koffi 3.3.2, which ships a prebuilt `@koromix/koffi-win32-x64` [handle: `npm view koffi optionalDependencies`]. No C++ toolchain is needed [inference]. | P/Invoke [inference] |
| Contract reuse | The WebSocket client can live in the TypeScript UI, not in Rust, so the UI imports the engine's zod schemas exactly as an Electron renderer would. Rust handles only the window [inference]. Tauri's `csp` setting must allow `connect-src ws://127.0.0.1:*` (`crates/tauri-utils/src/config.rs:3045` at tag tauri-v2.12.1, `docs/hud/research/cfg-2.12.1.rs`). | Main and UI import the engine's zod schemas (`hud-protocol.ts`) directly [inference] | Schemas are rewritten in C# [inference] |
| Build machine | MSVC Build Tools ("Desktop development with C++") and rustup with the MSVC toolchain (`raw.githubusercontent.com/tauri-apps/tauri-docs/v2/src/content/docs/start/prerequisites.mdx:192-199`, `:242-272`) | Node | .NET SDK [inference] |
| Web engine | The OS's WebView2. Preinstalled on Windows 11 (`MS evergreen.md:68`, https://learn.microsoft.com/microsoft-edge/webview2/concepts/evergreen-vs-fixed-version). Present on "the vast majority" of Windows 10 devices, "a small number … don't" (`MS distribution.md:91`), so the installer must check for it. | Ships its own Chromium: Electron "is based on Node.js and Chromium" (`README.md:9-10` of the electron 44.5.1 package, `docs/hud/research/electron/package/README.md`), and the package's install step downloads the prebuilt `electron` artifact and unpacks it into the package's `dist` folder (`install.js:40-42`, `:76-86`, same folder) | None (XAML). The HTML mockups would be rebuilt [inference]. |
| Footprint (disk, memory) | [unverified]. WebView2 runs a browser process, renderers and helper processes (`MS process-model.md:22-37`), and Microsoft gives no MB figure (`MS performance.md:15`). | [unverified]. No figure in `electron/docs/tutorial/performance.md` (grep). | [unverified] |

**First recommendation (superseded).** The first version of this spec recommended Electron, for three reasons: no new language, one shared zod contract, and `showInactive()` built in.

**Decided: Tauri v2, pinned to 2.12.x** [stated: Jim, 2026-10-04: "We chose Tauri because it is a high performer with a small footprint … I am not concerned about the additional language … this is an open source app and a showcase, performance and appearance are all important, as well as deployability"].

**Re-evaluation against Jim's criteria.**

| Criterion | Tauri v2 | Electron | Verdict |
|---|---|---|---|
| Appearance | Draws with WebView2, which "uses Microsoft Edge as the rendering engine" (`MS webview2/index.md:14`, https://learn.microsoft.com/microsoft-edge/webview2/), and Edge is Chromium (`index.md:76`). An undecorated window with `shadow: true` gets Windows 11's rounded corners (`config.rs`, dev branch, about lines 2136-2144, `docs/hud/research/tauri-config.rs`). | Chromium, bundled (`README.md:9-10`). | **Tie.** The same HTML, CSS, fonts and motion render the same [inference]. |
| Footprint: download and disk | Ships no browser engine. The installer runs Microsoft's WebView2 bootstrapper only when the runtime is missing, which adds 0 MB to the installer by default (`tauri-docs …/distribute/windows-installer.mdx:212`, `:218`; `config.rs:964-1003` at tag tauri-v2.12.1). Tauri's docs say WebView2 ships with Windows 10 (April 2018 or later) and Windows 11 (`windows-installer.mdx:226`); Microsoft says a small number of Windows 10 devices lack it (`MS distribution.md:91`), so keep the default bootstrapper. | Every app ships its own Chromium and Node (`README.md:9-10`; `install.js:40-42`, `:76-86`). | **Tauri**, on structure. No size figure was found for either [unverified]. S9-12 reports it. |
| Runtime: memory, CPU, start | Chromium's multi-process model: a browser process, renderers and helpers (`MS process-model.md:22-37`). The host is a native Rust binary with no JavaScript runtime [inference]. | The same Chromium processes, plus a Node.js main process (`electron/docs/tutorial/process-model.md:44-46`). | **Tauri expected to be equal or better** [inference]. Neither has a published figure [unverified]. S9-1 to S9-5 gate Tauri against the section 9 budgets. |
| Window behaviour (the HUD's hard part) | Show without taking focus, stay on top only while Lightroom is in front, follow Lightroom's window: all Win32 calls, made in-process from Rust through `hwnd()` (`webview_window.rs:1966` at tag tauri-v2.12.1). **Gap:** after creation, tao's `show()` uses SW_SHOW, which activates (tao `window_state.rs:459-465`; `MS nf-winuser-showwindow.md:91`), so the HUD calls `ShowWindow(hwnd, SW_SHOWNA)`, "not activated" (`showwindow.md:94`), itself. | `showInactive()` is built in (`electron.d.ts:3646`). The foreground and location hooks need an FFI library (koffi) from the Node main process [inference]. | **Tauri**, if S9-6 to S9-8 pass on the Win32 path. Risk: tao's own visibility flag no longer matches the window after a direct `ShowWindow` [inference]. So every show and hide goes through the Win32 path, never through Tauri's `show()`/`hide()` [proposed]. |
| Deployability | NSIS `-setup.exe` or MSI (`windows-installer.mdx:11-12`). NSIS can be built on Linux CI; MSI only on Windows (`:14`, `:40`). Authenticode signing through `certificateThumbprint`, `timestampUrl` or `signCommand` (`config.rs:1041-1083` at tag tauri-v2.12.1). An updater plugin whose signatures "cannot be disabled" (`tauri-docs …/plugin/updater.mdx:84-89`). | Mature installer and update tools, with larger artifacts [unverified: not checked this session]. | **Tauri.** Its small artifact can ship beside the plugin zip and the engine tgz on the GitHub release (`npm run package`, CLAUDE.md "Commands") [proposed]. |
| Contract reuse | The UI holds the socket and imports the engine's zod schemas (row above). | The same. | **Tie.** This was one of Electron's three advantages in the first recommendation; it no longer holds. |
| Language and build | Adds Rust: rustup with the MSVC toolchain, plus MSVC Build Tools, on the build machine (`prerequisites.mdx:192-199`, `:242-272`). CI on a Windows runner [proposed]. Pin 2.12.x, since the crates index already lists 3.0.0-alpha.4 (handle in the table above). | No new language. | Jim accepts Rust [stated]. Rule 01 "Languages" gains a line: "Rust for the HUD shell (`hud\src-tauri\`)" [proposed]. |

**Verdict.** On every criterion Jim weighted, Tauri ties or wins. Electron's remaining edges are no Rust, which Jim does not weigh, and a built-in no-activate show, which one Win32 call closes. Window behaviour remains the real risk, and S9 checks it before any layout work.

**What changes in S9.** It becomes a validation spike for Tauri alone, with the same gates. The Electron build is dropped. If a gated row fails, including on the Win32 path, the spike stops and the results go to Jim. There is no automatic fallback to another runtime.

**Spike S9, in the repo's spike style** (`docs/reports/phase5/S8.md` is the model; report format in `.claude/rules/02-sourcing.md`, "Report format"):

- **Purpose:** the S9-1 to S9-12 questions in the table below. Every target is [inference] until measured on Jim's machine.
- **Harness:** under `spikes\S9\`:
  - `stub-engine.ts` serves the HUD channel (section 3.3) with scripted states, with no Claude and no Lightroom writes;
  - `measure.ts` (TypeScript, koffi) reads `GetForegroundWindow`, window rectangles, visibility, z-order, and process-tree memory and CPU times;
  - `tauri\` holds the HUD build, loading the Option C HTML (the default layout, D4).

  Results go to `%TEMP%\LrC-AVG\S9\`. koffi is a new pinned dev dependency, recorded in `docs\DEPENDENCIES.md` (rule 01).
- **Jim's steps:** one PowerShell command, with Lightroom open in Develop. y/n questions are asked in that PowerShell window. Rule 04 allows this when Jim chooses it, and his choice is recorded in the report's Purpose.
- **Go/no-go:** Tauri is a go when it meets every gated row below. A failed gate is a STOP for Jim.

| # | Question | Target [inference] | How it is measured | Gate |
|---|---|---|---|---|
| S9-1 | Cold start: process spawn to first state painted | ≤ 1500 ms, median of 5 | The stub logs the spawn time; the HUD logs the paint time (`requestAnimationFrame` after render) | yes |
| S9-2 | Warm show: a "Your turn" state sent while hidden, to visible and painted | ≤ 150 ms p95 of 20 | Stub send time, then the HUD paint log and `IsWindowVisible` | yes |
| S9-3 | State update to paint while visible | ≤ 100 ms p95 of 100 | As S9-2 | yes |
| S9-4 | Idle memory, hidden, 60 s after the last update | ≤ 150 MB private bytes over the HUD's whole process tree; the host process reported alone too | `GetProcessMemoryInfo` over the tree | yes |
| S9-5 | CPU: hidden, and visible with the working ring pulsing | ≤ 0.5 % and ≤ 2 % of one core over 60 s | `GetProcessTimes` deltas | yes |
| S9-6 | Show without activation | Foreground unchanged on 20 of 20 programmatic shows. Jim: `\` still toggles Before in Develop right after a show, 3 of 3. | `GetForegroundWindow` before and after each show; Jim y/n | yes |
| S9-7 | Topmost only while Lightroom or the HUD is in front | Over 10 switches between Lightroom and Claude Desktop: above Lightroom when it is in front, never above Claude Desktop, each within 250 ms | `EVENT_SYSTEM_FOREGROUND` log plus a z-order check; Jim y/n | yes |
| S9-8 | Follows Lightroom's window: move, resize, minimise, restore, screen modes | In place ≤ 100 ms after the move ends; hidden while Lightroom is minimised | `EVENT_OBJECT_LOCATIONCHANGE` times against the HUD's `SetWindowPos` times | yes |
| S9-9 | Survives its launcher's exit (the stub engine exits) | Still running, and shows the not-connected state with the undo line | Process check; Jim y/n | yes |
| S9-10 | Exits after Lightroom exits | ≤ 5 s | Process check | yes |
| S9-11 | Lightroom stays responsive with the HUD visible and pulsing | Jim: dragging a Basic slider feels no different | Jim y/n | yes |
| S9-12 | Size on disk and download size | Reported | File sizes | no |

S9-9 uses a stub parent. Whether Claude Desktop kills a detached child when it quits is [unverified] (it may use a Windows job object [inference]). The real check is acceptance item A6.

**Decided: Tauri v2** (above). S9 runs before the HUD app is built (section 2.6).

### D3. Data path: where the HUD gets its state

| Option | What it means | For | Against |
|---|---|---|---|
| **A. Engine-hosted HUD channel** (recommended) | The engine that holds the bridge lock listens on 127.0.0.1 and writes `%USERPROFILE%\.lrc-avg\hud_endpoint.json`. The HUD connects. Section 3.3 has the details. | See below. | See below. |
| B. A third LrSocket pair in the plugin | The plugin listens on two more ports (LrSocket only listens: https://lrc.mcor.dev/modules/LrSocket.html, `plugin/LrC-AVG.lrplugin/Sockets.lua:1-6`) and relays state and events to the HUD | It lives as long as Lightroom does, and the plugin sees the selection itself | See below. |

For A:

- One hop from the state's owner (`payload.ts:28`, `engine/src/hud/publisher.ts:88-94`).
- Events go straight into `userAction` (`hud-actions.ts:58`).
- No plugin release for the data path. (The menu-item fix in D1 is a separate plugin change.)
- Thumbnails come from memory (section 3.6).
- Not paused while a Lightroom menu or Plug-in Manager is open. The plugin went silent 11-34 s then (`client.ts:9-13`).
- A Node socket carries both directions.

Against A:

- It lives with Claude Desktop's engine. Between edits the engine gives the bridge back after 60 s (`engine/src/mcp/main.ts:41-46`), and the channel closes then. If Desktop quits mid-edit, the HUD must keep the last state (section 3.2).
- Desktop can run two engines (`main.ts:8-10`), so only the lock holder may host the channel.

Against B:

- A plugin release, plus two more ports (the settings page already has port fields: `Prefs.lua:44-45`).
- Lua would relay state it does not own, and images would have to pass through Lua.
- It pauses with Lightroom's menus (`client.ts:9-13`).
- A send socket did not fire `onClosed` on disconnect (`docs/reports/phase0/PHASE0.md:120`).
- The plugin serves one client per socket pair (`engine/src/mcp/instance-lock.ts:1-3`).

**Recommendation: A.** Section 3 is written for A.

**Decided: A** [stated: Jim, 2026-10-04, "D3: Yes, agreed, engine should host the HUD connection."].

### D4. Layout: all three, chosen on the settings page; C "Deck" by default (decided)

| | A Island | B Rail | C Deck |
|---|---|---|---|
| Files | `docs/hud/option-a/NOTES.md`, `option-a.html`; `docs/hud/mockups/option-a-context.png`, `option-a-context-open.png`, `option-a-states.png` | `docs/hud/option-b/NOTES.md`, `option-b.html`; `docs/hud/mockups/option-b-context.png`, `option-b-context-variants.png`, `option-b-context-collapsed.png`, `option-b-states.png`, `option-b-states-more.png`, `option-b-rows.png` | `docs/hud/option-c/NOTES.md`, `option-c.html`; `docs/hud/mockups/option-c-context.png`, `option-c-context-working.png`, `option-c-states.png` |
| Where | One row in Lightroom's black top band, between the identity plate and the module picker | Over the left panel column (Navigator, Presets, Snapshots, History), in Lightroom's panel chrome | A wide, low bar over the filmstrip band |
| Covers at rest | Nothing: y 65-105 inside the band (top edge 13 px into it), with the photo from y 152 (`option-a/NOTES.md:55`) [stage] | Docked by default: a 284-wide panel whose bottom edge sits at y 900, above Lightroom's Copy... / Paste; in W it is 208 px tall (top y 692), so Snapshots and History stay visible (`option-b/NOTES.md:70`, `:82`, `:108`). The full rail covers the whole left column, including Snapshots and History (`option-b/NOTES.md:65`); it opens only on request or when pinned (`option-b/NOTES.md:110-111`). [stage] | Collapsed, a 44 px bar over the filmstrip header (y 936-980), with every thumbnail still whole. The header controls (source, Filter, arrows) are hidden. (`option-c/NOTES.md` section 1) [stage] |
| On your turn | Widens to hold that turn's actions inline | The docked panel grows upward in place (the sentence, cards and primary appear above Accept and Abort, which do not move); a 2 px strip marks the turn. The rail never changes form by itself (`option-b/NOTES.md:109`). | The 44 px bar carries the turn, its primary action and Abort. The deck opens to 144 px only when the photographer opens it (`option-c/NOTES.md:3`, `:347`). |
| Detail | Drop-down on request (440 x 408-480) [stage] | Richest: changes, undo, settings panels | Opened: pass timeline, This pass and Whole edit side by side, copy cards 368 x 114 (`option-c/NOTES.md:59`) |
| Variants | 54 x 36 chips. They remind you of the copies; they don't let you judge them (`option-a/NOTES.md:454`). | Three cards; the full V column needs 816 px (`option-b/NOTES.md:96`) [stage] | Best fit when opened: 138 x 92 thumbnails, larger than the filmstrip's own (`option-c/NOTES.md:318`). It must show the copies itself, because it hides the filmstrip while open. |
| Abort at rest | Not in the island in W and V: in the details footer (open the details, then Abort), on Ctrl+Backspace, and in the menu (`option-a/NOTES.md:453`; the menu opens the classic HUD today, D1 "Known conflict"). In the island in P, C, T and Problem (`option-a/NOTES.md:165-172`). | Visible | Visible |
| Lightroom geometry it needs | Band height, identity plate and module picker positions. The SDK gives none of these [unverified]. | Left column width and visibility [unverified] | Filmstrip band height and visibility [unverified]. Its three columns need 1816 px of width at full card size [stage]. |
| Native look | Instrument tokens, not LrView | Native tokens, Lightroom panel chrome | Instrument tokens. Square edges, and no window shadow because it is docked (a stated departure, `option-c/NOTES.md` section 1). |
| Extra engine needs | — | — | Per-pass guardrail history for the timeline; new events `hud_show` and `hud_select_target` (`option-c/NOTES.md` section 5, fields 6 and 10) |

**First recommendation (superseded):** A as the only layout, with B's slider rows inside A's details drop-down.

**Decided: build all three, chosen on the plugin's settings page, with C "Deck" as the default** [stated: Jim, 2026-10-04: "I strongly prefer C - but I think that we should implement all three, A, B and C, with a selection choice in the plugin configuration. Evaluate pros and cons - if it is primarily development effort, while functionality is the same, I say we go with it."].

**Is the functionality the same?** Yes, once two gaps are closed. The rest is effort.

| | Same in all three | Differs | Closing the difference |
|---|---|---|---|
| State and events | One state from the engine, the same events (`hud-protocol.ts` HUD_EVENTS), the same enable rules (5.2), copy deck (10) and focused-keyboard map (4.6) | — | — |
| Where things sit | — | A: a row plus a drop-down. B: a docked panel or the full rail. C: a 44 px bar, or the deck opened to 144 px. | Presentation only |
| Judging copies at a pick | — | C: large cards. B: medium cards. A: 54 x 36 chips, which remind but do not let you judge (`option-a/NOTES.md:454`). | **Gap 1.** A's details show C-size copy cards during a pick (answers Q7: yes) [proposed]. |
| What each one covers | — | A covers nothing at rest. B's full rail covers Snapshots and History. C, opened, covers the filmstrip. | B's Undo panel restates the snapshot (`option-b/NOTES.md` Undo panel). C's cards show the copies it hides. Both are already drawn. |
| C's pass timeline | — | Only C draws a per-pass guardrail mark | **Gap 2.** The payload carries only the last pass's guardrail. In v1 the HUD keeps the marks for the passes it saw while connected [inference: the marks are lost after a reconnect]. An engine field comes with D5 later. |

**Costs and risks** (every estimate here is [inference], not measured):

1. **Build effort.** Most of the work is shared, written once:
   - the channel client and view model;
   - the copy deck;
   - the primitives: buttons, chips, slider rows, glyphs;
   - keyboard handling and the Rust window shell.

   Each layout is a renderer, a placement rule and its two forms over that core. Expect each extra layout to cost a fraction of the first, not the same again.
2. **Geometry, three times.** Each layout anchors to a different part of Lightroom: the top band, the left column or the filmstrip. The SDK exposes none of them [unverified] (4.1). Each layout needs:
   - a default position worked out from Lightroom's window rectangle and DPI;
   - a user adjustment, remembered per layout;
   - a floating fallback when that panel is hidden, since Lightroom's panels can be hidden.

   One layout has the same problem; three layouts triple its testing.
3. **Jim's acceptance, three times.** Section 11.1 runs per layout, and Jim's time is the scarcest resource. Shared items (events, focus, undo, stale states) are checked once, on C. Each further layout is checked only on placement, its forms and keyboard focus [proposed].
4. **Ongoing cost.** Every later HUD feature, the D5 items included, needs a place in three layouts. The layout contract below keeps that to one slot per layout, not three features.
5. **Copy length.** A's single row needs short forms ("next shorter form", `option-a/NOTES.md`). One copy deck holds a short form for each slot that needs one.
6. **Visual regression.** The mockup HTML becomes per-layout fixtures. Screenshot tests run the HUD UI against a stub engine in CI, with no Lightroom [proposed].

**Verdict: go.** The differences are effort and test time, not function. That meets Jim's condition.

**Layout contract** (proposed). One view model, built from the engine's state, holds:

- phase and turn sentence;
- step line and note;
- the primary action and its consequence, and the secondary actions;
- the evidence: change rows, or copies;
- the guardrail line, the undo line, the settings summary and the connection.

A layout is a renderer, a placement rule and its two forms. Switching layouts never changes what the engine sees or sends.

**The setting** (proposed, a plugin release). `Prefs.SPECS` gains one line, in the same shape as `mode` (`plugin/LrC-AVG.lrplugin/Prefs.lua:34`):

```lua
{ key = "hudLayout", wire = "hud_layout", kind = "choice", default = "deck", choices = { "deck", "island", "rail", "classic" } },
```

- **Engine side.** The engine's `PAGE_SPECS` (`engine/src/settings/page.ts`) mirrors it. `engine/tests/lua-plugin.test.ts` already keeps the two lists equal (`Prefs.lua:13-15`).
- **Page labels** (proposed copy): "HUD layout: Deck, along the bottom (default) · Island, in the top band · Rail, in the left panel · Classic window".
- **"Classic window"** is today's LrView HUD alone: the new HUD does not start. It is the D1 fallback, made a choice.
- **When a change applies.** `get_prefs` is read at session start (`Prefs.lua:1-3`). The engine also reads it when the bridge connects, so the HUD starts in the right layout [proposed]. A change on the page applies at the next edit, and the page says so [proposed]. Live switching can come later.
- **Menu items** (D1 "Known conflict"). While the layout is not Classic and a HUD client is connected, menu items send their event without opening the classic window. With no client connected, they behave as today, so a HUD that failed to start never leaves the user without controls [proposed].
- **Release order.** The setting and the menu-item fix ship in one plugin release, in lockstep with the engine's `PAGE_SPECS` change (2.6).

**Order of work:** C first, because it is the default and S9 tests it, then A, then B. All three share one core (2.6).

**Decided** (above). Jim may still reorder A and B after C.

### D5. Engine additions, and what is out of scope

Each addition is engine-only and is sent only on the new HUD channel. None of them changes the Lua `hud_update` (section 3.4).

| # | Addition | Why | The data exists | Recommendation |
|---|---|---|---|---|
| E1 | HUD channel listener and the `hud_endpoint.json` file | D3-A | The lock is taken and released in `engine/src/mcp/bridge-gate.ts` and `main.ts:60-68` | yes |
| E2 | A fan-out sink: every state goes to the bridge publisher and to the channel. `open: true` goes to the classic HUD only when no channel client is connected. | One state, two surfaces, automatic fallback | `HudSink` (`engine/src/session/types.ts:86`), implemented by `HudPublisher` (`publisher.ts:60`); the open flag (`publisher.ts:88-90`) | yes |
| E3 | `copies[]`: letter, intent label ("natural"), copy name, uuid, pass, thumbnail key, guardrail; plus `picked` | Chips and cards. Accept is off in Variants until a pick. | `label` (`engine/src/session/types.ts:148-149`); copy names `AVG <intent> <letter>` (`engine/src/session/copies.ts:50-51`); `s.picked` (`hud-actions.ts:183`) | yes |
| E4 | Thumbnails from each copy's in-memory last render | Section 3.6 | `Rendered.jpeg` and `.hash` (`types.ts:131-136`); `v.last.jpeg` (`variants.ts:107-109`) | yes |
| E5 | `whole_edit` rows: the target's current settings against the start settings | "Whole edit" tab | `s.startSettings` (`payload.ts:62`); `differingSettings` (`engine/src/session/end.ts:14`, `:64`) | yes |
| E6 | `rows[]` carrying the canonical name, group, slider range and weight | Lightroom order and slider tracks (section 7) | Ranges probed in LrC 15.5.1 (`engine/src/params/canonical.ts:8-12`; Basic, Color Grading and Detail at `:46-88`, HSL at `:114-118`); labels (`engine/src/params/labels.ts:10-42`) | yes |
| E7 | Selection polling through `get_selection` | Today's selection check runs only while the classic window is open (`Hud.lua:82-92`) | `engine/src/bridge/protocol.ts:162`, `:245` | yes, with the limits in section 3.5 |
| E8 | Launching the HUD process | Section 3.2 | Node `spawn` with `detached` (`docs/hud/research/node-child_process-v22.md:920-923`, from `raw.githubusercontent.com/nodejs/node/v22.x/doc/api/child_process.md`) | yes |
| E9 | `history_prefix`, e.g. "AVG 4f2a1c" | The undo panel names Claude's History steps | `s.short` = the first 6 hex characters of the session id (`begin.ts:62-63`, `:107`); names (`io.ts:150-151`) | yes: sent, so the naming stays in one place |
| E10 | `lightroom`: connected / waiting / down | The connection line during an edit, and the "not running" state (3.7) | Partly. `client.getState()` (`client.ts:106-108`) returns only `"stopped"`, `"connecting"`, `"handshaking"` or `"connected"` (`engine/src/bridge/types.ts:6`). During an allowed silence the state stays `"connected"` and the drop is deferred (`client.ts:8-13`), so "waiting" needs new engine state (proposed): expose the client's private `pluginPaused()` (`client.ts:252-263`: no inbound line for 1.5 heartbeats while a longer silence is allowed). Mapping (proposed): `connected` and not paused → "connected"; `connected` and paused → "waiting"; `stopped`, `connecting` or `handshaking` → "down". | yes |
| E11 | The intent's display name ("Landscape — golden hour") | Option B's open question 6 | `engine/intents/landscape_golden_hour.json:3` | no (keeps the HUD brief) |
| E12 | A channel-only event `hud_show { variant }`: choosing a card selects that copy in Lightroom | Option C's two-step pick (`option-c/NOTES.md` section 5, field 10) | The bridge command `select_photo` (`plugin/LrC-AVG.lrplugin/Catalog.lua:15-17`) | no in v1. It changes Lightroom's selection on the user's behalf (Q11). |
| E13 | A channel-only event `hud_select_target`: re-selects the edit's photo at `target_changed` | A primary action for state row 12 | `select_photo`, as E12 | no in v1; Jim decides (Q11) |

**Out of scope unless Jim adds them:**

- **Put back: keep both actions, with existing functionality only** [stated: Jim, 2026-10-04, "Q14, keep both using existing functionality"; earlier: "'Put back' cancels the session and reverts the image to the pre-edit state"]. Put back exists on `main` from plugin 0.13.0 (section 1.6). The two actions differ in who does the work:
  - **Abort** goes through the engine. The new HUD sends `hud_abort` while it is connected, as today.
  - **Put back** is the plugin's own action. It is enabled when Claude has been away 10 s or the edit is gone (`HudState.lua:198-202` at c2752bc). The plugin applies the snapshot itself, then reports it (`put-back.ts:1-8`).

  Under D3 the new HUD reaches Lightroom only through the engine. So in exactly the case Put back exists for, the new HUD cannot press it [inference]. With existing functionality only, the new HUD:
  - keeps the last state;
  - shows `HEADLINE.stopped` ("Claude stopped during the edit. Your edit so far stays.", `HudText.lua:45` at c2752bc);
  - shows the path to the plugin's Put back: "To put the photo back: File > Plug-in Extras > LrC-AVG - Show Vision Gateway HUD, then Put back" (proposed copy). The menu item is `plugin/LrC-AVG.lrplugin/Info.lua:29` (MenuHud.lua);
  - shows the snapshot line (`HudText.UNDO`), so the photo can also be put back by hand.

  No new engine or plugin behaviour is added. Q17 asks whether the plugin should open its classic window by itself in this case.
- **Per-pass revert.** Lightroom's History already holds each pass as a named step (`io.ts:150-151`).
- **Hold-to-compare.** No support exists. Lightroom's own `\` key ("View Before only": https://helpx.adobe.com/lightroom-classic/help/keyboard-shortcuts.html, read through Tavily) stays with Lightroom, because the HUD binds nothing while it is unfocused.
- **Editing settings from the HUD.** That is the Plug-in Manager page's job (AVG-006).
- **Chat in the HUD.**

**Deferred** to a later feature push [stated: Jim, 2026-10-04, "D5: Hold off on this for a later feature push."].

**Agreed (Q15)** [stated: Jim, 2026-10-04, "Q15, agreed, but don't start until I say go"]. Some items are what D3 and the default layout need to work at all, so they are v1 and do not wait for the D5 push. **Not started; Jim gives the go.**

- E1, E2 and E8: the channel, the fan-out to both HUDs, and starting the HUD (D3).
- E3 and E4: copy labels and each copy's changes, and thumbnails. C's cards show only a letter without them.
- E6: slider ranges, which draw the change rows' tracks.
- E7: selection polling, which keeps today's "Target changed" when the classic window is closed (`Hud.lua:82-92`).
- E10: Lightroom connected or down, for the plugin-down state.

Deferred under this proposal: E5 (the Whole edit view; the toggle is hidden), E9 (History step names; the undo line names the snapshot, which the payload already carries), and E11-E13.

### 2.6 Build order, after the 2026-10-04 decisions (proposed)

1. **Done in branch `phase-6/hud-spec`:** the `PRODUCT.md` amendment (D1), and this spec, the critique and the mockups in `docs\hud\` (rule 04; Q16). Everything below waits for Jim's "go" [stated: Jim, 2026-10-04].
2. S9 (D2): a Tauri validation spike with the Option C HTML. Report `docs\reports\<phase>\S9.md`, with Jim's observations. A failed gate stops here for Jim.
3. Engine:
   - the v1 items from Q15 (E1, E2 and E8 at least), with simulator tests (section 11.2);
   - the classic fallback rule;
   - `hud_layout` read on bridge connect.
4. Plugin release: the `hud_layout` setting and the menu-item fix (D1, D4), in lockstep with the engine's `PAGE_SPECS`.
5. The HUD app in Tauri: the shared core and the layout contract, then **layout C** (the default).
6. Jim's acceptance check in Lightroom on C (section 11.1, in full).
7. Layouts A and B on the same core. Each gets acceptance on placement, its forms and keyboard focus.
8. "Classic window" stays a choice on the settings page.

---

## 3. Architecture

### 3.1 Process model

```
Claude Desktop ──stdio (MCP)──▶ engine (node engine\dist\mcp\main.js)
                                  │  TCP 127.0.0.1:8765 commands ──▶ Lightroom plugin (Lua, listens)
                                  │  TCP 127.0.0.1:8766 events   ◀── Lightroom plugin
                                  │  TCP 127.0.0.1:8767 instance lock (engine listens)
                                  │  TCP 127.0.0.1:<ephemeral> HUD channel (engine listens)   [proposed]
                                  ▼
                         HUD process (new; one per Windows user)                             [proposed]
                           └─ Win32: finds and follows Lightroom's main window
```

Handles for the existing parts:

- The engine is started by Claude Desktop (`CLAUDE.md:79`; `main.ts:1-4`).
- The bridge ports and directions (`client.ts:3-6`).
- The lock is the event port + 1 (`instance-lock.ts:25-32`).

The HUD process never talks to Lightroom's sockets. The plugin serves one bridge client at a time (`instance-lock.ts:1-3`).

### 3.2 Lifecycle

| Event | Engine | HUD |
|---|---|---|
| Install (proposed) | Finds the HUD executable at `%LOCALAPPDATA%\Programs\LrC-AVG HUD\` or through the `LRC_AVG_HUD_EXE` environment variable | Installed per user. No service, no autostart. |
| Engine takes the bridge lock (the first tool call that needs Lightroom: `main.ts:6-10`) | Opens the HUD listener on 127.0.0.1, port 0. Writes `hud_endpoint.json`. | If running, it reads the file and connects (section 3.3) |
| `lr_begin_session` (the begin state goes out with `open: true`: `engine/src/session/manager.ts:129-130`) | Sends the full state on the channel. If no HUD client is connected, spawns the HUD with `detached: true` and `windowsHide: true`, then waits up to 3 s [inference] for it to connect. If none connects, `open: true` goes to the classic HUD (fallback). | Connects and shows itself without activation, once per edit. This is decision 6 as it stands: the HUD opens by itself once, at begin (`Hud.lua:9-11`; `publisher.ts:10-11`; [stated: Jim, 2026-09-28, "Opens by itself, once (Recommended)"]). |
| Each stage | A full state with seq + 1 | Replaces its whole state. No partial updates. |
| A turn starts (the phase becomes Your turn) | — | **Proposed change to decision 6:** if the user had hidden it, it shows again without activation. Decision 6 opens the HUD by itself once per edit only (`Hud.lua:9-11`; `publisher.ts:10-11`), and a re-show on each turn sits close to the "Interrupting: pop-ups" anti-reference (`PRODUCT.md:31`). Jim decides (Q13). Without the change, a hidden HUD stays hidden until the next edit. |
| User hides it (×, proposed) | — | Hides. The process stays running and connected. In Option A the × appears on Done and on the idle row (`option-a/NOTES.md:175`, `:205`); Esc also hides the island in those two states, and otherwise closes the details or hands focus back to Lightroom, never aborting (`option-a/NOTES.md:217`). |
| End stage (`accepted`, `aborted`, `ended`) | A full state with `close_after` | Shows Done, then hides 10 s later, whoever ended the edit (`engine/src/hud/publisher.ts:38` at c2752bc, END_CLOSE_S = 10) [stated: Jim, 2026-10-04, "the HUD did not close automatically after the test"]. This supersedes the earlier "stays open" rule [stated: Jim, 2026-10-03, fix/hud-p1 decision D2], which is kept here for the record. |
| Engine idle release: 60 s after the last call, never while an edit is open (`main.ts:41-46`, `:18-20`) | Closes the listener and deletes the endpoint file | The connection line reads `CONNECTION.not_connected`. A Done state stays. |
| Claude Desktop or the engine exits mid-edit (stdin ends: `main.ts:89-99`) | Gone | Keeps the last state and shows `HEADLINE.not_connected`, the `UNDO` line with the snapshot name, and the actions off. This is today's rule (`HudView.lua:76-81`, `:158`). |
| A new engine connects without the shown edit | Its `welcome` carries the session id of its open edit, or null | Shows `HEADLINE.gone` and `UNDO` at once. No 10 s wait, because the engine has said so. |
| Lightroom exits | The bridge drops | Lightroom's main window is gone: the HUD hides and exits (proposed). The snapshot stays in the catalog [inference]. |
| Lightroom restarts while the engine still has the edit open | Reconnects and resends the state (`publisher.ts:79-85`). If no HUD client is connected, spawns the HUD (proposed). | As at begin |
| HUD crashes | Sees the channel close. Respawns at most once per edit (proposed); after that, `open: true` goes to the classic HUD. | — |
| A second HUD launch | — | Exits at once (single instance: the `tauri-plugin-single-instance` crate [handle: `curl https://index.crates.io/ta/ur/tauri-plugin-single-instance` lists 2.5.2 as its newest 2.x release]; its behaviour on Windows is [unverified]) |

### 3.3 HUD channel

**Transport:**

- TCP on 127.0.0.1 only. PRD NFR-4 binds sockets to 127.0.0.1 (`.claude/rules/01-stack.md`, "Runtime").
- One bidirectional socket, with newline-delimited JSON.
- Reuse `LineSplitter` (`engine/src/bridge/lines.ts:21`; maximum line 32 MiB, `:19`).
- One client at a time. A new valid `hello` replaces the old client (proposed).

**Endpoint file:** `%USERPROFILE%\.lrc-avg\hud_endpoint.json` = `{ "port", "token", "pid", "engine_version", "written_at" }`.

- Written by the lock holder when it opens the listener. Deleted at release and at shutdown.
- The token is 32 random bytes, hex, new for each listener.
- Any program running as the same Windows user can read it, as it can `bridge_token` (`Endpoint.lua:9-10`) [inference].
- While disconnected, the HUD reads the file every 2 s (proposed). It checks that `pid` is alive, and treats a failed handshake as "not connected" [inference: a stale file can name a port another program now uses].

**Handshake:**

1. HUD → `{ "type": "hello", "token", "hud_version", "pid" }`.
2. The engine compares tokens in constant time [inference]. On a mismatch it closes the socket.
3. Engine → `{ "type": "welcome", "engine_version", "session_id": <open edit or null>, "lightroom": "connected" / "waiting" / "down" }` (`lightroom` as in E10), then a full `state`.

**Messages:**

| Direction | `type` | Body |
|---|---|---|
| Engine → HUD | `state` | `{ seq, state }`. `state` is `hudChannelStateSchema` (below). It is the whole state every time. |
| Engine → HUD | `answer` | `{ click_id, note }`. Also folded into the next `state` as `answered_click_id` and `note`, as the publisher does (`publisher.ts:200-205`). |
| Engine → HUD | `thumb` | `{ key, jpeg_b64 }`, only in reply to `get_thumb` |
| Engine → HUD | `ping` | `{}`, every 2 s |
| HUD → engine | `hello` | Above |
| HUD → engine | `event` | `{ name, payload }`. `name` is one of `HUD_EVENTS`; `payload` matches `hudEventSchemas` exactly (`hud-protocol.ts:119-133`), with `source: "hud"`. |
| HUD → engine | `get_thumb` | `{ key }` |
| HUD → engine | `pong` | `{}` |

**Schema:** `hudChannelStateSchema` = `hudUpdatePayloadSchema` (`hud-protocol.ts:83-108`) without `open` and `seq`, plus these strict fields (proposed):

| Field | Shape | Source |
|---|---|---|
| `lightroom` | `"connected"`, `"waiting"` or `"down"` | E10 (proposed). Mapped from `BridgeState` (`engine/src/bridge/types.ts:6`, via `client.getState()`, `client.ts:106-108`) plus a new paused flag: "waiting" while the plugin has missed a beat inside an allowed silence (`client.ts:252-263`; up to `SESSION_SILENCE_MS` 60000, `bridge-gate.ts:35`). `getState()` alone cannot give "waiting": it stays `"connected"` during the silence (`client.ts:8-13`). |
| `history_prefix` | string | `"AVG " + s.short` (E9) |
| `copies` | at most 3 × `{ letter, label, copy_name, uuid, pass, thumb?, guardrail? }` | E3, E4 |
| `picked` | `"A"`, `"B"`, `"C"` or null | E3 |
| `rows` | at most 12 × `{ name, label, group, before?, after, delta?, min?, max?, weight }` | E6. This is `deltas` enriched. The same 12-row limit applies (`hud-protocol.ts:51`). |
| `whole_edit` | `{ rows: at most 40, more: int }` | E5 (the 40 is [inference]) |
| `selection` | `{ uuid or null, name or null, in_edit: boolean }` | E7 |

Text fields keep `HUD_LIMITS.text` = 120 bytes (`hud-protocol.ts:51`). zod's `.extend` keeps a `strictObject` strict in the engine's pinned zod 4.6.5 (`engine/package.json:36`) [handle: `node docs/hud/spec-checks/zod/strict-extend.cjs`, run against `npm pack zod@4.6.5`, printed `zod 4.6.5 extend keeps strict: true | known fields pass: true`; `z.strictObject({x}).extend({y})` refuses `{x:1,y:2,q:3}` and takes `{x:1,y:2}`]. The test in section 11.2 stays as a guard against a zod upgrade.

**seq:** per edit and per channel, starting at 1, independent of the bridge publisher's seq (`publisher.ts:57-58`). An event's `seq_seen` is the channel seq.

**Events: one control path.**

- Channel events go into the same `HudEvents.handle` → `manager.userAction` (`engine/src/hud/events.ts:65-91`, `:84`).
- Repeated `click_id`s are dropped across both surfaces, because the seen list is global (`events.ts:75-80`).
- The answer goes back to the surface the click came from, through its `answered_click_id`. The other surface gets the state without it (proposed).
- `HudEventRecord` gains `via: "bridge"` or `"channel"` for the tool log (proposed). No schema change.

**Engine modules (proposed).** Each stays under the 300-line target (rule 01, "Module size"):

- `engine/src/hud/channel.ts`: listener, endpoint file, heartbeat;
- `engine/src/hud/channel-protocol.ts`: schemas;
- `engine/src/hud/extras.ts`: copies, rows, whole edit;
- `engine/src/hud/thumbs.ts`;
- `engine/src/hud/selection.ts`;
- `engine/src/hud/launch.ts`;
- `engine/src/hud/sinks.ts`: fan-out.

### 3.4 Why the Lua `hud_update` stays unchanged

- **It is strict.** `hudUpdatePayloadSchema` is a `z.strictObject` (`hud-protocol.ts:83`). The plugin refuses an update with any unknown field: HudState.lua's check refuses "a field that is not in the spec" (`plugin/LrC-AVG.lrplugin/HudState.lua:9-11`; `hud-protocol.ts:11`). `engine\tests\lua-plugin.test.ts` keeps HudState.lua's stage, end-stage, guardrail, event and variant lists and its limits equal to the engine's (`engine/tests/lua-plugin.test.ts:210-220`; `HudState.lua:6-7`); field-level agreement is exercised by the smoke transcript (`hud-protocol.ts:7-9`), not by that test. Any new field therefore needs a plugin release in lockstep with the engine.
- **Leaving it alone keeps the classic HUD as a fallback with no plugin work for the data path.**
  - The classic window still gets every state.
  - It opens by itself only when the engine sends `open: true`, which E2 does only when no channel client is connected.
  - The menu items act on the plugin's own copy of the state (`HudClick.lua:104-132`). **But each one opens the classic window** (`MenuAbort.lua:3`; `Hud.lua:199-200`; `HudClick.lua:95-96`, `:130`), which takes the keyboard (`S8.md:122`, `:185`). Keeping them from doing so while the new HUD is connected is a plugin change: D1, "Known conflict".
- `HUD_PLUGIN` stays at 0.9.0 (`publisher.ts:34`).

### 3.5 Selection

**Today.** The plugin checks the selection every 2 s, on the observer, and again 0.5 s after the observer. It does this only while the classic window is open (`Hud.lua:82-92`; `plugin/LrC-AVG.lrplugin/HudSelection.lua:24-25`, `:72-79`).

**New (E7, proposed).** The engine calls `get_selection { max: 1 }` every 2 s, but only while all three hold:

- an edit is open;
- a HUD client is connected;
- the edit's queue is idle (no operation running; `ActionHost.busy`, `hud-actions.ts:44`).

It does not poll during its own work, for two reasons:

- Variants mode selects each copy itself (`engine/src/session/targets.ts:12-14`), so a read during its own work would see its own selection, not the user's.
- Copy creation selects the master before each copy, and each new copy becomes the active photo. Against a fake Lightroom, a `get_selection` without the selection lock read a new copy as the selection at 6 of 13 start times; with the lock, which the current code takes, none did (`plugin/LrC-AVG.lrplugin/Catalog.lua:203-209`). So the lock already covers this in the plugin; not polling while busy is a second guard [inference].

**The rule.** `in_edit` = the selected uuid is in `session_photos` (`payload.ts:42`), the rule of `HudState.targetChangedLine` (`HudState.lua:230-237`). The HUD shows that function's lines unchanged. If `get_selection` is refused because no photo is selected (`protocol.ts:245`), the line is the one that function builds for no selection (`HudState.lua:234-237`): in Converge, "Target changed: No photo is selected. Select <file> again; the edit is still open."; in Variants, "Target changed: No photo is selected. Claude's next call selects the edit's photo again; the edit is still open." (<file> is `HudState.targetName`.)

**Cost.** One bridge round trip every 2 s while idle. `hud_update` round trips had a median of 18.1 ms (`docs/reports/phase5/PHASE5.md:326`). `get_selection`'s own time is [unverified].

### 3.6 Thumbnails (Variants only)

| Item | Rule |
|---|---|
| Source | Each copy's last render, `v.last.jpeg` (`types.ts:134`, `:158`): the same image the contact sheet is built from (`variants.ts:107-109`) |
| Size | 480 px long edge, JPEG quality 70, made with sharp (rule 01, "Images"). The largest drawn thumbnail is Option C's 138 x 92 CSS px (`option-c/NOTES.md:318`); it needs 276 px at 200 % display scaling and 414 px at 300 %, so 480 covers it [inference, `option-c/NOTES.md:245`]. A's 54 x 36 chips (`option-a/NOTES.md:454`) need far less. |
| Key | `<letter>:<pass>:<first 12 hex characters of Rendered.hash>` (`types.ts:135`) |
| Delivery | The state lists keys. The HUD asks for missing ones with `get_thumb`, and the engine answers `thumb`. Nothing is written to disk. |
| Lifetime | The engine caches thumbnails on the session object until the edit closes. The HUD keeps them in memory for the edit it shows and drops them all on a new `session_id`. |
| Converge mode | None: the photo is in the loupe |
| Not chosen | Lightroom's own thumbnails. They need plugin work, and in Phase 0 `requestJpegThumbnail` after `applyDevelopSettings` gave no image within 30 s: every request was answered at once with no data and "error loading thumb" (5/5 steps), and a thumbnail's size was not guaranteed (`docs/reports/phase0/PHASE0.md:119`, citing `S1.md` Run 2). |

### 3.7 Heartbeat and stale states

- The engine pings every 2 s. Either side drops after 3 missed pings (6 s). This mirrors the bridge (`client.ts:6-7`) (proposed).
- The channel does not depend on Lightroom pausing.
- While the bridge rides out a plugin silence during an edit, up to 60 s (`bridge-gate.ts:35`), `BridgeState` stays `"connected"` (`client.ts:8-13`). `lightroom` reads "waiting" from the proposed paused flag (E10), and the HUD does not change its turn sentence.

HUD-side states (proposed):

| HUD state | When | Shows |
|---|---|---|
| connected | Any message (`state` or `ping`) within 6 s | The state |
| checking | Connected, but the first `state` has not arrived yet; at most 10 s (`HudState.lua:34`) | `HEADLINE.checking`, actions off |
| not connected | Socket closed or 3 pings missed | The last state with `HEADLINE.not_connected`, the `UNDO` line, actions off |
| gone | `welcome.session_id` ≠ the shown edit, or 10 s of checking | `HEADLINE.gone`, `UNDO`, actions off |
| not running | The channel is connected and the engine reports `lightroom` = "down" (in `welcome` or `state`) while Lightroom's main window exists; after 6 s of "down", so a reconnect's brief `connecting` / `handshaking` does not flash it [inference] | `HEADLINE.not_running` "LrC-AVG is not running: reload it in File > Plug-in Manager." With an edit open, also the `UNDO` line and actions off (5.2 row 1b). This matches today's meaning: `conn.running` is "a bridge generation is live" in the plugin (`plugin/LrC-AVG.lrplugin/Events.lua:21-26`), and `headline()` shows `not_running` when it is false (`HudView.lua:63`). |
| Lightroom gone | Lightroom's main window is not found | Hides and exits (3.2). It never shows `HEADLINE.not_running`, whose advice (reload the plugin) needs a running Lightroom. |

While the channel is down the engine cannot report `lightroom`. The HUD may then read `%TEMP%\LrC-AVG\bridge_status.json` (`plugin/LrC-AVG.lrplugin/Bridge.lua:52`, `:140-169`). It treats a stale file as unknown, never as not running, because the plugin's tasks pause while a menu is open (`PHASE5.md:328-330`) [inference].

---

## 4. Window behaviour

### 4.1 Finding Lightroom, and placement

**Finding Lightroom's window** (proposed):

- The HUD finds Lightroom's main window as the largest visible top-level window of the Lightroom process. The process image name and title pattern are [unverified]; Jim's check records them.
- It follows that window with `SetWinEventHook(EVENT_OBJECT_LOCATIONCHANGE)`, filtered to Lightroom's process id. Handles: `MS event-constants.md:121` (https://learn.microsoft.com/windows/win32/winauto/event-constants) and `MS nf-winuser-setwineventhook.md:124-130`, `:180` (https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-setwineventhook). The hook needs a thread with a message loop (`:184`).

**Geometry.** The SDK gives no panel or band geometry [unverified], so every option anchors to the window rectangle. Offsets are drawn from the stage. The real offsets on Jim's machine and display scaling are measured in the acceptance check.

| Option | Anchor (proposed) | Default [stage] | User adjustment |
|---|---|---|---|
| A Island | Top edge fixed at the band's top + 13 px (`option-a/NOTES.md:55`). Horizontally on the window's centre line [inference: the loupe's centre needs panel widths]. | Band y 52-112; island top y 65; heights 40 and 44 (`option-a/NOTES.md:55`) | Proposed: drag along the band by a grip, with the x offset kept as a fraction of the window width. The Option A mockups draw no grip (`option-a/option-a.html` has none; `option-a/NOTES.md:211`); A as drawn is placed only by its clamp rule (`option-a/NOTES.md:47-53`). The grip is added to A's mockups before the build, or A stays undraggable (Q3). |
| B Rail | The left edge of the client area, under the top band, to the filmstrip's top | x 0, y 112, 300 x 824 (`option-b/NOTES.md`, "Placement") | Collapse to a bottom-docked panel |
| C Deck | The bottom of the client area. The top edge is fixed, so expanding grows down over the filmstrip and never up over the photo. | y 936; 44 px collapsed, over the filmstrip header; 144 px expanded, the full band; full window width (`option-c/NOTES.md` section 1) | Collapse with the disclosure triangle or Esc; it expands once per turn (`option-c/NOTES.md` section 2, open question 1) |

**Fallback when the band is hidden or too narrow** (open question 3 of Option A): the island floats 8 px inside the top of the client area (proposed).

### 4.2 No focus stealing, and the one attention cue

- **Every programmatic show is a show without activation:** `ShowWindow(SW_SHOWNA)` from Rust, never Tauri's `show()` (D2). Handles: `MS nf-winuser-showwindow.md:90-94`, where SW_SHOWNA shows "without activation" (https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-showwindow); the tao lines in D2.
- **A pointer click on the HUD activates it.** That is the user's deliberate act. `WS_EX_NOACTIVATE` is not used, because it also keeps the window out of reach of accessibility tools' keyboard navigation (`MS extended-window-styles.md:31`, https://learn.microsoft.com/windows/win32/winmsg/extended-window-styles). Keyboard operation is required (`PRODUCT.md:44`).
- **Focus after an action (proposed):**
  - after a pointer action is sent, the HUD hands focus back to Lightroom (`SetForegroundWindow` on Lightroom's window, allowed while the HUD is in front [inference: `MS window-features.md:164-178`]);
  - after a keyboard action, focus stays in the HUD.
- **The only attention cue.** When a turn starts, the visible HUD takes the Your turn look: a filled amber dot, the turn sentence, and the width change. There is no sound, no flash, no taskbar flash, no bounce and no focus change. This follows PRODUCT.md "Interrupting" (`PRODUCT.md:31`). Re-showing a HUD the user hid, on each turn, is a proposed change to decision 6 (3.2; Q13), not part of today's rule.

### 4.3 Topmost policy [inference until S9-7]

The HUD is topmost only while Lightroom or the HUD itself is the foreground window.

- **How:** `EVENT_SYSTEM_FOREGROUND` (`MS event-constants.md:148`), then `SetWindowPos` with HWND_TOPMOST or HWND_NOTOPMOST and SWP_NOACTIVATE (`MS nf-winuser-setwindowpos.md:103-131`, `:231-237`; https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-setwindowpos).
- **The hook counts the HUD's own process as "Lightroom in front"** [inference]. Otherwise a click on the HUD would drop it.
- This pattern is not documented as such [inference].

Not chosen:

- **Making Lightroom's window the HUD's owner** (possible from Tauri's Rust builder with `owner_raw`, section 1.5, or with Win32 calls from Electron [inference]). It is legal across processes, but "It is also technically legal to juggle chainsaws". "Creating a cross-thread parent/child or owner/owned window relationship implicitly attaches the input queues of the threads which those windows belong to" (https://devblogs.microsoft.com/oldnewthing/20130412-00/?p=4683, read through Tavily on 2026-10-04). So a hung HUD could stall Lightroom's input [inference; what attached threads share: `MS nf-winuser-attachthreadinput.md:94`].
- **Permanent always-on-top.** It would float over Claude Desktop, where the user reads the chat.

### 4.4 Position, monitors, DPI (proposed)

- The position is stored relative to the anchor in `%LOCALAPPDATA%\LrC-AVG\hud\window.json`, one entry per layout option.
- The HUD follows the monitor of Lightroom's main window, and works in physical pixels converted by that monitor's DPI [inference].
- A second monitor and Lightroom's secondary display window are [unverified]. The HUD stays with the main window.

### 4.5 Lightroom states (proposed)

| Lightroom | HUD |
|---|---|
| Minimised | Hidden (S9-8) |
| Not in front | Not topmost: other windows may cover it |
| Screen modes: normal, full screen with menu bar, full screen | Follows the window rectangle. Its behaviour in each mode is S9-8. The classic dialog's behaviour varies by version [community, D1]. |
| Lights Out | Cannot be detected [inference]. The HUD stays (open question Q9). |
| Library, Map and other modules | Island and Deck stay. Proposed: the Rail shows only in Develop, one of the three options in `option-b/NOTES.md:478-484` (its open question 3); not decided. |

### 4.6 Keyboard focus rules

- **The HUD binds nothing while it does not have focus.** No global hotkeys. Lightroom's shortcuts, `\` among them, stay Lightroom's.
- **With focus:** the keys in section 6.
- **Esc** collapses the details. With nothing open, it returns focus to Lightroom. It never aborts.
- **Tab** order: primary action, other actions, chips, details toggle, close.
- **Focus ring:** a 2 px `text`-colour outline, offset 2 px (`option-a/NOTES.md` section 7).
- **Getting into the HUD without a mouse.** A window shown without activation has no keyboard way in except Alt+Tab, whose behaviour for this window is [unverified]. The File > Plug-in Extras items, one for each action (`Info.lua:22-34`), reach the engine without the mouse:
  - in LrC 15.6, Pick B and Approve Pass sent their events from the menu (`docs/reports/phase6/hud-p1-check/check.txt:202-205`), and the menu lists Accept Edit and Abort Edit (`check.txt:213`; listed, not sent, in that check);
  - in LrC 15.5.1, the Accept and Abort items sent with source "menu" (`docs/reports/phase5/PHASE5.md:303-306`; version at `:281`).

  But today each item opens the classic HUD, which takes the keyboard (D1, "Known conflict"). They become a path that leaves focus alone only with the menu-item fix. See Q4.

---

## 5. Information architecture

### 5.1 Phases: words plus a shape, never colour alone

| Phase | Shape | Word |
|---|---|---|
| Working | Hollow ring, pulsing (static with reduced motion) | "Working" (proposed) |
| Your turn | Filled accent dot | The sentence starts "Your turn:" (HudText) |
| Done | Check glyph | The sentence starts "Done:", or "The edit has ended." |
| Problem | Triangle glyph | The sentence (not connected, gone, not running) |
| Idle | — | Hidden |

### 5.2 State table

The rows are in precedence order, the order of `HudView.lua` `headline()` (`HudView.lua:61-72`). Sentences are exact `HudText.lua` strings; where a row names an island short form, the island shows that form (10.2) and the details show the full sentence.

The "Actions visible" column was drawn for Option A, as its notes and mockups draw it: "island" is the row at rest, "details" is the drop-down's footer, which holds Accept (secondary) and Abort (`option-a/NOTES.md:453`; `option-a/option-a.html:184`). Under D4, every layout shows the same actions with the same enable rules. B and C place them in their own action blocks (their NOTES); C is the default layout. "Enabled" is the same on every surface.

`live` = an edit is shown ∧ its stage is not an end stage ∧ the channel is connected ∧ no click is pending ∧ the state is known. This is `HudView.lua:158` with "channel" in place of "engine".

| # | Condition | Phase | Turn sentence (exact) | Step line | Actions visible (Option A) | Enabled |
|---|---|---|---|---|---|---|
| 1a | LrC-AVG not running, no edit open: `lightroom` = "down" while Lightroom's window exists (section 3.7) | Problem | `HEADLINE.not_running` "LrC-AVG is not running: reload it in File > Plug-in Manager." (`HudText.lua:41`) | — | island: none (`option-a/NOTES.md:176`) | — |
| 1b | LrC-AVG not running during an open edit: `lightroom` = "down" while Lightroom's window exists | Problem | `HEADLINE.not_running`, then `UNDO` with `snapshot`, or `UNDO_NO_SNAPSHOT` (`:72-73`), as today's feedback line does when the engine is not reachable (`HudView.lua:63`, `:76-79`) | the last one | island: none; details: Accept and Abort, off [inference: the footer rule, `option-a/NOTES.md:25`] | all off (`HudView.lua:133`, `:158`) |
| 2 | No edit shown | Idle (hidden) | `HEADLINE.none` "No edit running. In Claude Desktop, ask Claude to edit a photo." (`:40`), if shown at all | — | none | — |
| 3 | stage `accepted` | Done | `HEADLINE.accepted` "Done: the edit is kept." (`:50`) | `STEP.accepted` "Accepted" (`:62`) | no edit action; a × hides the island (`option-a/NOTES.md:175`) | all off |
| 4 | stage `aborted` | Done | `HEADLINE.aborted` "Done: the photo is back as it was." (`:51`) | `STEP.aborted` "Aborted" | none | all off |
| 5 | stage `ended` (Claude's revert: `manager.ts:172`; or an unknown session's end: `events.ts:103`) | Done | `HEADLINE.ended` "The edit has ended." (`:52`) | `STEP.ended` "Ended" | none | all off |
| 6 | Channel down, edit open | Problem | `HEADLINE.not_connected` "Claude is not connected. Your edit so far stays." (`:42`), then `UNDO` "To undo it: Develop > Snapshots > %s" with `snapshot`, or `UNDO_NO_SNAPSHOT` (`:72-73`) | the last one | island: no buttons; the undo line is plain text with no link styling, and a click anywhere on the island or the chevron opens the details (`option-a/NOTES.md:170`); details: Accept and Abort, off [inference: the footer rule, `option-a/option-a.html:184`] | all off (`HudView.lua:133`, `:158`) |
| 7 | checking | Working | `HEADLINE.checking` "Checking this edit with Claude..." (`:43`) | — | island: none; buttons off (`option-a/NOTES.md:173`) | all off |
| 8 | gone | Problem | `HEADLINE.gone` "This edit is no longer open in Claude. Your edit so far stays." (`:44`), then `UNDO` | — | as row 6 (`option-a/NOTES.md:160`) | all off |
| 9 | stage `awaiting_pick` | Your turn | `HEADLINE.awaiting_pick` "Your turn: pick a copy, or tell Claude which one." (`:46`), in the details. The island shows its short form "Your turn: pick a copy" (10.2; `option-a/NOTES.md:169`, `:329`). | `STEP.awaiting_pick` "Waiting for your pick" | island: Pick chips A/B/C only; details: Abort. Accept is not shown (`option-a/NOTES.md:169`). | Pick X: `live` ∧ X ∈ `variants` (`HudView.lua:163`). Abort: `live`. Accept: off (`:161`). |
| 10 | `approve_pass` present, at any stage that is not an end stage (`payload.ts:34`, `:44`) | Your turn | `HEADLINE.approve` "Your turn: approve pass %d so Claude can go on." with `approve_pass` (`:47`) | `STEP[stage]` (`awaiting_approval`: "Waiting for your approval") | island: **Approve pass n** (primary), Abort; details: Accept, Abort (`option-a/NOTES.md:168`) | Approve: `live` ∧ `approve_pass` (`:165`). Accept: `live`. Abort: `live`. |
| 11 | stage `converged` | Your turn | `HEADLINE.converged` "Your turn: Claude thinks the edit is done." (`:48`) | `STEP.converged` | island: **Accept** (primary), Abort (`option-a/NOTES.md:167`) | `live` |
| 12 | stage `target_changed` | Your turn | `HEADLINE.target_changed` "Your turn: select the edit's photo again." (`:49`) | `STEP.target_changed` "Another photo is selected" | island: Abort only. No primary: the act is in Lightroom (`option-a/NOTES.md:172`). Details: Accept, Abort [inference: the footer rule, `option-a/option-a.html:184`]. | `live` |
| 13-18 | stage `begin`, `pass0`, `applying`, `acquiring_preview`, `metrics` or `awaiting_claude` | Working | `HEADLINE.working` "Claude is working. Nothing needed from you." (`:45`) | `STEP[stage]` + pass (`HudView.lua:83-89`): "Starting", "Setting profile, lens corrections and baseline", "Applying pass n of N", "Rendering a preview", "Measuring the preview", "Claude is looking at the result" | island: none; details: Accept (secondary), Abort; Ctrl+Backspace arms Abort (`option-a/NOTES.md:154`) | Abort: `live`. Accept: `live`, and in Variants also `picked` ≠ null (proposed; the engine refuses it before a pick: `hud-actions.ts:183`). |

Notes on the table:

- **Rows 3-5:** after an end stage, a working row's Accept, pressed through the engine, ends nothing. Those buttons are off.
- **Rows 13-18:** the step lines drop the "Step:" prefix (proposed).
- **Cap reached:** when all passes are used, the stage is `awaiting_claude` with the note "All N passes are used. Accept keeps the edit; Abort puts the photo back." (`hud-actions.ts:290`), while the sentence says "Claude is working." See Q6.

### 5.3 Overlays, which change no phase

| Overlay | When | Shows |
|---|---|---|
| Click pending | After any click, until `answered_click_id`, a new edit, an end stage, or 10 s (`hud-protocol.ts:24-25`; `HudState.lua:29`) | All actions off. The line `CLICK.sent` "%s sent; waiting for Claude." with the label (`HudText.lua:80`). After 10 s, `CLICK.no_answer` (`:82`). Labels come from `HudState.eventLabel` (`HudState.lua:185`). |
| Abort armed | First Ctrl+Backspace | The Abort control reads "Press again to abort" (proposed). Disarmed by Esc or after 3 s (proposed). |
| Note | `note` present | One line, as given by the engine. The engine notes are in section 10.3. |
| Selection line | `selection.in_edit` false during an open edit | The `HudState.targetChangedLine` text (`HudState.lua:230-237`). With `in_edit` true, the details show `SELECTION_OK` "Selection: the edit's photo." (`:228`). |
| Guardrail line | `guardrail` present | `guardrail.reason` as given, or `CLIPPING_OK` "Clipping: within limits." for green without a reason (`HudText.lua:75`; `HudView.lua:102-107`). Glyph: check for green, triangle otherwise. |

### 5.4 Contents of the details drop-down (Option A), top to bottom (proposed)

1. **Identity:** `target.filename`, the copy letter and label in Variants, then "ISO 100 · 1/250 s · f/8 · <lens> · lens profile on". Fields from `payload.ts:61-75`. The "ISO " and "lens profile " prefixes are today's (`HudView.lua:93`, `:97`).
2. **Pass:** "Pass n of N · <step line>", then the This pass / Whole edit switch and the rows (section 7), then the guardrail line.
3. **Undo:** the `UNDO` line with `snapshot`, then "Each step in History starts with “<history_prefix>”." (proposed).
4. **Edit settings,** collapsed: the session's settings, else the page's. This is decision 4 (`HudView.lua:128-133`; [stated: Jim, 2026-09-29]). Mode, max passes and preview size are shown; decay and the clip limits stay on the page (proposed). Then "Change in File > Plug-in Manager." (proposed).
5. **Actions with their consequence lines and key hints** (section 6).
6. **Connection line:** `CONNECTION.*` (`HudText.lua:65-69`).

---

## 6. Actions

| Event (`hud-protocol.ts:48`) | Label | Consequence line (proposed) | Enabled | Keyboard (HUD focused) | Pointer |
|---|---|---|---|---|---|
| `hud_pick { variant }` | Chip "A natural", "B dramatic", "C soft" (letter + `copies[].label`); "Pick A" in the click lines (`HudState.lua:185-186`) | "Claude continues on this copy. A pick is final." A second pick is refused: "Copy %s is already picked." (`hud-actions.ts:234`). | Row 9 | 1/2/3 choose a chip. Enter picks the chosen chip. Two steps (proposed). This changes Option A's notes, where 1/2/3 pick at once (`option-a/NOTES.md:212`), because a pick is final: a second pick is refused (`hud-actions.ts:234`). | One click on a chip picks it, as today's button does (`HudView.lua:202-204`). Two-step is open question Q11. |
| `hud_approve_pass { pass }` | "Approve pass n" (`HudState.lua:187`) | "Lets Claude write pass n+1." The next lr_step waits up to 60 s for it (`approval.ts:7-9`, `:34`). | Row 10 | Enter (primary) | One click |
| `hud_accept` | "Accept" | Converge: "Ends the edit; the sliders stay as they are." Variants: "Ends the edit and keeps copy %s; the other copies stay in the catalog." (`hud-actions.ts:223`; `end.ts:4-8`) | Rows 10-18 per the table | Enter when it is the primary (row 11) | One click |
| `hud_abort` | "Abort" | Converge: "Stops Claude and puts the pre-session snapshot back." Variants: "Stops Claude and puts the master back; the copies stay in the catalog." (`hud-actions.ts:125`) | `live` | Ctrl+Backspace, then again within 3 s | One click, as today (`HudView.lua:207`). Abort's revert is itself a History step, so the edit's earlier steps stay in History [inference]. See Q5. |
| `hud_put_back { outcome }` (plugin 0.13.0; `hud-protocol.ts:149` at c2752bc) | "Put back". This is the plugin's own button, not one in the new HUD (D5). | "Put back returns the photo to how it was before the edit." (`HudText.lua:81-82` at c2752bc) | Only the plugin sends it, when `canPutBack` (`HudState.lua:198-202` at c2752bc) | — | The new HUD shows the menu path to it (D5) |

**Rules for every action:**

- **Exactly one primary (filled accent) control per state:** Approve in row 10, Accept in row 11. Rows 9 and 12 have none.
- **Abort is never filled.** It is danger-coloured text with a hairline.
- **After a click:** the overlay in 5.3.
- **The engine answers every click with a note:**
  - "Abort: putting the photo back as it was before the edit." (`hud-actions.ts:144`)
  - "Accept: keeping the edit." (`:199`)
  - "Pick %s: selecting copy %s." (`:246`)
  - "Approved pass %d: Claude goes on at its next call." (`:88`)
- **Engine refusals arrive as notes, not dialogs.** For example: "Accept keeps the pick's edit: click Pick first, or Abort." (`:183`).

**Why there is no Put back.**

- There is no event for it (`hud-protocol.ts:48`). `main` has no button for it (`HudView.lua:200-207`), and no PR head from #42 up has one: PRs #42-#53, #57, #61-#66 and #69-#71 are the only ones in that range, and their HUD Lua files have no "put back" (handle under D5, "Put back": `docs/hud/spec-checks/pr-heads.txt`, `putback-scan.sh`, `putback-scan.out`).
- The undo paths that exist are:
  - Abort, which applies the pre-session snapshot (`hud-actions.ts:5-9`);
  - Lightroom's History, where every pass is a named step "AVG <short>[ A|B|C] pass n/N[ suffix]" (`io.ts:150-151`), e.g. "AVG 618087 pass 1/4 guard 3" (`docs/reports/phase5/P5/p5_chat_sessions/20261001-618087.json`).
- A Put back would be a new engine command and a D5 decision (Q2).

---

## 7. Changes view

**Tabs (proposed).**

- **"This pass"** shows `rows` (= `deltas`: the target's last pass, `payload.ts:45`).
- **"Whole edit"** shows `whole_edit` (E5).
- The default tab is This pass while working or approving, and Whole edit at converged and Done. A user's choice holds until the next edit.

**Labels.** Lightroom's, from `labels.ts:10-42`, which Jim checked against LrC 15.5.1 [stated: Jim, 2026-10-03, "All match"] (`labels.ts:1-3`).

**Order.** By group, in panel order. The panel names are [unverified] until Jim checks them against LrC 15.6.

| Group | Rows, in order |
|---|---|
| Basic | Profile, Temp, Tint, Exposure, Contrast, Highlights, Shadows, Whites, Blacks, Texture, Clarity, Dehaze, Vibrance, Saturation |
| Tone Curve | Point Curve, Point Curve Red, Point Curve Green, Point Curve Blue |
| HSL / Color | Red Hue … Magenta Hue, then the Saturation rows, then the Luminance rows. Labels are colour first, "<Colour> <Hue / Saturation / Luminance>" (`labels.ts:25`), in the band order of `labels.ts:5`. [unverified: Lightroom's HSL tab order] |
| Color Grading | Shadows, Midtones, Highlights, Global (Hue, Saturation, Luminance), Blending, Balance |
| Detail | Sharpening Amount, Radius, Detail, Masking, Noise Reduction Luminance, Noise Reduction Color |
| Lens Corrections | Remove Chromatic Aberration, Enable Profile Corrections, Lens Corrections (panel on/off) |

**A row** (Option B's rendering, `option-b/NOTES.md`, "Visual system"):

- the label, right-aligned in a fixed column;
- a groove 96-120 px wide, in the `inset` or `track` token;
- a hollow tick **above** the groove at the before value;
- a filled thumb **below** the groove at the after value;
- the segment between them in accent at 60 %;
- "before → after" in text2;
- the signed delta, right-aligned, with tabular figures and a true minus sign U+2212.

The tick and thumb sit on opposite sides so that small changes never overlap. Direction is carried by the sign and the numbers only; there is no red and green.

Other rows:

- **No track** for non-numeric values: Profile names, curves (shown as "curve") and switches (on/off) (`payload.ts:95-99`). These rows show "before → after" text only.
- **Ranges** come from `canonical.ts`, as probed in LrC 15.5.1 (`canonical.ts:8-12`): Exposure −5 to 5; Tint −150 to 150; the other Basic sliders −100 to 100 (`:47-61`); Color Grading hues 0-360 and saturations 0-100 (`:67-78`); HSL hue, saturation and luminance −100 to 100 (`:115-117`); Sharpening Amount 0-150; Radius 0.5-3 (`:83-84`).
- **Temp** (2000-50000 K) is drawn on a log scale [inference]. Lightroom's own Temp slider mapping is [unverified].

**Row cap.**

- This pass: at most 12 rows (`hud-protocol.ts:51`). The details show 8, then "+%d more", which expands in place (proposed).
- Whole edit: at most 40, then "+%d more".
- When over the cap, the rows with the highest weight are kept, then shown in panel order.

**Weights** [inference: tuning values, not facts]. Weight = |delta| / full scale, capped at 1. It is used only for the cap and to dim small changes: weight < 0.1 shows the delta in text2.

| Slider | Full scale (weight 1) |
|---|---|
| Exposure | 1.0 |
| Contrast, Highlights, Shadows, Whites, Blacks | 40 |
| Texture, Clarity, Dehaze, Vibrance, Saturation | 25 |
| Temp | 15 % of the before value |
| Tint | 20 |
| HSL hue, saturation, luminance | 30 |
| Color Grading hue / saturation / luminance, blending, balance | 60 / 20 / 30 / 30 / 30 |
| Sharpening Amount / Radius / Detail / Masking | 40 / 0.5 / 25 / 25 |
| Noise Reduction | 25 |
| Profile, curves, switches | 1 whenever changed |

**Example from a real session** (`docs/reports/phase5/P5/p5_sessions_2026-10-01T11-32-13-141Z/`, converge pass 1): Clarity 2 → 6 (+4, weight 0.16) and Vibrance 10 → 16 (+6, weight 0.24). Both rows are shown, in Basic order: Clarity, then Vibrance.

---

## 8. Visual system

### 8.1 Instrument tokens (Options A and C)

Window: a 1 px `line` border. No blur, glass, gradients, transparency or purple.

- **A:** radius 10. The island has no shadow at rest; the drop-down and the callouts carry the one shadow, `0 10px 30px rgba(0,0,0,.45)` (`option-a/option-a.html:28-30`, `:95`, `:105`; `option-a/NOTES.md:367`).
- **C:** square, with no window shadow and a 1 px `line` hairline on top (plus one at the bottom when collapsed). Radius 8 is used on the cards, 6 on the buttons and 4 on the thumbnails (`option-c/NOTES.md:72`).

Contrast ratios come from `node docs/hud/tools/contrast.cjs '<pairs>'` (WCAG relative luminance), run 2026-10-04:

| Token | Value | Use | Contrast |
|---|---|---|---|
| bg | #202122 | window | — |
| raised | #2a2b2d | segment control, chips | — |
| inset | #161718 | slider groove, thumbnail well | — |
| line | #3a3b3e | 1 px hairlines | 1.44 on bg (not text; see below) |
| text | #e4e6e8 | turn sentence, values | 12.89 on bg, 11.33 on raised |
| text2 | #aeb2b6 | step line, before → after | 7.56 on bg, 6.64 on raised, 8.41 on inset |
| text3 | #8d9196 | key hints, captions | 5.09 on bg, 5.66 on inset. **Never on raised (4.47).** |
| accent | #eda447 | Your-turn dot, primary fill, segment | 7.68 on bg and 6.75 on raised, as text |
| on-accent | #1d1305 | text on the primary | 8.72 on accent |
| ok | #86c296 | check glyph | 7.81 on bg |
| danger | #ee8064 | Abort text, triangle | 6.07 on bg, 5.34 on raised |
| working | #9fb7d4 | working ring | 7.83 on bg |

The island's edge and Abort's hairline are below WCAG's 3:1 for non-text contrast (line on bg 1.44). Both controls are identified by their text (6.07:1 and higher), not by the outline. This is a known trade-off (`option-a/NOTES.md` section 8).

### 8.2 Native tokens (Option B, and the rows inside A's details if Jim wants them native)

| Token | Value | Contrast |
|---|---|---|
| header | #292929 | header text #b0b0b0: 6.71 |
| body | #404040 | text #d0d0d0: 6.72; text2 #adadad: 4.62; hi #e6ebef: 8.64 |
| accent | #f0ad4e | 5.33 on body; 7.48 on header; on-accent #1d1305 on accent: 9.40 |
| danger | #f2937a | 4.56 on body, which passes WCAG AA for text at any size. By design it is used only on the 13 px / 600 Abort label (`option-b/NOTES.md:351`). |
| track / thumb | #2b2b2b / #cfcfcf | thumb on track 9.09 |
| Option B additions | frame #161616, line #353535, btn #555555, dis #8a8a8a | per `option-b/NOTES.md`, "Visual system" |

Reference: Lightroom's own item text, #b4b4b4 on #474747, is 4.48:1 (same script). The native tokens are slightly lighter so they clear 4.5:1.

### 8.3 Type

- **Font.** Inter variable, bundled. `docs/hud/fonts/inter.woff2` is byte-identical to `inter-latin-wght-normal.woff2` of `@fontsource-variable/inter` 5.3.0, licence OFL-1.1 [handle: `cmp` match; `docs/hud/fonts/package/package.json:3`, `:43`]. Use `@font-face` with weights 100-900. Lightroom's own Windows UI font is [unverified], so "native" here means conventions, not glyph-identical text.
- **Glyph coverage finding.** The bundled latin subset has no →, ←, ▲, ✓ or ⚠. It does have −, ±, ·, …, ↑ and ↓ [handle: `node docs/hud/spec-checks/glyphs.cjs` printed `U+2192 → fallback`, `U+2212 − Inter`, `U+25B2 ▲ fallback`, `U+2713 ✓ fallback`, `U+26A0 ⚠ fallback`]. So:
  - the state glyphs are inline SVG, never characters;
  - the "before → after" arrow is either an SVG or comes from shipping the full Inter file instead of the subset (proposed: ship the full file; its size is [unverified]).
- **Sizes:**
  - 15/600: the turn sentence;
  - 13/500: actions and identity;
  - 12/400: rows and lines;
  - 11 px: key hints and captions only.

  Line height about 1.35. Nothing smaller than 11 px.
- **Tabular figures** (`"tnum" 1`) apply to digit runs only. Inter's tnum also widens the hyphen, from 6 px to 8 px at 12 px, which spaced out "pre-session" and "18.0-105.0" (`option-a/NOTES.md` section 7; `option-b/NOTES.md`, "Visual system").

### 8.4 Spacing, icons, motion

- **Spacing:** a 4 px grid. Island and details paddings as in `option-a/NOTES.md` section 1, "Inner grid". Buttons are 28 px tall in the island; key controls are at least 28 x 28 px [inference: Lightroom's own buttons are small; 44 px is a touch rule, not Lightroom's].
- **Icons:** inline SVG on a 16 px box with a 1.5 px stroke:
  - ring (working), filled dot (your turn), check (done), triangle with "!" (problem);
  - chevron (details), × (hide), grip (drag). The × and the grip are proposals of this spec; the Option A mockups draw only the chevron (3.2, 4.1);
  - keycaps for hints.

  No icon font, no emoji.
- **Motion:**
  - ≤ 150 ms ease-out for width and height changes;
  - content cross-fade 100 ms;
  - the working ring pulses on a 1.6 s loop;
  - numbers never tween; values swap at once;
  - no bounce, shake or flash.
- **Reduced motion:** the pulse is static and size changes snap. Whether the web runtime maps Windows' "Animation effects" setting to `prefers-reduced-motion` is [unverified]; S9 checks it.
- **Never colour alone:** every state has words plus a shape (5.1). The selected chip has a frame and a filled keycap. A disabled control shows a reason line.

---

## 9. Performance budgets

Every number is an [inference] target until S9 or the acceptance check measures it on Jim's machine.

| Budget | Target | Measured by |
|---|---|---|
| Cold start (spawn to first paint) | ≤ 1500 ms | S9-1 |
| Warm show (turn state to visible) | ≤ 150 ms p95 | S9-2 |
| State update to paint | ≤ 100 ms p95 | S9-3 |
| Click to `userAction` in the engine | ≤ 50 ms p95 | Engine tool log: HUD event receive time against the HUD's click log (section 11.2) |
| Answer to buttons back on | ≤ 200 ms p95 on a direct channel. (Today the bridge's `hud_update` median is 18.1 ms, range 2.2-577.2 ms: `PHASE5.md:326`, `:354`.) | Tool log `answered_click_id` against the HUD log |
| Idle memory, whole process tree | ≤ 150 MB private bytes | S9-4. Note: there is no source for Grok's "80 MB". |
| CPU, hidden / visible and pulsing | ≤ 0.5 % / ≤ 2 % of one core | S9-5 |
| Selection poll cost | ≤ 1 bridge call per 2 s, only while idle in an open edit | Engine test (11.2) and tool log |
| Thumbnail | ≤ 80 KB each, at most once per copy per pass | Engine test (11.2) |
| Lightroom responsiveness | No difference Jim can notice | S9-11, acceptance 11.1 |

---

## 10. Copy deck

Rules:

- Use photographer's words: edit, copy, pass, snapshot, History, clipping.
- Never use session, engine, stage, seq or payload.
- One exception: "pre-session" is part of the snapshot's real name, "AVG pre-session " + ISO time (`begin.ts:49`).

### 10.1 Existing strings, used verbatim (`plugin/LrC-AVG.lrplugin/HudText.lua`)

| Key | String | Line |
|---|---|---|
| HEADLINE.none | No edit running. In Claude Desktop, ask Claude to edit a photo. | 40 |
| HEADLINE.not_running | LrC-AVG is not running: reload it in File > Plug-in Manager. | 41 |
| HEADLINE.not_connected | Claude is not connected. Your edit so far stays. | 42 |
| HEADLINE.checking | Checking this edit with Claude... | 43 |
| HEADLINE.gone | This edit is no longer open in Claude. Your edit so far stays. | 44 |
| HEADLINE.working | Claude is working. Nothing needed from you. | 45 |
| HEADLINE.awaiting_pick | Your turn: pick a copy, or tell Claude which one. | 46 |
| HEADLINE.approve | Your turn: approve pass %d so Claude can go on. | 47 |
| HEADLINE.converged | Your turn: Claude thinks the edit is done. | 48 |
| HEADLINE.target_changed | Your turn: select the edit's photo again. | 49 |
| HEADLINE.accepted | Done: the edit is kept. | 50 |
| HEADLINE.aborted | Done: the photo is back as it was. | 51 |
| HEADLINE.ended | The edit has ended. | 52 |
| STEP.* | Starting · Setting profile, lens corrections and baseline · Applying pass · Rendering a preview · Measuring the preview · Claude is looking at the result · Waiting for your pick · Waiting for your approval · Claude thinks the edit is done · Another photo is selected · Accepted · Aborted · Ended | 57-63 |
| CONNECTION.* | Connected to Claude. · Not connected to Claude. · LrC-AVG is not running in Lightroom. | 65-69 |
| UNDO / UNDO_NO_SNAPSHOT | To undo it: Develop > Snapshots > %s · the newest AVG pre-session snapshot | 72-73 |
| CLIPPING_OK | Clipping: within limits. | 75 |
| CLICK.* | %s sent; waiting for Claude. · %s not sent: %s. · %s: no answer from Claude within %d s; the buttons are on again. · " (waited %d s)" | 79-84 |
| REASON.* | Claude is not connected · LrC-AVG is not running · no edit is open · the edit has ended · no pick is waiting · no pass is waiting for approval · the %s is still waiting for Claude · the edit changed before it could be sent · this edit is no longer open in Claude · LrC-AVG could not encode it | 85-96 |

Strings outside `HudText.lua`, despite its header (`HudText.lua:2-3`):

- **In `HudState.lua`:** button and click labels "Pick %s", "Approve pass %d", "Accept", "Abort" (`:185-190`); `SELECTION_OK` and the "Target changed: …" sentence (`:228-237`).
- **In `HudView.lua`:**
  - "ISO ", "lens profile ";
  - "Photo: ", "Camera: ", "Step: ";
  - "Session settings:" and "Settings page (the next session reads them):";
  - "Changes in the latest pass";
  - Slider / Before / After / Change;
  - the settings words "approve each pass", "autonomous", "max N passes", "N variants", "preview N px qN", "clip limits … % high, … % low" and "decay …".

  These are at `HudView.lua:93`, `:97`, `:138` ("Photo: "), `:98` ("Camera: "), `:86-88` ("Step: "), `:152`, `:194`, `:209`, and the settings words at `:43-54`.

The new HUD **drops**:

- the "Photo:", "Camera:" and "Step:" prefixes;
- the grid headers and "Changes in the latest pass";
- "Session settings:", which puts "session" on the HUD face.

All of these are replaced by the strings in 10.2.

### 10.2 New strings (all proposed)

| Where | String |
|---|---|
| Phase words | Working · Your turn · Done |
| Island sentence at `awaiting_pick`, short form | Your turn: pick a copy (the first clause of `HEADLINE.awaiting_pick`; the details show the full sentence; `option-a/NOTES.md:329`) |
| Island step, short form | pass %d of %d |
| Details | Pass %d of %d · %s (step line) |
| Tabs | This pass · Whole edit |
| More rows | +%d more |
| Undo | Each step in History starts with “%s”. |
| Settings | Edit settings · Change in File > Plug-in Manager. · Autonomous · Approve each pass · up to %d passes · preview %d px |
| Settings page fallback title | Settings page (the next edit reads them) |
| Consequences | Lets Claude write pass %d. · Ends the edit; the sliders stay as they are. · Ends the edit and keeps copy %s; the other copies stay in the catalog. · Stops Claude and puts the pre-session snapshot back. · Stops Claude and puts the master back; the copies stay in the catalog. · Claude continues on this copy. A pick is final. |
| Disabled reasons | Comes back after a pick. · Accept and Abort come back when Claude reconnects. |
| Abort confirm | Press again to abort |
| Key hints | Enter · Ctrl+Backspace · Esc · 1 2 3 · closes |
| Chips | %s %s (letter, label from `copies[].label`, e.g. "B dramatic") |
| Island undo, short form | Undo: Snapshots > %s (with "…" when long; the full name is in the details) |

### 10.3 Engine notes, shown as given (owned by the engine)

These are passed in `note` and shown on one line:

- `hud-actions.ts:62-63`, `:86-88`, `:127`, `:139`, `:144`, `:156`, `:165`, `:183`, `:187`, `:199`, `:207-209`, `:224`, `:226`, `:232-236`, `:246`, `:261`, `:263`, `:282-290`;
- `approval.ts:63`, `:84-98`, `:156`, `:186`;
- `manager.ts:171-172`;
- `events.ts:48`, `:86`;
- `variants.ts:30`; `engine/src/session/probe.ts:25`;
- Lightroom version notices (`begin.ts:95`).

Guardrail sentences come from `payload.ts:119-170`. All are checked for engine words by `tests\hud-labels.test.ts` and the harness's `hudWordProblems` (`engine/tests/helpers/hud-harness.ts:1-5`). New channel strings join that check (11.2).

---

## 11. Acceptance criteria

### 11.1 Jim's observations in Lightroom

Lightroom-side results are Jim's observations (`CLAUDE.md`, Rules). The harness asks these and saves the answers (rule 04). Each line passes only on Jim's tick.

**Opening and focus**

- [ ] A1 At Claude's first `lr_begin_session`, the HUD appears in Lightroom's top band within 2 s, and the classic window does not open.
- [ ] A2 Right after it appears, `\` in Develop still switches to Before. The keyboard stayed with Lightroom.
- [ ] A3 While Claude works, the HUD never takes the keyboard or comes in front of Claude Desktop.
- [ ] A4 When your turn comes, the HUD shows "Your turn: …" with the amber dot. It does not take the keyboard.

**Placement**

- [ ] A5 At rest the island covers no part of the photo, the left or right panels, or the filmstrip, at your usual window size and display scaling.
- [ ] A6 Quitting Claude Desktop mid-edit leaves the HUD showing "Claude is not connected. Your edit so far stays." and the undo line with the snapshot's name.
- [ ] A7 Moving, resizing, minimising and restoring Lightroom: the HUD follows, hides and comes back.
- [ ] A8 With Claude Desktop in front, the HUD is not on top of it. Back in Lightroom, it is on top again.
- [ ] A9 In each Lightroom screen mode, the HUD stays visible over Lightroom.
- [ ] A10 Quitting Lightroom closes the HUD within 5 s.

**Turns and actions**

- [ ] A11 Approve each pass mode: "Approve pass 1" is the only filled button. Its line says what it does. Enter approves it when the HUD has focus.
- [ ] A12 Converged: Accept is the only filled button. Accept ends the edit, and the HUD shows "Done: the edit is kept." and stays.
- [ ] A13 Abort (one click) puts the photo back. The HUD shows "Done: the photo is back as it was." Develop > Snapshots has the named pre-session snapshot.
- [ ] A14 Ctrl+Backspace once shows "Press again to abort". Esc cancels. Twice aborts.
- [ ] A15 Esc never aborts. It closes the details, or hands the keyboard back to Lightroom.
- [ ] A16 After any click the buttons go quiet, and the line says what was sent, until Claude's answer shows.

**Variants**

- [ ] A17 At the pick, three chips show each copy's look and name. A click picks. 1/2/3 then Enter picks. Lightroom shows the picked copy.
- [ ] A18 Before a pick, Accept is not offered.

**Changes view**

- [ ] A19 Rows use Lightroom's slider names, in Basic panel order. The slider marks match where the sliders sit in the Basic panel.
- [ ] A20 "Whole edit" lists everything that differs from the pre-session snapshot.
- [ ] A21 Selecting a photo outside the edit shows the "Target changed" line within about 2 s, while the edit waits for you.

**Look**

- [ ] A22 Text is readable at a glance. Nothing is smaller than the key hints. Nothing depends on colour alone.
- [ ] A23 The HUD looks at home next to Lightroom's panels. (Jim's judgement; any "no" goes back to D4.)

**Fallback**

- [ ] A24 With the HUD app removed or renamed, the classic HUD opens by itself at the next edit, and its buttons work as before.

### 11.2 Simulator tests the implementer adds

Location: `engine\tests`. Built on `engine/tests/helpers/lightroom-sim-hud.ts` (SimHud), `engine/tests/helpers/hud-harness.ts` (hudRig) and a new `SimHudClient` helper for the channel.

| Test file (proposed) | Checks |
|---|---|
| `hud-channel.test.ts` | Endpoint file written at lock and deleted at release and shutdown. Wrong token closes the socket. Welcome carries the open edit's id. Full state after hello. seq rises by 1. 3 missed pings drop the client. A second hello replaces the first. |
| `hud-channel-schema.test.ts` | `hudChannelStateSchema` refuses unknown fields (strict after `.extend`; true in zod 4.6.5 per 3.3, kept as a guard against an upgrade). Every engine state passes. `rows` ≤ 12, `whole_edit.rows` ≤ 40. Text ≤ 120 bytes. |
| `hud-channel-events.test.ts` | Channel events reach `userAction` once. A `click_id` sent on both surfaces acts once. The answer returns to the clicking surface. `via` is recorded. |
| `hud-fallback.test.ts` | `open: true` goes to SimHud only when no channel client connects within the wait. With a client, the plugin still gets every state without `open`. The Lua payload is byte-identical to today's for the same session, apart from the omitted `open`, which today rides on the begin update until the plugin takes one (`manager.ts:130`; `publisher.ts:10-11`, `:203`). |
| `hud-thumbs.test.ts` | 480 px long edge. Key from letter, pass and hash. At most one per copy per pass. Dropped at session close. ≤ 80 KB on the sim's renders. |
| `hud-extras.test.ts` | Copies with labels from the intent. `picked`. Whole-edit rows from `startSettings`. Panel order. Ranges from `canonical.ts`. Weights. `history_prefix` = "AVG " + `s.short`. |
| `hud-selection-poll.test.ts` | Polls only while idle, an edit is open and a client is connected. None during a step or copy creation. Copies count as in the edit. `no_target_photo` leads to the `targetChangedLine` sentence for no selection, "Target changed: No photo is selected. …" (3.5). |
| `hud-launch.test.ts` | Spawns once at begin when no client is connected. Respawns at most once per edit. No spawn when the executable is missing; the classic fallback opens instead. |
| `hud-labels.test.ts` (extended) | Every new channel string and consequence line passes `hudWordProblems`. |

The HUD app's own tests are runtime-specific and are chosen after D2:

- the state table (5.2) driven by recorded states;
- precedence;
- the pending overlay timing;
- Abort arming;
- the keyboard map.

---

## 12. Not building, and why

| Not building | Why |
|---|---|
| A chat transcript or prompt box | That is Claude Desktop (`PRODUCT.md:13`) |
| Histogram, curve editor, before/after canvas | Lightroom has them. The anti-reference is "every field shown at once" (`PRODUCT.md:29`). |
| Live intermediate diffs while Claude moves sliders | Rows change at pass boundaries. The payload carries the last pass (`payload.ts:45`). |
| Put back, per-pass revert, hold-to-compare | No support exists (section 6, D5). They need new engine commands and Jim's decision. |
| A settings editor in the HUD | The Plug-in Manager page owns settings (AVG-006, `CLAUDE.md:18`). |
| Theme switcher, light mode, glass, blur, transparency | Fight the photo. One look. |
| macOS support | Windows-only product (`CLAUDE.md:3`) |
| Cross-process owner window; permanent always-on-top | Input-queue coupling, and floating over Claude Desktop (section 4.3) |
| Global hotkeys | They would take keys from Lightroom (section 4.6) |
| Sound, flashing, taskbar flash, bounce, number tweening | "Interrupting" (`PRODUCT.md:31`); a tweened value hides the value |
| LrWebViewFactory | Only for Web-module engines (https://lrc.mcor.dev/modules/LrWebViewFactory.html: "only available in web engines") |
| A second Lua dialog mirroring the HUD | The classic HUD is a fallback, not a mirror. It opens by itself only when the new one is absent (3.4). Today a menu item also opens it; keeping it closed then needs the plugin fix in D1, "Known conflict". |
| `requestJpegThumbnail` thumbnails | The engine already has the exact renders (3.6) |
| Grok's message contract | The real contract is `HudUpdatePayload` (`hud-protocol.ts:83-108`) |
| Changes to the Lua `hud_update` | Strict schema and lockstep plugin release (3.4). The one possible exception is the signal for the menu-item fix (D1), if Jim takes it and it is sent as a field. |

---

## 13. Open questions and [unverified] items

### 13.1 Open questions for Jim

- **Q1.** Pass `save_frame` to the classic HUD so it keeps where you put it? It is a small plugin change. The SDK says it saves "the position of the dialog as one of the plug-in settings" (LrDialogs.html, D1); whether that works for the floating dialog on your LrC 15.6 is [unverified].
- **Q2.** Answered in part [stated: Jim, 2026-10-04]: Put back "cancels the session and reverts the image to the pre-edit state". Follow-up in Q14.
- **Q3.** Island anchor: the window's centre line (default) or a remembered drag position only? And should A get the drag grip at all? Its mockups draw none (4.1).
- **Q4.** Keyboard way into the HUD. Today every File > Plug-in Extras item opens the classic HUD, which takes the keyboard (D1, "Known conflict"), so the menu is a keyboard path only with that plugin fix. With the fix, is acting from the menu enough, or should "LrC-AVG - Show Vision Gateway HUD" also focus the new HUD, as Option A proposes (`option-a/NOTES.md:221-228`)? That needs the same plugin change plus an engine message to the HUD.
- **Q5.** Pointer Abort: one click, as today, or arm and confirm like the keyboard?
- **Q6.** When all passes are used, the HUD says "Claude is working" while the note says to Accept or Abort (`hud-actions.ts:290`). Treat this as a Your turn state? It is an engine change.
- **Q7.** During a pick, should A's details show C-style large copy cards? Proposed answer: yes, to keep the three layouts' function the same (D4, gap 1).
- **Q8.** Settled on `main` by #72: the HUD hides 10 s after any end (section 1.6). The new HUD follows it.
- **Q9.** Lights Out and other modules: should the HUD hide outside Develop?
- **Q10.** Install path, and whether the HUD comes with the plugin's installer or separately.
- **Q11.** Pick with the pointer: one click on a chip (this spec, as today), or choose then confirm, as Options B and C draw it? A pick is final (`hud-actions.ts:234`). Should choosing also select the copy in Lightroom (E12), and should `target_changed` get a "Select <file>" button (E13)?
- **Q12.** The HUD offers the pick only at `awaiting_pick`, after every copy's refined pass (`engine/src/session/pick.ts:21`; `HudView.lua:163`), so the chips show pass-1 renders. Claude can pick earlier: `lr_select_variant` is accepted before every copy is refined (`pick.ts:4-5`, itself tagged [inference] there; `picked_before_refining` at `pick.ts:101`). Is `awaiting_pick` the moment you want the copies shown in the HUD, or should they appear as each copy finishes?
- **Q13.** Decision 6 opens the HUD by itself once per edit (`Hud.lua:9-11`; `publisher.ts:10-11`). This spec proposes that a HUD you hid shows itself again, without taking focus, at each Your turn (3.2, 4.2). Change decision 6 that way, or keep it: hidden stays hidden until the next edit? The re-show is close to the "Interrupting: pop-ups" anti-reference (`PRODUCT.md:31`).
- **Q14.** Answered [stated: Jim, 2026-10-04]: "keep both using existing functionality". Abort goes through the engine; Put back is the plugin's own (D5, section 1.6).
- **Q15.** Answered [stated: Jim, 2026-10-04]: "agreed, but don't start until I say go, there is a session already in progress in Claude code cli". v1 = E1-E4, E6-E8 and E10.
- **Q16.** Answered [stated: Jim, 2026-10-04]: "yes to all". This spec, the critique and the mockups go into `docs\hud\` on branch `phase-6/hud-spec`, with a draft PR, and the `PRODUCT.md` amendment (D1) rides in the same PR.
- **Q17.** When Claude has been away 10 s during an open edit, should the plugin open its classic window by itself, so that Put back is one click away? Today it shows Put back only in that window, which the new HUD replaces (D5, "Put back"). That would be a plugin change, and it is close to the "Interrupting" anti-reference (`PRODUCT.md:31`). The alternative, which is what this spec does now with existing functionality only, is that the new HUD shows the menu path.

### 13.2 Every [unverified] item in this spec

1. Whether `save_frame` keeps the classic floating dialog's position on Jim's LrC 15.6 on Windows. What it stores is documented: the dialog's position, as a plug-in setting (LrDialogs.html; D1, Q1).
2. Whether a `push_button` can be filled or emphasised in LrView (D1).
3. The classic dialog's z-order on Jim's LrC 15.5.1 and 15.6. The Full Screen bug was marked fixed, then reported back in 15.2 (the poster first wrote 15.3, then corrected it) [community]; the threads cover 14.3.1-15.3 (D1).
4. Footprint (disk, memory, CPU) of the Tauri HUD (D2, section 9). Measured by S9-4, S9-5 and S9-12. Electron and the C# shell were dropped at D2.
5. Later shows without activation for WPF's `ShowActivated` (D2).
6. `tauri-plugin-single-instance`'s behaviour on Windows (3.2). The crate exists (2.5.2, crates.io index).
7. Whether Claude Desktop kills a detached child process when it quits (D2, S9-9, A6).
8. Settled: zod 4.6.5's `.extend` keeps `strictObject` strict (3.3, `docs/hud/spec-checks/zod/strict-extend.cjs`). Kept here so the numbering holds.
9. `get_selection`'s round-trip time (3.5).
10. Settled: `requestJpegThumbnail` after `applyDevelopSettings` gave no image in Phase 0 (`docs/reports/phase0/PHASE0.md:119`; 3.6). Kept here so the numbering holds.
11. Lightroom's process image name and main-window title pattern (4.1).
12. Lightroom's band, panel and filmstrip geometry at Jim's window size and scaling. The SDK exposes none of it (4.1, D4).
13. Second monitor, per-monitor DPI, and Lightroom's secondary display window (4.4).
14. HUD behaviour in Lightroom's screen modes, and detection of Lights Out (4.5).
15. Alt+Tab reach for a window shown without activation (4.6).
16. Lightroom's panel names and HSL tab order in LrC 15.6 (7).
17. Lightroom's Temp slider mapping (7).
18. Lightroom's own UI font on Windows (8.3).
19. The size of the full Inter font file (8.3).
20. The mapping of Windows "Animation effects" to `prefers-reduced-motion` in Tauri on WebView2 (8.4).
21. Every number in section 9 and every S9 target.
22. The "Target changed" line in Lightroom after its fix: it was never seen in a probe (`HudSelection.lua:4-7`).
23. Shutter and aperture formats from real Lightroom (`payload.ts:8-10`).
24. Desktop holding a 60 s tool call while an approval waits (`approval.ts:28-33`).
25. Inherited code headers still say [unverified] for approve, pick, accept and Variants. `PHASE5.md:291-303` verified them in LrC 15.5.1. This is a stale-comment cleanup, outside this spec.
26. Lightroom's filmstrip height when the photographer resizes or hides it, which matters for Option C (`option-c/NOTES.md` section 8).
