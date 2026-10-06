// The Deck (Phase 7 row 4b; spec docs\hud\lrc-avg-hud-spec-v2.md 2.7): the Tauri shell. Rust owns the
// window only (spec D2, "Contract reuse"): the window rules (window.rs), placement (place.rs, store.rs,
// monitors.rs) and finding Lightroom (lightroom.rs). The channel client and what the Deck shows live in
// the TypeScript UI (hud\ui\). Carried over from spike S9: Tauri 2.12 with WebView2 without its GPU
// process, show without activation, WebView2 IsVisible (spec 2.7 "From S9").
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod lightroom;
mod log;
mod monitors;
mod place;
mod store;
mod webview;
mod window;

use serde_json::{json, Value};
use tauri::{Manager, WindowEvent};
use windows::core::w;
use windows::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS};
use windows::Win32::System::Threading::CreateMutexW;

/// The engine's endpoint file (spec 3.3), for the UI, which validates it with the engine's own zod
/// schema; `pid_alive` lets it treat a stale file as "not connected".
#[tauri::command]
fn endpoint() -> Option<Value> {
    let home = std::env::var("USERPROFILE").ok()?;
    let text = std::fs::read_to_string(std::path::Path::new(&home).join(".lrc-avg").join("hud_endpoint.json")).ok()?;
    let pid = serde_json::from_str::<Value>(&text).ok()?.get("pid")?.as_u64()? as u32;
    Some(json!({ "text": text, "pid_alive": lightroom::pid_alive(pid), "hud_pid": std::process::id(), "hud_version": env!("CARGO_PKG_VERSION") }))
}

// Sync commands run on the main thread, which owns the window and the WinEvent hook [handle:
// https://raw.githubusercontent.com/tauri-apps/tauri-docs/v2/src/content/docs/develop/calling-rust.mdx:341].
#[tauri::command]
fn deck_show(reason: String, open: bool) {
    window::show(&reason, open);
}

#[tauri::command]
fn deck_hide(reason: String) {
    window::hide(&reason);
}

#[tauri::command]
fn deck_set_open(open: bool) {
    window::set_open(open);
}

#[tauri::command]
fn deck_focus_lightroom(why: String) {
    window::focus_lightroom(&why);
}

#[tauri::command]
fn deck_log(line: Value) {
    log::write(json!({ "ev": "ui", "line": line }));
}

/// One Deck per user session (spec 3.2 "A second HUD launch": exits at once). A named mutex from the
/// `windows` crate already in use, in place of the tauri-plugin-single-instance crate.
fn first_instance() -> bool {
    unsafe {
        let made = CreateMutexW(None, false, w!(r"Local\LrC-AVG-HUD"));
        // The handle is kept for the life of the process; Windows closes it at exit.
        made.is_ok() && GetLastError() != ERROR_ALREADY_EXISTS
    }
}

fn main() {
    if !first_instance() {
        log::write(json!({ "ev": "second_instance_exit" }));
        return;
    }
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![endpoint, deck_show, deck_hide, deck_set_open, deck_focus_lightroom, deck_log])
        .setup(|app| {
            let window = app.get_webview_window("main").expect("window main");
            log::write(json!({ "ev": "start", "pid": std::process::id(), "version": env!("CARGO_PKG_VERSION") }));
            webview::init(window.clone());
            window::init(window, app.handle().clone())?;
            Ok(())
        })
        .on_window_event(|_, event| match event {
            WindowEvent::Moved(_) | WindowEvent::Resized(_) => window::moved(false),
            WindowEvent::ScaleFactorChanged { .. } => window::moved(true),
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("tauri run");
}
