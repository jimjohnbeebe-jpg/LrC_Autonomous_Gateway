// While the Deck is shown: which other windows lie over it (fix/deck-relaunch). On 2026-10-10 a shown Deck
// took no hover and no click, with nothing over it that Jim could see [stated: Jim, 2026-10-10]; no probe run
// reproduced it [handle: docs\reports\phase8.5\deck-relaunch.md "Observed"]. Each tick samples a 5 x 3 grid
// over the Deck's window with WindowFromPoint, which skips hidden and disabled windows [handle:
// https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-windowfrompoint, Remarks]. That
// it names the window the mouse reaches there is [inference]: a window answering HTTRANSPARENT passes it on.
// Logged as "over" at each show and whenever the windows found change.
use crate::lightroom::{text, window_pid};
use crate::log::write;
use serde_json::json;
use std::sync::Mutex;
use windows::Win32::Foundation::{HWND, POINT, RECT};
use windows::Win32::UI::WindowsAndMessaging::{GetAncestor, GetWindowRect, WindowFromPoint, GA_ROOT};

const COLUMNS: i32 = 5;
const ROWS: i32 = 3;

/// The last windows logged (top-level window, points), or None: log the next check.
static LAST: Mutex<Option<Vec<(isize, u32)>>> = Mutex::new(None);

/// A show logs its first check, even with nothing over the Deck.
pub fn reset() {
    *LAST.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

pub fn check(deck: HWND) {
    let mut r = RECT::default();
    if unsafe { GetWindowRect(deck, &mut r) }.is_err() {
        return;
    }
    let mut over: Vec<(isize, u32)> = Vec::new();
    for i in 1..=COLUMNS {
        for j in 1..=ROWS {
            let p = POINT { x: r.left + (r.right - r.left) * i / (COLUMNS + 1), y: r.top + (r.bottom - r.top) * j / (ROWS + 1) };
            let root = unsafe { GetAncestor(WindowFromPoint(p), GA_ROOT) };
            if root == deck {
                continue;
            }
            match over.iter_mut().find(|(h, _)| *h == root.0 as isize) {
                Some(found) => found.1 += 1,
                None => over.push((root.0 as isize, 1)),
            }
        }
    }
    let mut last = LAST.lock().unwrap_or_else(|e| e.into_inner());
    if last.as_ref() == Some(&over) {
        return;
    }
    // Titles are logged but not compared: VS Code's, for one, changes while it works.
    let by: Vec<_> = over
        .iter()
        .map(|&(h, points)| {
            let w = HWND(h as *mut core::ffi::c_void);
            json!({ "hwnd": h, "pid": window_pid(w), "class": text(w, true), "title": text(w, false), "points": points })
        })
        .collect();
    write(json!({ "ev": "over", "of": COLUMNS * ROWS, "by": by }));
    *last = Some(over);
}
