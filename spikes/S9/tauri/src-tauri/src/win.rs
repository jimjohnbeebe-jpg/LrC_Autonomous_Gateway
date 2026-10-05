// Win32 window behaviour of the S9 HUD (spec D2 verdict, 4.1-4.3; gates S9-6 to S9-10). Every show and
// hide is a ShowWindow call from here, never Tauri's show()/hide(): tao's show() uses SW_SHOW, which
// activates [handle: spec D2, tao-v0.37.1 window_state.rs:459-465]; SW_SHOWNA shows "without
// activation" [handle: MS nf-winuser-showwindow.md:90-94]. Whether this holds in Lightroom's company is
// what S9 measures: every behaviour here is [inference] until then.
use crate::log::{now_ms, write};
use serde_json::json;
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU32, Ordering::SeqCst};
use tauri::AppHandle;
use windows::core::{BOOL, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, POINT, RECT};
use windows::Win32::Graphics::Gdi::ClientToScreen;
use windows::Win32::System::Threading::{
    GetExitCodeProcess, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::WindowsAndMessaging::*;

static HUD: AtomicIsize = AtomicIsize::new(0);
static LR: AtomicIsize = AtomicIsize::new(0);
static LR_PID: AtomicU32 = AtomicU32::new(0);
/// The UI asked for the HUD to be shown; a minimise hides it without clearing this.
static WANT: AtomicBool = AtomicBool::new(false);
static MIN_HIDDEN: AtomicBool = AtomicBool::new(false);
static LR_HOOKED: AtomicBool = AtomicBool::new(false);

/// The collapsed Deck is 44 px over the filmstrip band, which is 144 px on the mockup stage
/// (option-c/NOTES.md section 1) [stage]; Lightroom's real band height is [unverified] (spec 13.2, 26).
const DECK_H: f64 = 44.0;
const BAND_H: f64 = 144.0;
const STILL_ACTIVE: u32 = 259;

fn hwnd(v: isize) -> HWND {
    HWND(v as *mut core::ffi::c_void)
}

pub fn init(hud: isize, app: AppHandle) {
    HUD.store(hud, SeqCst);
    // WINEVENT_OUTOFCONTEXT callbacks arrive on this (the main) thread's message loop
    // [handle: MS nf-winuser-setwineventhook.md:184].
    unsafe {
        SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, None, Some(on_foreground), 0, 0, WINEVENT_OUTOFCONTEXT);
    }
    if find_lightroom() {
        hook_lightroom();
    }
    std::thread::spawn(move || watch(app));
}

/// Every 250 ms: find Lightroom if not yet found, follow a change of its main window, and exit once
/// its process has exited (S9-10). Spec 3.2 says "main window is gone"; the process is the stricter test.
fn watch(app: AppHandle) {
    loop {
        std::thread::sleep(std::time::Duration::from_millis(250));
        let pid = LR_PID.load(SeqCst);
        if pid != 0 && !pid_alive(pid) {
            write(json!({ "ev": "lightroom_exited", "pid": pid }));
            app.exit(0);
            return;
        }
        let before = LR.load(SeqCst);
        if find_lightroom() && LR.load(SeqCst) != before {
            let _ = app.run_on_main_thread(|| {
                hook_lightroom();
                place();
            });
        }
    }
}

pub fn pid_alive(pid: u32) -> bool {
    unsafe {
        let Ok(h) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else { return false };
        let mut code = 0u32;
        let ok = GetExitCodeProcess(h, &mut code).is_ok();
        let _ = CloseHandle(h);
        ok && code == STILL_ACTIVE
    }
}

fn exe_name(pid: u32) -> String {
    unsafe {
        let Ok(h) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else { return String::new() };
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
        let _ = CloseHandle(h);
        if ok { String::from_utf16_lossy(&buf[..len as usize]) } else { String::new() }
    }
}

fn window_pid(h: HWND) -> u32 {
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(h, Some(&mut pid)) };
    pid
}

/// "\lightroom.exe"; the dev override LRC_AVG_S9_LR_EXE (e.g. notepad.exe) lets Claude Code dry-run
/// the harness without Lightroom.
fn target_exe() -> String {
    let exe = std::env::var("LRC_AVG_S9_LR_EXE").unwrap_or_else(|_| "lightroom.exe".into());
    format!("\\{}", exe.to_lowercase())
}

struct Best {
    pid: u32,
    hwnd: isize,
    area: i64,
}

unsafe extern "system" fn enum_cb(h: HWND, lp: LPARAM) -> BOOL {
    let best = &mut *(lp.0 as *mut Best);
    if !IsWindowVisible(h).as_bool() {
        return true.into();
    }
    let pid = window_pid(h);
    let wanted = if best.pid != 0 { pid == best.pid } else { exe_name(pid).to_lowercase().ends_with(&target_exe()) };
    let mut r = RECT::default();
    if wanted && GetWindowRect(h, &mut r).is_ok() {
        let area = (r.right - r.left) as i64 * (r.bottom - r.top) as i64;
        if area > best.area {
            *best = Best { pid, hwnd: h.0 as isize, area };
        }
    }
    true.into()
}

/// Lightroom's main window: the largest visible top-level window of the process whose image is
/// Lightroom.exe (spec 4.1; the image name is [unverified], spec 13.2 item 11; S9 records it).
fn find_lightroom() -> bool {
    let mut best = Best { pid: LR_PID.load(SeqCst), hwnd: 0, area: 0 };
    unsafe {
        let _ = EnumWindows(Some(enum_cb), LPARAM(&mut best as *mut Best as isize));
    }
    if best.hwnd == 0 {
        return false;
    }
    if LR_PID.swap(best.pid, SeqCst) == 0 {
        write(json!({ "ev": "lightroom_found", "pid": best.pid, "exe": exe_name(best.pid), "hwnd": best.hwnd }));
    }
    LR.store(best.hwnd, SeqCst);
    true
}

/// Main thread only (hooks need its message loop).
fn hook_lightroom() {
    let pid = LR_PID.load(SeqCst);
    if pid == 0 || LR_HOOKED.swap(true, SeqCst) {
        return;
    }
    unsafe {
        SetWinEventHook(EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_LOCATIONCHANGE, None, Some(on_location), pid, 0, WINEVENT_OUTOFCONTEXT);
        SetWinEventHook(EVENT_SYSTEM_MINIMIZESTART, EVENT_SYSTEM_MINIMIZEEND, None, Some(on_location), pid, 0, WINEVENT_OUTOFCONTEXT);
    }
}

unsafe extern "system" fn on_location(_: HWINEVENTHOOK, event: u32, h: HWND, id_object: i32, _: i32, _: u32, _: u32) {
    if h.0 as isize != LR.load(SeqCst) || id_object != OBJID_WINDOW.0 {
        return;
    }
    let t_event = now_ms();
    place();
    write(json!({ "ev": "follow", "event": event, "t_event": t_event, "t_set": now_ms() }));
}

unsafe extern "system" fn on_foreground(_: HWINEVENTHOOK, _: u32, h: HWND, _: i32, _: i32, _: u32, _: u32) {
    let t_event = now_ms();
    let front = topmost_for(h);
    write(json!({ "ev": "foreground", "front": front, "fg_pid": window_pid(h), "t_event": t_event, "t_set": now_ms() }));
}

/// Topmost only while Lightroom or the HUD is in front (spec 4.3). Otherwise not topmost, and placed
/// just below the foreground window: HWND_NOTOPMOST alone would put it "above all non-topmost
/// windows" [handle: MS nf-winuser-setwindowpos.md:103-131], i.e. over Claude Desktop.
fn topmost_for(fg: HWND) -> bool {
    let hud = hwnd(HUD.load(SeqCst));
    let pid = window_pid(fg);
    let front = pid != 0 && (pid == LR_PID.load(SeqCst) || pid == std::process::id());
    let flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE;
    unsafe {
        if front {
            let _ = SetWindowPos(hud, Some(HWND_TOPMOST), 0, 0, 0, 0, flags);
        } else {
            let _ = SetWindowPos(hud, Some(HWND_NOTOPMOST), 0, 0, 0, 0, flags);
            let fg_topmost = GetWindowLongPtrW(fg, GWL_EXSTYLE) & WS_EX_TOPMOST.0 as isize != 0;
            if !fg.is_invalid() && !fg_topmost {
                let _ = SetWindowPos(hud, Some(fg), 0, 0, 0, 0, flags);
            }
        }
    }
    front
}

/// The Deck's rectangle in physical pixels: full client width, its top edge at the filmstrip band.
fn deck_rect(lr: HWND) -> (i32, i32, i32, i32) {
    let mut rc = RECT::default();
    let mut origin = POINT::default();
    unsafe {
        let _ = GetClientRect(lr, &mut rc);
        let _ = ClientToScreen(lr, &mut origin);
        let scale = GetDpiForWindow(lr) as f64 / 96.0;
        let band = (BAND_H * scale).round() as i32;
        (origin.x, origin.y + rc.bottom - band, rc.right, (DECK_H * scale).round() as i32)
    }
}

fn iconic(lr: isize) -> bool {
    lr != 0 && unsafe { IsIconic(hwnd(lr)).as_bool() }
}

/// Follows Lightroom (S9-8): over its filmstrip band, hidden while it is minimised.
fn place() {
    let (hud, lr) = (hwnd(HUD.load(SeqCst)), LR.load(SeqCst));
    if lr == 0 {
        return;
    }
    unsafe {
        if iconic(lr) {
            if IsWindowVisible(hud).as_bool() {
                let _ = ShowWindow(hud, SW_HIDE);
                crate::webview::set_active(false);
                MIN_HIDDEN.store(true, SeqCst);
                write(json!({ "ev": "hide", "reason": "lightroom_minimised" }));
            }
            return;
        }
        let (x, y, w, h) = deck_rect(hwnd(lr));
        let _ = SetWindowPos(hud, None, x, y, w, h, SWP_NOZORDER | SWP_NOACTIVATE);
        // Logged so S9-8 can be read against what the HUD aimed for, including a move across monitors.
        let mut r = RECT::default();
        let _ = GetWindowRect(hud, &mut r);
        write(json!({ "ev": "place", "dpi": GetDpiForWindow(hwnd(lr)), "target": [x, y, w, h], "got": [r.left, r.top, r.right - r.left, r.bottom - r.top] }));
        if MIN_HIDDEN.swap(false, SeqCst) && WANT.load(SeqCst) {
            let _ = ShowWindow(hud, SW_SHOWNA);
            crate::webview::set_active(true);
            topmost_for(GetForegroundWindow());
            write(json!({ "ev": "show", "reason": "lightroom_restored" }));
        }
    }
}

pub fn show(reason: &str) {
    let hud = hwnd(HUD.load(SeqCst));
    WANT.store(true, SeqCst);
    MIN_HIDDEN.store(false, SeqCst);
    place();
    unsafe {
        let fg = GetForegroundWindow();
        if iconic(LR.load(SeqCst)) {
            MIN_HIDDEN.store(true, SeqCst);
        } else {
            let _ = ShowWindow(hud, SW_SHOWNA);
            crate::webview::set_active(true);
        }
        topmost_for(fg);
        write(json!({ "ev": "show", "reason": reason, "fg_pid": window_pid(fg) }));
    }
}

pub fn hide(reason: &str) {
    WANT.store(false, SeqCst);
    MIN_HIDDEN.store(false, SeqCst);
    unsafe {
        let _ = ShowWindow(hwnd(HUD.load(SeqCst)), SW_HIDE);
    }
    crate::webview::set_active(false);
    write(json!({ "ev": "hide", "reason": reason }));
}
