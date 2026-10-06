// The connected monitors' work areas and scales, for place.rs (Win32: EnumDisplayMonitors,
// GetMonitorInfoW rcWork, GetDpiForMonitor MDT_EFFECTIVE_DPI).
use crate::place::{Monitor, Rect};
use windows::core::BOOL;
use windows::Win32::Foundation::{HWND, LPARAM, POINT, RECT};
use windows::Win32::Graphics::Gdi::*;
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};

fn monitor(h: HMONITOR) -> Option<Monitor> {
    let mut info = MONITORINFO { cbSize: size_of::<MONITORINFO>() as u32, ..Default::default() };
    unsafe {
        if !GetMonitorInfoW(h, &mut info).as_bool() {
            return None;
        }
        let (mut dx, mut dy) = (96u32, 96u32);
        let _ = GetDpiForMonitor(h, MDT_EFFECTIVE_DPI, &mut dx, &mut dy);
        let w = info.rcWork;
        Some(Monitor { work: Rect { left: w.left, top: w.top, right: w.right, bottom: w.bottom }, scale: dx as f64 / 96.0 })
    }
}

unsafe extern "system" fn enum_cb(h: HMONITOR, _: HDC, _: *mut RECT, lp: LPARAM) -> BOOL {
    let all = &mut *(lp.0 as *mut Vec<Monitor>);
    all.extend(monitor(h));
    true.into()
}

pub fn all() -> Vec<Monitor> {
    let mut all: Vec<Monitor> = Vec::new();
    unsafe {
        let _ = EnumDisplayMonitors(None, None, Some(enum_cb), LPARAM(&mut all as *mut Vec<Monitor> as isize));
    }
    all
}

/// The monitor of window `h`, or the primary one when `h` is 0.
pub fn of_window(h: HWND) -> Option<Monitor> {
    let m = unsafe {
        if h.is_invalid() { MonitorFromPoint(POINT::default(), MONITOR_DEFAULTTOPRIMARY) } else { MonitorFromWindow(h, MONITOR_DEFAULTTOPRIMARY) }
    };
    monitor(m)
}

/// Whether `rect` (window `h`'s) covers its whole monitor, taskbar included.
pub fn fills_monitor(h: HWND, rect: RECT) -> bool {
    let mut info = MONITORINFO { cbSize: size_of::<MONITORINFO>() as u32, ..Default::default() };
    unsafe {
        let m = MonitorFromWindow(h, MONITOR_DEFAULTTONULL);
        if m.is_invalid() || !GetMonitorInfoW(m, &mut info).as_bool() {
            return false;
        }
    }
    let r = info.rcMonitor;
    rect.left <= r.left && rect.top <= r.top && rect.right >= r.right && rect.bottom >= r.bottom
}

/// Whether windows `a` and `b` are mostly on the same monitor.
pub fn same_monitor(a: HWND, b: HWND) -> bool {
    unsafe { MonitorFromWindow(a, MONITOR_DEFAULTTONEAREST) == MonitorFromWindow(b, MONITOR_DEFAULTTONEAREST) }
}
