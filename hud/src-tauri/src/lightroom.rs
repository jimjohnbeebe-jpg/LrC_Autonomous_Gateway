// Finding Lightroom's main window (spec 2.7 "Finding Lightroom's main window"; window rules 1-3 need it).
// The process: the one whose image is Lightroom.exe [handle: docs\reports\phase7\S9.md "S9 run 1",
// `lightroom_found` with exe `C:\Program Files\Adobe\Adobe Lightroom Classic\Lightroom.exe`].
// The main window: a visible, ownerless top-level window of that process of class MAIN_CLASS, or whose
// title holds TITLE_MARK; when none is, the largest visible one, as S9 took it. Jim's row 4b probe logged
// the main window as class "AgWinMainFrame", ownerless, titled "Lightroom Catalog-v13-4 - Adobe Photoshop
// Lightroom Classic - Develop", and that title briefly read just "Lightroom Classic" while F was on, so
// the title alone lost the main window to F's (the class is the first test) [handle:
// docs\reports\phase7\deck-shell\, the Deck log's `windows` lines at 176.7 s and 187.8 s].
// F's full-screen preview is a separate window (`cover`): class "NonActivateWindow", title "Lightroom",
// owned by the main window, the size of its whole monitor (same log, 178.5 s). `windows()` logs every
// Lightroom window, with class, title and owner.
use crate::log::write;
use serde_json::{json, Value};
use windows::core::{BOOL, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, RECT};
use windows::Win32::System::Threading::{
    GetExitCodeProcess, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::*;

pub const TITLE_MARK: &str = "Adobe Photoshop Lightroom Classic";
pub const MAIN_CLASS: &str = "AgWinMainFrame";
const STILL_ACTIVE: u32 = 259;

pub fn hwnd(v: isize) -> HWND {
    HWND(v as *mut core::ffi::c_void)
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

pub fn window_pid(h: HWND) -> u32 {
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(h, Some(&mut pid)) };
    pid
}

/// "\lightroom.exe"; LRC_AVG_HUD_LR_EXE (e.g. notepad.exe) lets Claude Code try the Deck without Lightroom.
fn target_exe() -> String {
    let exe = std::env::var("LRC_AVG_HUD_LR_EXE").unwrap_or_else(|_| "lightroom.exe".into());
    format!("\\{}", exe.to_lowercase())
}

/// One top-level window of Lightroom's process.
pub struct Win {
    pub hwnd: isize,
    pub visible: bool,
    pub owner: isize,
    pub title: String,
    pub class: String,
    pub rect: RECT,
}

impl Win {
    fn area(&self) -> i64 {
        (self.rect.right - self.rect.left) as i64 * (self.rect.bottom - self.rect.top) as i64
    }
    fn is_main(&self) -> bool {
        self.visible && self.owner == 0 && (self.class == MAIN_CLASS || self.title.contains(TITLE_MARK))
    }
    pub fn json(&self) -> Value {
        let r = self.rect;
        json!({ "hwnd": self.hwnd, "visible": self.visible, "owner": self.owner, "title": self.title, "class": self.class,
                "rect": [r.left, r.top, r.right - r.left, r.bottom - r.top], "iconic": iconic(self.hwnd) })
    }
}

fn text(h: HWND, class: bool) -> String {
    let mut buf = [0u16; 512];
    let n = unsafe { if class { GetClassNameW(h, &mut buf) } else { GetWindowTextW(h, &mut buf) } };
    String::from_utf16_lossy(&buf[..n.max(0) as usize])
}

struct Scan {
    pid: u32,
    wins: Vec<Win>,
}

unsafe extern "system" fn enum_cb(h: HWND, lp: LPARAM) -> BOOL {
    let scan = &mut *(lp.0 as *mut Scan);
    let pid = window_pid(h);
    let wanted = if scan.pid != 0 { pid == scan.pid } else { IsWindowVisible(h).as_bool() && exe_name(pid).to_lowercase().ends_with(&target_exe()) };
    if wanted {
        scan.pid = pid; // the first match names the process; the rest of the scan keeps to it
        let mut rect = RECT::default();
        let _ = GetWindowRect(h, &mut rect);
        let owner = GetWindow(h, GW_OWNER).map(|o| o.0 as isize).unwrap_or(0);
        scan.wins.push(Win { hwnd: h.0 as isize, visible: IsWindowVisible(h).as_bool(), owner, title: text(h, false), class: text(h, true), rect });
    }
    true.into()
}

/// Lightroom's top-level windows: of process `pid`, or, with 0, of the first process whose image is
/// Lightroom.exe. Returns the pid found (0: none) and its windows.
pub fn windows(pid: u32) -> (u32, Vec<Win>) {
    let mut scan = Scan { pid, wins: Vec::new() };
    unsafe {
        let _ = EnumWindows(Some(enum_cb), LPARAM(&mut scan as *mut Scan as isize));
    }
    (scan.pid, scan.wins)
}

/// The main window among `wins` (0: none).
pub fn main_window(wins: &[Win]) -> isize {
    if let Some(w) = wins.iter().find(|w| w.is_main()) {
        return w.hwnd;
    }
    wins.iter().filter(|w| w.visible).max_by_key(|w| w.area()).map(|w| w.hwnd).unwrap_or(0)
}

/// A visible Lightroom window other than the main one that fills its whole monitor (F's full-screen
/// preview), or 0. The Deck is never topmost over it (spec 2.7 rule 1, A9; window.rs topmost_for).
pub fn cover(wins: &[Win], main: isize) -> isize {
    wins.iter()
        .find(|w| w.visible && w.hwnd != main && !iconic(w.hwnd) && crate::monitors::fills_monitor(hwnd(w.hwnd), w.rect))
        .map(|w| w.hwnd)
        .unwrap_or(0)
}

pub fn iconic(h: isize) -> bool {
    h != 0 && unsafe { IsIconic(hwnd(h)).as_bool() }
}

/// Logs Lightroom's windows, naming the one taken as the main window and why.
pub fn log_windows(why: &str, wins: &[Win], main: isize) {
    let by_title = wins.iter().any(|w| w.hwnd == main && w.is_main());
    write(json!({ "ev": "windows", "why": why, "main": main, "main_by": if by_title { "title" } else { "largest" },
                  "list": wins.iter().map(Win::json).collect::<Vec<_>>() }));
}
