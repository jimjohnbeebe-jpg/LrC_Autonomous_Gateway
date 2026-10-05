// Spike S9 (Phase 7 row 1): the Tauri HUD shell. Rust owns only the window (spec D2, "Contract reuse"):
// show and hide through Win32 (win.rs), topmost while Lightroom or the HUD is in front, follow
// Lightroom's window, exit after Lightroom exits. The channel client lives in the TypeScript UI (ui\ui.ts).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod log;
mod webview;
mod win;

use serde_json::{json, Value};
use tauri::Manager;

/// The engine's endpoint file (spec 3.3), read for the UI, which validates it with zod. `pid_alive`
/// lets the UI treat a stale file as "not connected" (spec 3.3: "It checks that `pid` is alive").
#[tauri::command]
fn endpoint() -> Option<Value> {
    let home = std::env::var("USERPROFILE").ok()?;
    let text = std::fs::read_to_string(format!("{home}\\.lrc-avg\\hud_endpoint.json")).ok()?;
    let pid = serde_json::from_str::<Value>(&text).ok()?.get("pid")?.as_u64()? as u32;
    Some(json!({ "text": text, "pid_alive": win::pid_alive(pid), "hud_pid": std::process::id() }))
}

// Sync commands run on the main thread, which owns the window and the WinEvent hooks.
#[tauri::command]
fn hud_show(reason: String) {
    win::show(&reason);
}

#[tauri::command]
fn hud_hide(reason: String) {
    win::hide(&reason);
}

#[tauri::command]
fn hud_log(line: Value) {
    log::write(json!({ "ev": "ui", "line": line }));
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![endpoint, hud_show, hud_hide, hud_log])
        .setup(|app| {
            let window = app.get_webview_window("main").expect("window main");
            let hwnd = window.hwnd()?;
            log::write(json!({ "ev": "start", "pid": std::process::id(), "hwnd": hwnd.0 as isize }));
            webview::init(window);
            win::init(hwnd.0 as isize, app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("tauri run");
}
