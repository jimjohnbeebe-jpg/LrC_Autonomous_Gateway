// The Deck's window rules (Phase 7 row 4b; spec docs\hud\lrc-avg-hud-spec-v2.md 2.7). Everything here runs
// on the main thread: the commands are sync (main.rs), the WinEvent callback arrives on this thread's
// message loop [handle: MS nf-winuser-setwineventhook.md:184], and the 250 ms tick is posted to it.
//   1. Topmost only while Lightroom's main window or the Deck is in front; otherwise just below the
//      foreground window (S9's topmost_for, spike S9 gate S9-7 passed [handle: docs\reports\phase7\S9.md "Numbers"]).
//   2. Placed at each edit's start from window.json, or bottom centre of Lightroom's monitor (place.rs).
//   3. Hidden while Lightroom's main window is minimised; shown again on restore if it was showing.
//   4. Resizable sideways only: the height is pinned by min = max size constraints; position and width
//      are saved after each move or resize (store.rs).
// Every show is ShowWindow(SW_SHOWNA), never Tauri's show(), which activates [handle: spec D2,
// tao-v0.37.1 window_state.rs:459-465; MS nf-winuser-showwindow.md:90-94], plus WebView2 IsVisible (webview.rs).
use crate::lightroom::{self, hwnd, iconic, window_pid};
use crate::log::write;
use crate::place::{self, Rect, Saved};
use crate::{monitors, store, webview};
use serde_json::json;
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU32, Ordering::SeqCst};
use std::sync::OnceLock;
use tauri::{AppHandle, PhysicalSize, WebviewWindow};
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
use windows::Win32::UI::WindowsAndMessaging::*;

static DECK: AtomicIsize = AtomicIsize::new(0);
static WINDOW: OnceLock<WebviewWindow> = OnceLock::new();
static LR_PID: AtomicU32 = AtomicU32::new(0);
static MAIN: AtomicIsize = AtomicIsize::new(0);
/// A Lightroom window filling its monitor, e.g. F's full-screen preview (lightroom::cover); 0: none.
static COVER: AtomicIsize = AtomicIsize::new(0);
/// The UI wants the Deck shown; a minimised Lightroom hides it without clearing this.
static WANT: AtomicBool = AtomicBool::new(false);
static MIN_HIDDEN: AtomicBool = AtomicBool::new(false);
/// The deck is opened (144 px) rather than the bar (44 px).
static OPEN: AtomicBool = AtomicBool::new(false);
/// Placed once: moves before that are Tauri's start-up, not the user's.
static PLACED: AtomicBool = AtomicBool::new(false);
static DIRTY: AtomicBool = AtomicBool::new(false);
static REFIT: AtomicBool = AtomicBool::new(false);
const TICK_MS: u64 = 250;

fn deck() -> HWND {
    hwnd(DECK.load(SeqCst))
}

pub fn init(window: WebviewWindow, app: AppHandle) -> tauri::Result<()> {
    DECK.store(window.hwnd()?.0 as isize, SeqCst);
    let _ = WINDOW.set(window);
    unsafe {
        SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, None, Some(on_foreground), 0, 0, WINEVENT_OUTOFCONTEXT);
    }
    tick(&app);
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(TICK_MS));
        let handle = app.clone();
        if app.run_on_main_thread(move || tick(&handle)).is_err() {
            return;
        }
    });
    Ok(())
}

/// Every TICK_MS: exit after Lightroom (spec 3.2 "Lightroom exits"), find its main window and any window
/// filling a monitor (rule 1), apply rule 3, save a moved Deck.
fn tick(app: &AppHandle) {
    let pid = LR_PID.load(SeqCst);
    if pid != 0 && !lightroom::pid_alive(pid) {
        write(json!({ "ev": "lightroom_exited", "pid": pid }));
        return app.exit(0);
    }
    let (found, wins) = lightroom::windows(pid);
    if pid == 0 && found != 0 {
        LR_PID.store(found, SeqCst);
        write(json!({ "ev": "lightroom_found", "pid": found }));
    }
    let main = lightroom::main_window(&wins);
    let cover = lightroom::cover(&wins, main);
    let main_changed = MAIN.swap(main, SeqCst) != main;
    if main_changed {
        lightroom::log_windows("main_changed", &wins, main);
    }
    let cover_changed = COVER.swap(cover, SeqCst) != cover;
    if cover_changed {
        write(json!({ "ev": "cover", "hwnd": cover }));
    }
    if main_changed || cover_changed {
        topmost_for(unsafe { GetForegroundWindow() });
    }
    keep_on_top(main, cover);
    let visible = unsafe { IsWindowVisible(deck()).as_bool() };
    if iconic(main) && visible {
        MIN_HIDDEN.store(true, SeqCst);
        hide_now("lightroom_minimised");
    } else if !iconic(main) && WANT.load(SeqCst) && MIN_HIDDEN.swap(false, SeqCst) {
        show_now("lightroom_restored");
    }
    if REFIT.swap(false, SeqCst) {
        set_open(OPEN.load(SeqCst));
    }
    if DIRTY.swap(false, SeqCst) {
        let r = rect();
        let saved = Saved { left: r.left, bottom: r.bottom, width: r.width() };
        let ok = store::save(&saved).map_err(|e| e.to_string());
        write(json!({ "ev": "saved", "left": saved.left, "bottom": saved.bottom, "width": saved.width, "error": ok.err() }));
    }
}

/// Times the Deck had to take the top back since the last log line ("on_top"), and whether it is losing it now.
static LOST: AtomicU32 = AtomicU32::new(0);
static LOSING: AtomicBool = AtomicBool::new(false);

/// Rule 1 between foreground changes. In Jim's Phase 7 check run 1 (2026-10-07 UTC), the Deck was not visible
/// over Lightroom in Shift+F's full-screen mode [stated: Jim], and the Deck's log has no foreground event while
/// Jim switched modes, so rule 1 was not applied again [handle: docs\reports\phase7\PHASE7.md "Observed", A9].
/// What covered it (Lightroom raising its own window, or making it topmost) is [unverified]: `on_top` records it.
/// Each tick, while the main window is in front, nothing covers the Deck's monitor and the Deck is shown:
/// a Deck that is not topmost, or has the main window above it, takes the top back.
fn keep_on_top(main: isize, cover: isize) {
    let fg = unsafe { GetForegroundWindow() };
    let shown = unsafe { IsWindowVisible(deck()).as_bool() };
    if main == 0 || cover != 0 || fg.0 as isize != main || !shown {
        return;
    }
    let topmost = |h: HWND| unsafe { GetWindowLongPtrW(h, GWL_EXSTYLE) } & WS_EX_TOPMOST.0 as isize != 0;
    let mut above = unsafe { GetWindow(deck(), GW_HWNDPREV) }.ok();
    let mut main_above = false;
    while let Some(h) = above {
        if h.0 as isize == main {
            main_above = true;
            break;
        }
        above = unsafe { GetWindow(h, GW_HWNDPREV) }.ok();
    }
    let losing = main_above || !topmost(deck());
    if losing {
        LOST.fetch_add(1, SeqCst);
        topmost_for(fg);
    }
    if LOSING.swap(losing, SeqCst) != losing {
        write(json!({ "ev": "on_top", "losing": losing, "main_topmost": topmost(hwnd(main)), "main_above": main_above, "times": LOST.swap(0, SeqCst) }));
    }
}

/// A move or resize (main.rs window events): saved at the next tick. A scale change refits the height.
pub fn moved(scale_changed: bool) {
    REFIT.fetch_or(scale_changed, SeqCst);
    if PLACED.load(SeqCst) {
        DIRTY.store(true, SeqCst);
    }
}

unsafe extern "system" fn on_foreground(_: HWINEVENTHOOK, _: u32, h: HWND, _: i32, _: i32, _: u32, _: u32) {
    let pid = window_pid(h);
    if pid != 0 && pid == LR_PID.load(SeqCst) {
        // F's window can appear with this event, before the next tick sees it.
        let (_, wins) = lightroom::windows(pid);
        COVER.store(lightroom::cover(&wins, MAIN.load(SeqCst)), SeqCst);
        lightroom::log_windows("foreground", &wins, MAIN.load(SeqCst));
    }
    let front = topmost_for(h);
    write(json!({ "ev": "foreground", "front": front, "fg_pid": pid, "fg_hwnd": h.0 as isize, "cover": COVER.load(SeqCst) }));
}

/// Rule 1. Not in front: not topmost, and just below the foreground window, since HWND_NOTOPMOST alone
/// puts it "above all non-topmost windows" [handle: MS nf-winuser-setwindowpos.md:103-131], e.g. over
/// Claude Desktop. While a Lightroom window fills its monitor (F), the Deck is never topmost and sits
/// just below that window: in Jim's probe the main window took the foreground back about 0.1 s after F
/// opened its window, so "main window in front" put the Deck over F's image (A9a NO; the Deck log's
/// foreground lines at 178.5 s and 178.6 s, docs/reports/phase7/deck-shell/).
fn topmost_for(fg: HWND) -> bool {
    let main = MAIN.load(SeqCst);
    // Only a cover on the Deck's own monitor counts: on another monitor it cannot hide the Deck, which
    // then follows the plain rule (Greptile, PR #87 review 2).
    let cover = match COVER.load(SeqCst) {
        c if c != 0 && monitors::same_monitor(hwnd(c), deck()) => c,
        _ => 0,
    };
    let front = cover == 0 && ((main != 0 && fg.0 as isize == main) || window_pid(fg) == std::process::id());
    let fg = if cover != 0 { hwnd(cover) } else { fg };
    let flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE;
    unsafe {
        if front {
            let _ = SetWindowPos(deck(), Some(HWND_TOPMOST), 0, 0, 0, 0, flags);
        } else {
            let _ = SetWindowPos(deck(), Some(HWND_NOTOPMOST), 0, 0, 0, 0, flags);
            let fg_topmost = GetWindowLongPtrW(fg, GWL_EXSTYLE) & WS_EX_TOPMOST.0 as isize != 0;
            if !fg.is_invalid() && !fg_topmost {
                let _ = SetWindowPos(deck(), Some(fg), 0, 0, 0, 0, flags);
            }
        }
    }
    front
}

fn rect() -> Rect {
    let mut r = RECT::default();
    unsafe {
        let _ = GetWindowRect(deck(), &mut r);
    }
    Rect { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
}

/// Moves and sizes the window without activating it, then pins its height (min = max) and its narrowest
/// width at the scale of the monitor it now sits on. The constraints are cleared first: each tao
/// constraint call resizes the window to fit at once (tao-0.37.1 platform_impl/windows/window.rs:290-292,
/// run synchronously on the main thread: tauri-runtime-wry-2.12.1 lib.rs:263-273), which would grow
/// the deck downward before it is moved.
fn set_rect(r: Rect, why: &str) {
    let w = WINDOW.get();
    if let Some(w) = w {
        let _ = w.set_min_size(None::<PhysicalSize<u32>>);
        let _ = w.set_max_size(None::<PhysicalSize<u32>>);
    }
    unsafe {
        let _ = SetWindowPos(deck(), None, r.left, r.top, r.right - r.left, r.bottom - r.top, SWP_NOZORDER | SWP_NOACTIVATE);
    }
    if let (Some(w), Some(m)) = (w, monitors::of_window(deck())) {
        let h = (r.bottom - r.top) as u32;
        let _ = w.set_min_size(Some(PhysicalSize::new((place::MIN_W * m.scale).round() as u32, h)));
        let _ = w.set_max_size(Some(PhysicalSize::new(100_000, h)));
    }
    let got = rect();
    write(json!({ "ev": "place", "why": why, "target": [r.left, r.top, r.width(), r.bottom - r.top], "got": [got.left, got.top, got.width(), got.bottom - got.top] }));
}

/// Rule 2, at the start of an edit.
fn place_for_edit() {
    let main = hwnd(MAIN.load(SeqCst));
    let home = monitors::of_window(main).unwrap_or(place::Monitor { work: rect(), scale: 1.0 });
    let saved = store::load();
    let (r, remembered) = place::place(saved, &monitors::all(), &home, OPEN.load(SeqCst));
    write(json!({ "ev": "spot", "remembered": remembered, "saved": saved.map(|s| [s.left, s.bottom, s.width]) }));
    set_rect(r, if remembered { "remembered" } else { "bottom_centre" });
    PLACED.store(true, SeqCst);
}

/// The bar (false) or the opened deck (true): the bottom edge stays, the deck grows upward.
pub fn set_open(open: bool) {
    OPEN.store(open, SeqCst);
    let r = rect();
    let Some(m) = monitors::of_window(deck()) else { return };
    set_rect(place::fit(r.left, r.bottom, r.width(), open, &m), if open { "open" } else { "close" });
}

fn show_now(reason: &str) {
    let fg = unsafe { GetForegroundWindow() };
    unsafe {
        let _ = ShowWindow(deck(), SW_SHOWNA);
    }
    webview::set_active(true);
    topmost_for(fg);
    write(json!({ "ev": "show", "reason": reason, "fg_pid": window_pid(fg), "fg_hwnd": fg.0 as isize }));
}

fn hide_now(reason: &str) {
    unsafe {
        let _ = ShowWindow(deck(), SW_HIDE);
    }
    webview::set_active(false);
    write(json!({ "ev": "hide", "reason": reason }));
}

/// The UI shows the Deck at an edit's start (rule 5): placed afresh, opened or as the bar (row 4c: opened
/// at each new edit [stated: Jim, 2026-10-05, "Opened by default"]), shown unless Lightroom is minimised.
pub fn show(reason: &str, open: bool) {
    WANT.store(true, SeqCst);
    OPEN.store(open, SeqCst);
    place_for_edit();
    let minimised = iconic(MAIN.load(SeqCst));
    MIN_HIDDEN.store(minimised, SeqCst);
    if !minimised {
        show_now(reason);
    }
}

pub fn hide(reason: &str) {
    WANT.store(false, SeqCst);
    MIN_HIDDEN.store(false, SeqCst);
    hide_now(reason);
}

/// After a pointer action the Deck hands the keyboard back to Lightroom's main window (Option C
/// docs\hud\option-c\NOTES.md section 3, "Focus"; spec 4.6). The Deck is the foreground window then, the
/// user having just clicked it, so Windows lets it give the foreground away [handle: MS
/// nf-winuser-setforegroundwindow.md:94-96, listed in docs\hud\research\SOURCES.md:16: "The calling
/// process is the foreground process"]. That it does on Jim's machine is [unverified] until the row 4c
/// probe.
pub fn focus_lightroom(why: &str) {
    let main = MAIN.load(SeqCst);
    let ok = main != 0 && unsafe { SetForegroundWindow(hwnd(main)).as_bool() };
    write(json!({ "ev": "focus_lightroom", "why": why, "ok": ok }));
}
