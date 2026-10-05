# LrC-AVG HUD: critique of the Grok spec (2026-10-04)

**Verdict.** Keep Grok's diagnosis and its list of things not to build, but not its spec: it assumes per-pass Keep and Revert, variant toggles and a Put back command, yet every pass is already written to the photo, Pick is a one-time choice between two or three virtual copies (three by default, `Prefs.lua:36`), and the HUD's only way back is Abort. In Converge mode Abort applies the pre-session snapshot; in Variants mode it puts back only the master, and the copies keep their edits (`hud-actions.ts:124-128`; `end.ts:4-8`). Rebuild the redesign on the real `HudUpdatePayload` and its four events, and decide separately whether the HUD stays native LrView or becomes an external window; that call is yours, because it amends PRODUCT.md principle 5 and the stack rule and brings Rust or Electron, Win32 focus work and a new data path that Grok does not count.

Conventions:
- Paths are relative to the gateway clone at `main` 75369b7 (read only).
- "Grok:N" is a line of the Grok draft (`5246a231-fusion-response_2026-10-04.md`).
- "shot" is your screenshot of 2026-10-04 (`scratchpad/lr.webp`, not in the repo). Its colours were sampled with `scratchpad/sample.cjs` and `scratchpad/sample2.cjs` in this session (commands below the §2 table).
- "research/" is `scratchpad/hud/research/`, which holds raw copies of fetched sources, cited by file name and line. It has no numbered index.
- lrc.mcor.dev, helpx.adobe.com and community.adobe.com are blocked from this container. Those pages were read through a Tavily extract on 2026-10-04 and are cited by URL.
- Grok's wording ("Keep the process model in your spec", "Your stack is the right one. Tauri v2…", Grok:40, :213) suggests the Tauri idea came from your own brief, which I have not seen [inference].

---

## 1. Keep: what the draft gets right

1. **The dialog covers the photo.** It is light grey (#f2f2f2), centred and large (shot). Moving it off the image is the first win.
2. **Equal-weight buttons hide the hierarchy.** Every button is the same `push_button`, 12 characters wide, except Approve at 16 (`plugin/LrC-AVG.lrplugin/HudView.lua:185-207`).
3. **The diff grid wastes space.** The four-column grid keeps 12 rows of cells even when a pass changed 2 sliders (`HudView.lua:194-199`; `engine/src/bridge/hud-protocol.ts:51` rows 12). Before, After and Change are two facts shown three ways. See §3 D8: Grok's own mock repeats all three.
4. **Settings constants do not belong on the HUD face** (shot; `HudView.lua:210`).
5. **"Bridge up" and "Claude connected" are different states.** The HUD already separates them (`HudText.lua:41-42`, `:65-69`). Keep it that way.
6. **Name the edit's photo, not the current selection, and show a mismatch as a banner rather than a silent apply.** This already works: the engine refuses with TARGET_CHANGED and writes nothing (`engine/src/session/io.ts:25-40`), and the HUD says "Your turn: select the edit's photo again." (`HudText.lua:49`).
7. **Lua stays the only catalog writer.** The HUD sends intents, never calls the SDK, never opens its own channel to Claude, and never forks a second control path (Grok:215).
8. **Do not build** a chat box, a histogram, a curve editor, a theme switcher, live intermediate diffs (Grok:266-272) or a confirm on every Keep, which is Grok's label for Approve pass (Grok:56, :172). Showing deltas only at pass boundaries matches how the engine works: it sends the last pass only (`engine/src/hud/payload.ts:45`).
9. **Destructive controls state their catalog consequence** (Grok:279). This is PRODUCT.md principle 4 (`PRODUCT.md:39`).
10. **Type and numbers:**
    - tabular figures;
    - no number tweening;
    - a 12 px reading floor;
    - sign and number carry direction, never red and green (Grok:134, :203, :209).
11. **The fact behind "Applies to the next session" is right; the label is not endorsed.** The settings page says "Saved as you change them. Claude's next session reads them; a session already open keeps its own." (`PluginInfoProvider.lua:122`). On the HUD, the word for this is "edit", not "session" (D12). "Do not build a second preferences file" is also right (Grok:153).
12. **No pixels on the socket.** Previews already cross as a file path (`engine/src/preview/service.ts:3-4`).
13. **Avoid `requestJpegThumbnail`.** The conclusion is right. Grok's reason is [unverified], and the repo's evidence is different (§2 row 17).
14. **`LrWebViewFactory` cannot host a HUD.** Its controls are built "within a section in a Web-module panel" (https://lrc.mcor.dev/modules/LrWebViewFactory.html).
15. **Grok's dark tokens pass WCAG AA on #1C1C1C:**
    - text 13.68;
    - text-dim 5.73;
    - text-faint 4.60;
    - danger 5.78;
    - amber button label 8.63 (`node scratchpad/contrast.cjs`, this session).

    One exception: text-faint on `raised` #242424 is 4.19, so key hints must never sit on cards.

---

## 2. Factual errors

| # | Grok says | Reality | Handle |
|---|---|---|---|
| 1 | Window title "LRC-MCP - Vision Gateway". Keep LRC-MCP as the process and protocol name (Grok:58) | The title is "LrC-AVG - Vision Gateway". The product name LRC-MCP does not exist in the repo | `plugin/LrC-AVG.lrplugin/Hud.lua:39`; shot title bar; `grep -rni "lrc-mcp"` over the repo: 0 hits |
| 2 | Connection line "Yet connected to Claude." (Grok:11) | "Not connected to Claude." | `HudText.lua:67`; shot |
| 3 | Identity line "· 50mm ·" (Grok:76); contract field `meta: "50mm · f/4.2 · ISO 200"` | The shot says 32 mm. The HUD payload has no focal-length field. The plugin's `get_context` reads `focalLength`, but the session's exif keeps only iso, shutter, aperture and lens | `hud-protocol.ts:58-67`; `Develop.lua:98`; `engine/src/session/begin.ts:82`; shot |
| 4 | "Preview long edge — 1000 px" (Grok:148); "Reuse the gateway's existing 1000px preview export" (Grok:217) | The preview is 1600 px at q75 (default 1600, range 800-1920). The engine deletes each export right after reading it, so there is no file to reuse | shot; `Prefs.lua:37-38`; `service.ts:6` |
| 5 | Decay "1, 0.8, 0.4, 0.25" (Grok:151) | "1, 0.6, 0.4, 0.25" | shot; `Prefs.lua:41` |
| 6 | "Clicking the HUD must not block Lightroom. That is the actual reason to leave `LrDialogs`" (Grok:56) | The floating dialog is already non-modal. You changed the selection with it open and the observer fired. It stays open across edits. Its real limits are elsewhere: it takes the keyboard when it opens, and its z-order on Windows changes between LrC versions (§5) | `docs/reports/phase5/S8.md:122`, `:125`; `Hud.lua:14-16` |
| 7 | Approve pass = "Keep this pass / Becomes the baseline for the next pass" (Grok:172) | Approve exists only in approve_each_pass mode, where it releases `lr_step` for the next pass. The step waits up to 60 s. Passes 0 and 1 are not gated, there is no Approve after the last pass, and in autonomous mode Approve never lights | `engine/src/session/approval.ts:1-17`, `:34`, `:55-60`; `payload.ts:34`, `:44` |
| 8 | A "Put back" gateway command, `put_back` (Grok:174, :262) | Main has four HUD events and no Put back. Your running build shows a Put back button, so it differs from main. What that button does is unknown | `hud-protocol.ts:48`; `HudView.lua:201-207`; shot |
| 9 | Commands `pick`, `approve_pass`, `accept`, `put_back`, `abort`, `set_setting` (Grok:262) | `hud_pick{variant}`, `hud_approve_pass{pass}`, `hud_accept`, `hud_abort`, each carrying `session_id`, `seq_seen`, `click_id` and `source`. The bridge has `get_prefs` but no command that writes settings | `hud-protocol.ts:119-133`; `engine/src/bridge/protocol.ts:210`, `:257` |
| 10 | Variant cards, one marked "In Lightroom" with an amber ring; Pick "Shows in Lightroom"; `appliedInLr` (Grok:95, :171, :243) | The variants are two or three virtual copies (A-B or A-C; three by default), all in the catalog at once; the master is not edited. Pick chooses which copy Claude continues on, and it can be made only once ("Copy X is already picked"). The engine already selects each copy while it edits it | `engine/src/session/variants.ts:1-4`; `Prefs.lua:36` (`variantCount` min 2, max 3, default 3); `hud-actions.ts:231-238` (pickRefusal); `engine/src/session/targets.ts:12-14` |
| 11 | Variants on every pass: "Pass 2 of 6" with three cards and "Keep this pass" (Grok:77-93, :278) | Variants happen once, at the start: pass 0 plus one refined pass per copy. After that the edit converges on the pick alone | `variants.ts:1-4` |
| 12 | Autonomous is the special case: "If the gateway can apply passes without a stop…" (Grok:138). The mock says "not auto" (Grok:77) | Autonomous is the default mode and your current setting | `Prefs.lua:34`; `CLAUDE.md:18` (AVG-006); shot "autonomous" |
| 13 | "Revert … must work on the last applied pass"; "Revert preview — restores the last keep" (Grok:138, :174) | There is no user-triggered per-pass revert and no "keep" state; only the guardrail undoes a pass on its own, writing a "clip revert" or "region revert" History step. Abort applies the pre-session snapshot (in Variants, to the master only). Earlier passes are in Lightroom History, with step names like "AVG 618087 pass 1/4 guard 3" | `hud-actions.ts:5-9`; `engine/src/hud/payload.ts:121-124` (status `undone`); `engine/src/session/guardrail.ts:177`; example step: `docs/reports/phase5/P5/p5_chat_sessions/20261001-618087.json`; name format: `io.ts:148-152` |
| 14 | "Unkept preview is applied"; "Revert if a preview is applied" (Grok:161, :175) | Each pass writes Develop settings to the photo. The "preview" is an export JPEG the engine reads, measures and deletes. Claude gets it in the tool result, which the user can open in Claude Desktop's expanded tool call; the engine also keeps the last render in memory. It is not a trial state of the photo | `service.ts:3-7`; `variants.ts:18` ("P-10: the image shows only in the expanded tool call"); `engine/src/session/types.ts:134` (`jpeg: Buffer`), `:158` (`last`); `io.ts:148-152` |
| 15 | "The HUD process listens on 127.0.0.1 only. Lua reconnects" (Grok:217) | Backwards, and impossible as written. LrSocket can only listen; it has no outbound connect. Lightroom listens on 8765 and 8766 and the engine connects. The plugin serves one bridge client at a time | https://lrc.mcor.dev/modules/LrSocket.html (the only opener is `LrSocket.bind`, "Opens a socket connection (on localhost)", whose `onConnecting` is "called when the socket begins listing [sic] for a connection"); `engine/src/bridge/client.ts:3-7`; `Sockets.lua:5-6`; `Bridge.lua:15-18` (P-13) |
| 16 | "Bind with a per-launch token … mode `0600`" (Grok:217) | A token already exists at `%USERPROFILE%\.lrc-avg\bridge_token`. 0600 is a POSIX permission mode; Windows uses ACLs [inference]. Any process running as the same user can read the token [inference] | `Endpoint.lua:1-10` |
| 17 | Avoid `requestJpegThumbnail` because "in Develop it can return a full-resolution JPEG and stall the plugin" (Grok:219) | Grok's reason is [unverified]: S1 did not test it. The repo's evidence is different. After a Develop change, no image arrived within 30 s, each request answered at once with "error loading thumb", in 5 of 5 steps. Without a change, sizes varied for a 1600 px request: 1890×1260 in run 1, 945×630 in run 2. The plugin does not use it | `docs/reports/phase0/S1.md:122`, `:123`, `:149`; `Preview.lua:5-7` |
| 18 | Message contract with `bridge`, `claude`, `phase`, `selectionMatches`, `thumb`, `summary`, `impact`, `group` (Grok:221-260) | The real contract is `hudUpdatePayloadSchema`, a strict object. The plugin refuses any unknown field, so every new field needs a plugin change. The connection state is computed in the plugin, not sent | `hud-protocol.ts:9-11`, `:83-108`; `Events.lua:23-27` |
| 19 | "Map SDK keys to panel labels (`Exposure2012` is Exposure)" as new work (Grok:119) | Already done. The engine sends Lightroom's labels in `deltas[].slider`, and you checked them against LrC 15.5.1 | `engine/src/params/labels.ts:1-3`; `payload.ts:103` |
| 20 | Groups "… Effects, Calibration, Optics" (Grok:119) | Lightroom Classic's panel is "Lens Corrections", not "Optics". Adobe's walkthrough of the right-hand panels says to "start at the top and work down", naming Basic, then Tone Curve and HSL/Color/B&W, Color Grading, then Detail and Lens Corrections; the exact full order is [unverified] | `labels.ts:35-37`; https://helpx.adobe.com/lightroom-classic/desktop/help/applying-adjustments-develop-module-basic.html |
| 21 | "Heartbeat every few seconds so a dead plugin becomes a red dot" (Grok:262), as new work | Already exists: a ping every 2 s, with a drop after 3 silent beats. During a session the engine allows 60 s of silence | `client.ts:6-7`; `engine/src/mcp/bridge-gate.ts:27-35` |
| 22 | The same window and type "on Windows and macOS"; "Do not depend on SF Pro" (Grok:203, :282) | The product is Windows-only | `CLAUDE.md:3` |
| 23 | "Lightroom around it is a dark charcoal tool" (Grok:20, :183) | Your panels are mid-grey with darker headers, black bands, a light-grey loupe surround and white Windows title and menu bars. Measured (mode of each box): panel bodies #424242-#474747, headers #292929, top band and filmstrip header #000000, loupe surround #d3d3d3, title bar #f3f3f3, menu bar #ffffff; 1 px panel separators #111111-#1f1f1f. #1C1C1C is darker than every surface except the black bands and most separators (#111111-#1b1b1b) | the two `sample*.cjs` commands below the table, this session |
| 24 | "Pinned, it stays above Lightroom only" (Grok:52) | Tauri has no such option. In JS and in config, `parent` accepts only another Tauri window (a `Window`, `WebviewWindow` or label). Only the Rust builder's `owner_raw(HWND)` and `parent_raw(HWND)` take a foreign window. `parent_raw` makes a WS_CHILD window confined to Lightroom's client area, so `owner_raw` is the only floating option, and a cross-process owner attaches the two threads' input queues | research/tauriapi/package/window.d.ts:2178-2190 (`@tauri-apps/api` 2.12.1, package.json:3); research/tag_webview_window.rs:716-733 (identical to tauri-v2.12.1 `crates/tauri/src/webview/webview_window.rs` on raw.githubusercontent.com, `cmp`, this session); https://devblogs.microsoft.com/oldnewthing/20130412-00/?p=4683; research/md_nf-winuser-attachthreadinput.md:94 |
| 25 | Surface "once" without stealing focus (Grok:54, :283), on Tauri | A Tauri window skips activation only on its first show at creation. A later `show()` uses SW_SHOW, which activates. Read from the code, not run. Tauri's `focusable: false` / `setFocusable(false)` sets WS_EX_NOACTIVATE. Whether a later `show()` then stays inactive is [unverified]. Such a window does not become the foreground window when clicked, so keyboard operation (`PRODUCT.md:44`) would need it made focusable again [inference] | tao-v0.37.1 `platform_impl/windows/window_state.rs:459-465`, `:293-294`, `window.rs:1263-1265`, `:1415-1419` (research/tao_tag_ws.rs and research/tao_tag_w.rs, each identical to the tao-v0.37.1 file on raw.githubusercontent.com, `cmp`, this session); research/tauriapi/package/window.d.ts:2094 (`focusable`), :1265 (`setFocusable`); research/md_extended-window-styles.md:31 |
| 26 | "`LrView` … limited fonts … no real type ramp" (Grok:22) | Overstated rather than wrong. Named fonts and a `{name, size}` table exist: `font` takes "the name of a font, or one of these canonical name strings", or a table, and `size` is `regular`, `small` or `mini`. The canonical names themselves are [unverified]: the extract strips them, and the four `<system…>` strings in an earlier draft of this row have no handle. Whether named fonts and sizes render in LrC on Windows is [unverified]; until then the documented choices are a limited type ramp | https://lrc.mcor.dev/modules/LrView%20control%20view%20properties.html (`font`, `size`) |

Row 23 commands, run in `scratchpad/` (the shot is 2000×1097; boxes are `[name, x, y, w, h]`, points are `[name, x, y]`):
- `node sample2.cjs lr.webp '[["leftPanelBody",150,740,60,100],["rightPanel2",1790,560,150,40],["rightPanelQuickDev",1790,390,40,40],["leftHeaderNavigator",110,100,30,14],["rightHeaderHistogram",1800,100,100,14],["topBand",300,50,400,20],["filmstripHeader",1500,1032,100,10],["loupeSurround",1700,300,60,200],["titleBar",600,8,400,10],["menuBar",600,28,400,8]]'` → modes #474747, #424242, #474747, #292929, #292929, #000000, #000000, #d3d3d3, #f3f3f3, #ffffff.
- Separators: `node sample.cjs lr.webp` over the points x=1850, y=240-330 and x=120, y=300-345, keeping those below #202020 → (1850,267) #131313, (1850,291) #111111, (1850,315) #1b1b1b, (120,336) #1f1f1f.

---

## 3. Design problems

**D1. A preview-then-commit mental model**
- The draft builds on Keep this pass, Revert preview, "last keep" and "unkept preview" (Grok:86-90, :169-177).
- *Why it matters:* the photographer is told the photo is in a trial state when Claude has already written each pass to it (§2 rows 13-14). A person who closes Lightroom believing nothing was kept is wrong in the dangerous direction.
- *Replace with* the real model, stated once in the HUD's words:
  - every pass is already on the photo;
  - **Accept Edit** ends and keeps it;
  - **Abort Edit** puts the photo back as it was before the edit (Converge), or puts the master back while the copies keep their edits (Variants) (`hud-actions.ts:124-128`; `end.ts:4-8`);
  - a single earlier pass is reached through Develop > History, under "AVG <id> pass n/N" (`io.ts:148-152`).

**D2. Variant cards as a switchable toggle, with an "In Lightroom" ring and digit keys**
- *Why it matters:* Pick is a one-time commitment, and all the copies already exist in the catalog (§2 row 10). A card that looks like a preview switch invites a click "just to look", which ends the comparison.
- *Replace with:*
  - the Pick buttons, enabled only at `awaiting_pick` (as now, `HudView.lua:163`), each with its intent label ("Pick B (dramatic)") and a consequence line: "Claude continues on this copy; the other copies stay in the catalog." (`end.ts:4-8`). The labels are on each copy's Target and in the session log (`engine/src/session/types.ts:148-149`; `copies.ts:54` `label: t.label ?? ""`; `variants.ts:109` reads `v.label`) but not in the HUD payload (intent source: `engine/intents/landscape_golden_hour.json:9-11`), so showing them needs a new field and a plugin change (`hud-protocol.ts:11`);
  - side-by-side judging stays native: select the copies and press **N** for Survey view (https://helpx.adobe.com/lightroom-classic/help/keyboard-shortcuts.html);
  - thumbnails, if you want them, could come from `LrView` `catalog_photo` (SDK 4.0, https://lrc.mcor.dev/modules/LrView.html). Whether they show a copy's fresh Develop state is [unverified]. S1's result makes freshness a real risk [inference]: no thumbnail at all within 30 s after a Develop change, in 5 of 5 steps (`S1.md:122`; `S1.md:116` retracts the earlier "stale" verdict).

**D3. "Stop" for Abort, and Esc bound to it** (Grok:175, :264)
- *Why it matters:* "Stop" reads as "stop Claude, keep what I have", but Abort reverts the photo (`hud-actions.ts:5-9`). In Lightroom, Esc switches to Grid view (https://helpx.adobe.com/lightroom-classic/help/keyboard-shortcuts.html). A habitual Esc in a focused HUD would throw the edit away.
- *Replace with:*
  - **Abort Edit**, matching the menu item "LrC-AVG - Abort Edit" (`Info.lua:33`), which you renamed from "Session" [stated: Jim, 2026-10-03, `check.txt:244`];
  - a consequence line in two forms, mirroring `abortedNote` (`hud-actions.ts:124-128`):
    - Converge: "Puts the photo back as it was before the edit.";
    - Variants: "Puts the master back; the copies keep their edits." (`end.ts:4-8`; "A-C" would be wrong with two copies, `Prefs.lua:36`);
  - kept last, as in the fix/hud-p1 copy deck (`HudView.lua:18-19`; `Info.lua:23-24`, "Abort last, as on the HUD"). Your running build puts Put back after it (shot);
  - no single-key binding.

**D4. Digit keys pick, Enter approves** (Grok:84, :264)
- *Why it matters:* in Lightroom, 1-5 set star ratings and Enter switches to Loupe (https://helpx.adobe.com/lightroom-classic/help/keyboard-shortcuts.html). A floating window takes the keyboard when it opens (`S8.md:122`), so a rating keystroke could make an irreversible pick.
- *Replace with* what already works, with its own hazard named: Tab put focus on the first enabled button ("Approve pass 2" in both runs), and Space or Enter clicked it (`docs/reports/phase6/hud-p1-check/check.txt:255-256`). So Enter clicks the focused button too. Which control has focus when the HUD opens is [unverified] (`check.txt:10`). Check which control has focus when the HUD opens, so that an Enter meant for Loupe cannot hit Approve or Abort. Every button also has a File > Plug-in Extras item (`Info.lua:25-34`). Add no global shortcuts.

**D5. A banner in autonomous mode: "Applying without review"** (Grok:138)
- *Why it matters:* autonomous is the default (§2 row 12). A permanent warning in the normal case breaks principle 2 ("while Claude is working, the HUD says so and asks nothing", `PRODUCT.md:37`) and trains the user to ignore banners.
- *Replace with* the existing headline "Claude is working. Nothing needed from you." (`HudText.lua:45`), plus the Abort Edit line from D3.

**D6. A colour-coded status dot as the main state signal** (Grok:65-69)
- *Why it matters:* "running" and "your turn" differ only by slow versus solid amber, and "bridge down" versus "kept" by red versus green. The text line names the phase, but the draft never requires every dot state to have words (`PRODUCT.md:45`: "meaning is never carried by colour alone"). "Kept" is not a gateway state either (D1).
- *Replace with:* the headline sentence is the signal. Its "Your turn: …" prefixes already exist (`HudText.lua:46-49`). A dot, if kept, only repeats what the words already say.

**D7. Default position at the top right** (Grok:50)
- *Why it matters:* on your screen the top right holds the Histogram (shot). In Develop the right column also holds the Basic panel, where Claude's slider moves show [inference: standard LrC layout; not on the shot, which is Library]. The left column holds History and Snapshots, the way back.
- *Replace with:* pass `save_frame` so the window comes back where you put it. The SDK supports it (`S8.md:70`); `Hud.lua:99-116` does not pass it today. Where the window opens the first time is for you to observe [unverified].

**D8. Normalised bars, and a diff mock that repeats itself** (Grok:103-132)
- The mock still prints before, after and change ("−0.35", "+0.10 → −0.25"), the repetition Grok faulted (Grok:101).
- *Why it matters:*
  - the bar scale (Exposure 0.50 EV, Temp 800 K, and so on) has no source [inference];
  - bars are decoration, against principle 5 ("brevity and order carry the hierarchy, not decoration", `PRODUCT.md:40`);
  - bars cannot show a Profile change, which is text ("Camera Neutral → Adobe Landscape" in pass 0 of real sessions, `docs/reports/phase5/P5/p5_sessions_2026-10-01T11-32-13-141Z/20261001-d4247b.json`).
- *Replace with:*
  - one line per slider: label, the value the Develop slider now shows, and the change in brackets ("Highlights  −41  (−20)");
  - text values as "from → to";
  - only the rows that changed. LrView `visible` still reserves layout space (lrc.mcor.dev "LrView view properties": "An item still affects layout, even when it is hidden"), so in LrView, fewer fixed rows is the lever [inference].

**D9. A settings sheet inside the HUD** (Grok:144-153)
- *Why it matters:* settings live on the Plug-in Manager page (AVG-006, `CLAUDE.md:18`) and nothing can write them over the bridge (§2 row 9). A read-only sheet is a second place showing the same values.
- *Replace with:*
  - one fixed `static_text` summary line, with no expandable part: the edit's settings when one is open, else "Settings: File > Plug-in Manager" (Ctrl+Alt+Shift+,, https://helpx.adobe.com/lightroom-classic/help/keyboard-shortcuts.html). A collapsible line has no native mechanism here: `visible` still reserves layout space (D8), and `LrView.conditionalItem` decides only once, "when the view description is generated" (https://lrc.mcor.dev/modules/LrView.html). A show/hide toggle in LrView is [unverified];
  - Grok's idea of describing decay as a sentence ("later passes move less") fits there.

**D10. Retiring the idle hint after first use** (Grok:71)
- *Why it matters:* PRODUCT.md designs for the next user, who "did not build LrC-AVG" (`PRODUCT.md:11`). The idle line is the only place that says where to start. Hiding it after first use also needs persisted per-user state.
- *Replace with:* keep "No edit running. In Claude Desktop, ask Claude to edit a photo." (`HudText.lua:40`).

**D11. Raising the window when a decision is due, on by default** (Grok:54)
- *Why it matters:* it is an anti-reference ("Interrupting: … stolen focus", `PRODUCT.md:31`). On Tauri a re-show activates the window (§2 row 25). In autonomous mode the only moments are a Variants pick, `converged`, `target_changed` (`HudView.lua:61-72`) and the pass cap, a note on `awaiting_claude` (`hud-actions.ts:290`; §4.5).
- *Replace with:* no raise; the headline changes in place. A `showBezel` nudge (SDK 5.0, https://lrc.mcor.dev/modules/LrDialogs.html) is optional, and where it appears is [unverified].

**D12. Labels "Done", "Review", "baseline", "session", "Optics"** (Grok:58, :172-173, :119)
- *Why it matters:* principle 1 asks for Lightroom's words (`PRODUCT.md:36`).
  - "Done" already prefixes the end headlines ("Done: the edit is kept.", `HudText.lua:50`) and is Plug-in Manager's close button (`S8.md:189`).
  - The HUD's notes say "edit", not "session" (`hud-actions.ts:18-19`). The HUD face does not hold to this yet: the settings block says "Session settings:" and "Settings page (the next session reads them):" (`HudView.lua:152`; shot), and the pass0 Step label says "Setting profile, lens corrections and baseline" (`HudText.lua:58`).
  - "Optics" is not LrC's label (§2 row 20).
- *Replace with:* Accept Edit / Abort Edit / Pick A-C / Approve pass n. Add the two current strings above to the copy to fix (`HudView.lua:152`; `HudText.lua:58`). Where the snapshot must be named, quote it only as the Lightroom item "AVG pre-session …" (`begin.ts:49`). Keep the window title stable, or change it only together with the menu item "Show Vision Gateway HUD" (`Info.lua:27`).

**D13. A dark custom surface and title bar** (Grok:58, :185-205, :282)
- *Why it matters:*
  - "Non-native look" is an anti-reference (`PRODUCT.md:32`);
  - Lightroom's own title and menu bars are white (§2 row 23);
  - a #1C1C1C slab sits 1.83:1 against your #474747 panels and 11.38:1 against the #d3d3d3 loupe surround (`contrast.cjs`, this session). Whether that reads as a hole is a judgement for your eye [inference].
- *Replace with:* native LrView chrome. For an external window, use tokens sampled from your Lightroom (§2 row 23) instead of a darker palette.

---

## 4. Omissions

1. **Guardrail line.**
   - Status values are green, clamped, refused, corrected, unmet and undone, each with one sentence.
   - Example from a real session: "Shadow clipping was 3.47 % (limit 1 %); corrected." (copy B, pass 0).
   - Green with no reason shows "Clipping: within limits."
   - Handles: `payload.ts:119-170`; `hud-protocol.ts:103`; `20261001-d4247b.json` (clip_low 3.4743 %).
2. **The undo path by name.**
   - The HUD names the snapshot, "AVG pre-session <ISO time>", in "To undo it: Develop > Snapshots > …".
   - This line matters most when Claude is gone and the buttons are off.
   - Handles: `begin.ts:49`; `HudText.lua:72-73`; `HudView.lua:76-81`; principle 4.
3. **Click-pending feedback.**
   - After a click: "<Label> sent; waiting for Claude.", with the buttons off until the answer, a new session or an end stage arrives, or 10 s pass.
   - On failure: "not sent: <reason>".
   - Handles: `hud-protocol.ts:24-25`; `HudText.lua:79-96`.
4. **The unknown/gone state after a reconnect.**
   - The HUD shows "Checking this edit with Claude...", then after 10 s "This edit is no longer open in Claude. Your edit so far stays." with the undo line.
   - Handles: `Hud.lua:157-163`; `HudText.lua:43-44`; checked in LrC 15.6 (`check.txt:259`).
5. **Stages the draft ignores.**
   - Grok's four phases cover 13 stages (`hud-protocol.ts:40-46`).
   - Missing: `converged` ("Your turn: Claude thinks the edit is done.") and the three end states.
   - `target_changed`: Grok does design a selection-mismatch banner (Grok:159; §1.6), but not the headline "Your turn: select the edit's photo again." (`HudText.lua:49`).
   - The pass cap is not a stage. It is `awaiting_claude` with the note "All N passes are used. Accept keeps the edit; Abort puts the photo back." (`hud-actions.ts:288-290`), while the headline still reads "Claude is working. Nothing needed from you." (`HudView.lua:71`; `HudText.lua:45`). The cap is a real "your turn" moment that the current HUD under-signals.
   - The window stays open at the end [stated: Jim, 2026-10-03, D2] (`Hud.lua:14-16`).
6. **Partial Abort.**
   - "Abort left n settings different from before. Click Abort again." The edit stays open (`hud-actions.ts:159-167`).
7. **Variants leftovers.**
   - After Accept, the copies that were not picked stay in the catalog. After Abort, only the master goes back and the copies keep their edits. The SDK cannot remove a photo.
   - Handles: `end.ts:4-8`; `pick.ts:91-92`; `hud-actions.ts:125`.
   - A photographer needs to see this on the HUD.
8. **Approve's time limit.**
   - `lr_step` waits up to 60 s for Approve, then returns AWAITING_APPROVAL and Claude asks in chat (`approval.ts:7-9`, `:34`).
   - The pick also approves its own pass (`approval.ts:13-14`).
9. **Claude's own end, distinguished from yours.**
   - When Claude accepts, the stage is `accepted` with the note "Claude accepted: the edit is kept." (`manager.ts:171`).
   - When Claude reverts, the stage is `ended` with the note "Claude reverted: the photo is back as it was before the edit." (`:172`).
   - A revert while the user's Abort is pending ends as `aborted`, with the Abort note (`:168-170`).
   - Handles: `engine/src/session/manager.ts:168-172`.
10. **The copy name for a Variants edit.**
    - The HUD shows `target.copy_name`, for example "AVG landscape_golden_hour C" (`payload.ts:68`; `copies.ts:51`).
11. **Menu-item path.**
    - Every HUD button has a File > Plug-in Extras item (`Info.lua:25-34`).
    - Menu items wait up to 20 s for the engine (`HudClick.lua:98`), because the plugin went silent while a menu was open (34 s during a menu use; 11.5 s and 14.5 s with Plug-in Manager open; `bridge-gate.ts:30-32`). That Lightroom pauses plugin tasks then is [inference] (`HudClick.lua:91-94`; `bridge-gate.ts:30-32`).
12. **Who feeds an external HUD.** The draft names no source:
    - the plugin only listens and serves one client (§2 row 15);
    - the engine is a stdio MCP server (`engine/src/mcp/main.ts:87`) with no network server; its only TCP listener is the instance lock on the bridge's event port + 1, by default 8767 (`engine/src/mcp/instance-lock.ts:25-32`, `:61-83`; ports settable, `Prefs.lua:44-45`);
    - outside a session the engine gives the bridge back 60 s after its last tool call (`main.ts:46`, `:67` keepWhile; `bridge-gate.ts:71-93`).

    So an external window needs either a new server in the engine or a new LrSocket pair in the plugin [inference]. Either is new protocol work.

---

## 5. Unverified or risky claims

- **Memory and size figures:** "Idle resident memory … under about 80MB", "warm show … under 400ms" and "the 15MB budget" (Grok:213) are [unverified]. No Microsoft or Tauri figure was found, and WebView2 adds browser, renderer and helper processes (research/md_process-model.md:22-25; research/md_performance.md:15). These need a measurement on your machine.
- **WebView2 presence.**
  - Windows 11: preinstalled (research/md_evergreen.md:68).
  - Windows 10: "the vast majority" have it, "a small number … don't" (research/md_distribution.md:91). Tauri's "from 1803 onward" (research/raw_prerequisites.mdx:208) is too strong.
  - An installer must check for it or bundle the Evergreen bootstrapper.
- **Tauri toolchain.** Building needs the MSVC Build Tools plus Rust (research/raw_prerequisites.mdx:192-199, :242-272).
  - Focus: the JS API has no inactive show (only `show()`, research/tauriapi/package/window.d.ts:914) and no HWND (`grep -ci hwnd` over window.d.ts and webviewWindow.d.ts: 0). It does have `focusable: false` / `setFocusable(false)`, which sets WS_EX_NOACTIVATE (window.d.ts:2094, :1265; research/tao_tag_ws.rs:293-294), so a non-activating window can be set up from JS. Whether a later `show()` then stays inactive is [unverified], and such a window does not become the foreground window when clicked (research/md_extended-window-styles.md:31), against keyboard operation (`PRODUCT.md:44`) [inference].
  - Pin to Lightroom needs Rust: `owner_raw(HWND)` (research/tag_webview_window.rs:716-721) and `hwnd()` (:1966) exist only on the Rust side (§2 row 24).
- **"Pinned above Lightroom only".**
  - A cross-process owner is "technically legal … also technically legal to juggle chainsaws" (https://devblogs.microsoft.com/oldnewthing/20130412-00/?p=4683). It attaches input queues, so a hung HUD could stall Lightroom's input [inference from research/md_nf-winuser-attachthreadinput.md:94].
  - The alternative, a WinEvent hook that toggles topmost, is not a documented pattern [inference]. The pieces exist: an out-of-context hook filtered to one process, which needs a message loop (research/md_nf-winuser-setwineventhook.md:129, :180, :184), and EVENT_SYSTEM_FOREGROUND (research/md_event-constants.md:148). Neither page mentions topmost (`grep -ci topmost` on both: 0).
- **Floating-dialog z-order on Windows varies by LrC version** [community]:
  - Full Screen: reported fixed in 15.2 (johnrellis, 2026-02-22), then reported back in 15.3 (drtonyb, 2026-04-26), corrected the next day to "fixed in LrC 15.1, but back in LrC 15.2"; johnrellis retested 15.1-15.3 on Windows 11 (2026-04-26). All in the first thread below;
  - from 15.2, forced topmost even over other apps;
  - will not come to the front in Develop, Book or Print.
  - The repo has one z-order observation of its own: a message box opened behind the HUD (`HudClick.lua:96-97` [stated: Jim, 2026-09-29]).
  - Threads: https://community.adobe.com/bug-reports-674/p-sdk-floating-dialogs-always-in-back-never-in-front-in-screen-mode-full-screen-on-windows-664457 ; https://community.adobe.com/questions-675/lrdialogs-presentfloatingdialog-forced-topmost-on-windows-starting-in-15-2-regression-vs-15-1-1-macos-unaffected-1559160 ; https://community.adobe.com/questions-675/floating-dialog-will-not-come-to-the-front-when-develop-book-or-print-modules-are-active-1617359
  - Your 15.5.1 and 15.6 behaviour is [unverified]. This is a risk for the native path, and the strongest real argument for an external window.
- **"Launched by the plugin … Lightroom quitting quits the HUD"** (Grok:42).
  - The plugin has no process-launch call today (`grep "LrTasks.execute\|LrShell" plugin/LrC-AVG.lrplugin`: 0 hits).
  - The mechanism for the launch and for quitting with Lightroom is [unverified].
- **Hold-to-compare** (Grok:179). No event supports it (`hud-protocol.ts:48`). Applying settings back and forth would add History steps [inference]. Lightroom's own "\" (View Before only, https://helpx.adobe.com/lightroom-classic/help/keyboard-shortcuts.html) already covers it, but only when the main window has the keyboard (`S8.md:122`).
- **Thumbnails.**
  - The engine holds each copy's last render in memory (`engine/src/session/types.ts:131-134`, `:158`), but no file or channel carries it to a HUD [inference].
  - LrView `picture` taking an arbitrary absolute path is [unverified]: the SDK page documents its `value` as "Name of the file or resource in the plug-in" (https://lrc.mcor.dev/modules/LrView.html, `viewFactory:picture`).
- **Other draft numbers with no handle:** the bar normalisation table (Grok:123-130), the "4 Hz" cap (Grok:160), and the 360×52 / 380×420 window sizes (Grok:46-47) are [inference].
- **A native wrap the repo has not tried.** The SDK page says a `static_text` with `height_in_lines = -1` and a width wraps its text (https://lrc.mcor.dev/modules/LrView%20text%20properties.html). The HUD's slot wrapping assumes the opposite (`HudText.lua:5-7`). In LrC this is [unverified]; one check would settle it.

---

## 6. Conflicts with PRODUCT.md and the repo's rules

- **PRODUCT.md principle 5 and the accessibility line** ("Native LrView controls and Lightroom's text sizes", `PRODUCT.md:40`, `:45`).
  - A Tauri window with bundled Inter or Geist and a custom title bar contradicts both.
  - Leaving LrView is a change to PRODUCT.md that only you can make. The draft treats it as settled ("Treat the Lua dialog as a prototype to retire", Grok:22).
- **Anti-references** (`PRODUCT.md:29-32`):
  - "Interrupting / stolen focus" against D11;
  - "Non-native look" against D13;
  - "Debug console: engine jargon" against "baseline", "preview" and "session" (D12). The current HUD has two of these too: "session" in the settings block (`HudView.lua:152`) and "baseline" in the pass0 Step label (`HudText.lua:58`).
- **Principle 1** ("Name things as Develop names them", `PRODUCT.md:36`) against "Optics", which is not Lightroom Classic's word for the panel (§2 row 20).
- **Principles 2 and 4:** the always-on autonomous banner (D5); no snapshot name and no undo line (§4.2).
- **Stack rule** (`CLAUDE.md:25`; `.claude/rules/01-stack.md:5-9`).
  - The languages are Lua for the plugin and TypeScript on Node ≥ 22 for the engine and every tool script.
  - Tauri adds Rust source, Cargo and the MSVC toolchain. It is not banned outright, but it is outside the stated stack and needs your amendment.
  - A Node-only alternative exists:
    - Electron 44.5.1 has `showInactive()`, `focusable` and `getNativeWindowHandle()` (research/electron-44.5.1.tgz electron.d.ts:3646, :3898-3905, :2853-2859);
    - Win32 calls would go through koffi, which ships a prebuilt win32-x64 binary (research/koffi-3.3.2.tgz `package/package.json:35`, `:47` optionalDependencies `"@koromix/koffi-win32-x64": "3.3.2"`; `npm view @koromix/koffi-win32-x64@3.3.2 os cpu` → `os = 'win32'`, `cpu = 'x64'`);
    - its footprint is [unverified].
- **Sourcing rule** (`CLAUDE.md:26`; `.claude/rules/02-sourcing.md`).
  - These draft claims carry no handle: the memory, size and latency figures, the requestJpegThumbnail behaviour, the LrView limits, the panel order and the bar constants.
  - Under rule 02 each stays [unverified] or [inference] until a handle exists. None of them may become a requirement as written.
- **Lightroom-side results are yours** (`CLAUDE.md:31`).
  - These "Done when" items are Lightroom observations, not things Claude Code can declare (Grok:276-283):
    - focus;
    - z-order over Lightroom and Claude Desktop;
    - "does not cover the photograph";
    - keys reaching Lightroom;
    - behaviour in Develop.
  - Write them as a check script with y/n questions for you, as hud-p1 did (`check.txt:1-10`).
- **Windows-only** (`CLAUDE.md:3`): drop every macOS item.

**Needs your answer before any redesign:**
1. What does your build's Put back do, and is it on a branch? It is absent from main's plugin (`git grep -il "put back" 75369b7 -- plugin/LrC-AVG.lrplugin`: 0 files; the only plugin hits are status lines in spikes S4 and S5). It is also absent from the 22 PR heads in 42-71 that exist (54-56, 58-60 and 67-68 are not PRs). Handle: `git ls-remote https://github.com/jimjohnbeebe-jpg/lrc_autonomous_gateway 'refs/pull/*/head'` (saved as `scratchpad/prs.txt`; re-run this session, identical), then `scratchpad/hud/spec-checks/putback-scan.sh` over `pr-heads.txt` (identical to `prs.txt`), which fetches HudView, HudText, Hud, HudState and Info.lua at each head from raw.githubusercontent.com and counts "put back" case-insensitively: 0 in every file present (`spec-checks/putback-scan.out`; PR 71 at 6d7af8f re-checked this session: 0).
2. Native LrView redesign versus external window? This decides whether PRODUCT.md principle 5 and the stack rule change.
3. If external: Tauri with Rust, or Electron with koffi, kept on Node?
