// S9b: the HUD hides while Lightroom's window is dragged or resized and comes back in place when the
// move ends [stated: Jim, 2026-10-04, "Hide, reappear in place (Recommended)"]. Following a drag
// trails it: in Jim's S9 run Lightroom's location events came about every 64 ms during drags
// [handle: docs\reports\phase7\S9\follow-analysis.txt].
//
// Two triggers, logged apart so S9b shows which one Lightroom gives:
// - "movesize": EVENT_SYSTEM_MOVESIZESTART / EVENT_SYSTEM_MOVESIZEEND for Lightroom's window
//   [handle: MS event-constants.md, https://learn.microsoft.com/windows/win32/winauto/event-constants].
//   Whether Lightroom's window sends them is [unverified].
// - "burst": 3 location events within 200 ms each without a movesize start; the HUD then stays hidden
//   until 150 ms pass with no location event.
use crate::log::{now_ms, write};
use crate::win;
use serde_json::json;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize, Ordering::SeqCst};
use std::sync::Mutex;
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
use windows::Win32::UI::WindowsAndMessaging::{
    KillTimer, SetTimer, EVENT_SYSTEM_MOVESIZEEND, EVENT_SYSTEM_MOVESIZESTART, OBJID_WINDOW, WINEVENT_OUTOFCONTEXT,
};

static MOVESIZE: AtomicBool = AtomicBool::new(false);
static BURST: AtomicBool = AtomicBool::new(false);
static LAST_MS: AtomicU64 = AtomicU64::new(0);
static RUN: AtomicU32 = AtomicU32::new(0);
static TIMER: AtomicUsize = AtomicUsize::new(0);
static LAST_RECT: Mutex<Option<(i32, i32, i32, i32)>> = Mutex::new(None);
const BURST_GAP_MS: u64 = 200;
const BURST_EVENTS: u32 = 3;
const QUIET_MS: u32 = 150;

pub fn dragging() -> bool {
    MOVESIZE.load(SeqCst) || BURST.load(SeqCst)
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
        if !BURST.load(SeqCst) {
            win::show_after_move("movesize");
        }
    }
}

/// Called for each location event of Lightroom's window, before the HUD is placed, with its rectangle
/// (None while minimised). Only an event that changes the rectangle counts toward a burst: Claude Code's
/// test saw a restore send 3 events within 24 ms with the same rectangle (S9.md "Pre-run findings").
pub fn on_location(rect: Option<(i32, i32, i32, i32)>) {
    let Some(rect) = rect else { return };
    if let Ok(mut last) = LAST_RECT.lock() {
        if *last == Some(rect) {
            return;
        }
        *last = Some(rect);
    }
    let now = now_ms() as u64;
    let close = now.saturating_sub(LAST_MS.swap(now, SeqCst)) < BURST_GAP_MS;
    let run = if close { RUN.fetch_add(1, SeqCst) + 1 } else { RUN.store(1, SeqCst); 1 };
    if MOVESIZE.load(SeqCst) {
        return;
    }
    if !BURST.load(SeqCst) && run >= BURST_EVENTS {
        BURST.store(true, SeqCst);
        win::hide_for_move("burst");
    }
    if BURST.load(SeqCst) {
        unsafe {
            let old = TIMER.swap(0, SeqCst);
            if old != 0 {
                let _ = KillTimer(None, old);
            }
            TIMER.store(SetTimer(None, 0, QUIET_MS, Some(on_quiet)), SeqCst);
        }
    }
}

unsafe extern "system" fn on_quiet(_: HWND, _: u32, id: usize, _: u32) {
    let _ = KillTimer(None, id);
    TIMER.store(0, SeqCst);
    BURST.store(false, SeqCst);
    if !MOVESIZE.load(SeqCst) {
        win::show_after_move("burst");
    }
    write(json!({ "ev": "burst_quiet" }));
}
