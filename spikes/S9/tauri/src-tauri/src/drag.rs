// S9b: the HUD hides while Lightroom's window is dragged or resized and comes back in place when the
// move ends [stated: Jim, 2026-10-04, "Hide, reappear in place (Recommended)"]. Following a drag
// trails it: in Jim's S9 run Lightroom's location events came about every 64 ms during drags
// [handle: docs\reports\phase7\S9\follow-analysis.txt].
//
// Two triggers, logged apart so S9b shows which one Lightroom gives:
// - "movesize": EVENT_SYSTEM_MOVESIZESTART / EVENT_SYSTEM_MOVESIZEEND for Lightroom's window
//   [handle: MS event-constants.md, https://learn.microsoft.com/windows/win32/winauto/event-constants].
//   Whether Lightroom's window sends them is [unverified].
// - "button": a location event that changes Lightroom's rectangle while the primary mouse button is
//   down; the button is then polled every 30 ms and the HUD comes back when it is released. A pause
//   in the drag keeps it hidden, and a keyboard or programmatic move (no button) is followed as before.
//   GetAsyncKeyState reads the physical button, so a swapped mouse reads VK_RBUTTON
//   [handle: MS nf-winuser-getasynckeystate.md:80-81, :101-102].
use crate::log::write;
use crate::win;
use serde_json::json;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering::SeqCst};
use std::sync::Mutex;
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON};
use windows::Win32::UI::WindowsAndMessaging::{
    GetSystemMetrics, KillTimer, SetTimer, EVENT_SYSTEM_MOVESIZEEND, EVENT_SYSTEM_MOVESIZESTART, OBJID_WINDOW,
    SM_SWAPBUTTON, WINEVENT_OUTOFCONTEXT,
};

static MOVESIZE: AtomicBool = AtomicBool::new(false);
static BUTTON: AtomicBool = AtomicBool::new(false);
static TIMER: AtomicUsize = AtomicUsize::new(0);
static LAST_RECT: Mutex<Option<(i32, i32, i32, i32)>> = Mutex::new(None);
const BUTTON_POLL_MS: u32 = 30;

pub fn dragging() -> bool {
    MOVESIZE.load(SeqCst) || BUTTON.load(SeqCst)
}

fn primary_down() -> bool {
    unsafe {
        let key = if GetSystemMetrics(SM_SWAPBUTTON) != 0 { VK_RBUTTON } else { VK_LBUTTON };
        GetAsyncKeyState(key.0 as i32) < 0
    }
}

fn stop_button_poll() {
    let old = TIMER.swap(0, SeqCst);
    if old != 0 {
        unsafe {
            let _ = KillTimer(None, old);
        }
    }
    BUTTON.store(false, SeqCst);
}

/// Main thread only, once Lightroom's pid is known.
pub fn hook(pid: u32) {
    unsafe {
        SetWinEventHook(EVENT_SYSTEM_MOVESIZESTART, EVENT_SYSTEM_MOVESIZEEND, None, Some(on_movesize), pid, 0, WINEVENT_OUTOFCONTEXT);
    }
}

unsafe extern "system" fn on_movesize(_: HWINEVENTHOOK, event: u32, h: HWND, id_object: i32, _: i32, _: u32, _: u32) {
    if h.0 as isize != win::lightroom() || id_object != OBJID_WINDOW.0 {
        return;
    }
    if event == EVENT_SYSTEM_MOVESIZESTART {
        MOVESIZE.store(true, SeqCst);
        win::hide_for_move("movesize");
    } else {
        MOVESIZE.store(false, SeqCst);
        stop_button_poll();
        win::show_after_move("movesize");
    }
}

/// Called for each location event of Lightroom's window, before the HUD is placed, with its rectangle
/// (None while minimised). Only an event that changes the rectangle counts: Claude Code's test saw a
/// restore send 3 events within 24 ms with the same rectangle (S9b-prerun\prerun.txt section 4a).
pub fn on_location(rect: Option<(i32, i32, i32, i32)>) {
    let Some(rect) = rect else { return };
    if let Ok(mut last) = LAST_RECT.lock() {
        if *last == Some(rect) {
            return;
        }
        *last = Some(rect);
    }
    if dragging() || !primary_down() {
        return;
    }
    BUTTON.store(true, SeqCst);
    win::hide_for_move("button");
    unsafe {
        TIMER.store(SetTimer(None, 0, BUTTON_POLL_MS, Some(on_poll)), SeqCst);
    }
}

unsafe extern "system" fn on_poll(_: HWND, _: u32, _: usize, _: u32) {
    if primary_down() || !BUTTON.load(SeqCst) {
        return;
    }
    stop_button_poll();
    if !MOVESIZE.load(SeqCst) {
        win::show_after_move("button");
    }
    write(json!({ "ev": "button_released" }));
}
