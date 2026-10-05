// Tells WebView2 itself when the HUD is hidden or shown. A Win32 SW_HIDE alone leaves WebView2
// rendering: Claude Code's probe measured the pulsing ring at about 9 % of a core while hidden
// (docs\reports\phase7\S9.md, "Pre-run findings"). WebView2's controller has IsVisible for this
// [handle: MS overview-features-apis.md:3081], and Microsoft advises MemoryUsageTargetLevel Low on
// inactive WebViews, Normal when active again [handle: MS performance.md:242]. Neither is Tauri's
// show()/hide(), so the D2 rule (every show and hide through Win32) still holds.
use crate::log::write;
use serde_json::json;
use std::sync::OnceLock;
use tauri::WebviewWindow;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
};
use windows::core::Interface;

static WINDOW: OnceLock<WebviewWindow> = OnceLock::new();

pub fn init(window: WebviewWindow) {
    let _ = WINDOW.set(window);
}

pub fn set_active(active: bool) {
    let Some(window) = WINDOW.get() else { return };
    let _ = window.with_webview(move |wv| unsafe {
        let controller = wv.controller();
        let visible = controller.SetIsVisible(active).is_ok();
        let level = if active { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL } else { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW };
        let memory = controller
            .CoreWebView2()
            .and_then(|core| core.cast::<ICoreWebView2_19>())
            .and_then(|core| core.SetMemoryUsageTargetLevel(level))
            .is_ok();
        write(json!({ "ev": "webview", "active": active, "is_visible_set": visible, "memory_level_set": memory }));
    });
}
