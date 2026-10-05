// Finding Lightroom's main window (spec 2.7 "Finding Lightroom's main window"; window rules 1-3 need it).
// The process: the one whose image is Lightroom.exe [handle: docs\reports\phase7\S9.md "S9 run 1",
// `lightroom_found` with exe `C:\Program Files\Adobe\Adobe Lightroom Classic\Lightroom.exe`].
// The main window: a visible, ownerless top-level window of that process whose title holds TITLE_MARK;
// when none does, the largest visible one, as S9 took it. S9b run 2's main window title was "Lightroom
// Catalog-v13-4 - Adobe Photoshop Lightroom Classic - Develop" (S9.md "S9b run 2"). That F's full-screen
// window has another title or an owner is [unverified]: `windows()` logs every Lightroom window, with
// class, title and owner, so the row 4b probe records what F opens.
use crate::log::write;
use serde_json::{json, Value};
use windows::core::{BOOL, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, RECT};
use windows::Win32::System::Threading::{
    GetExitCodeProcess, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::*;

pub const TITLE_MARK: &str = "Adobe Photoshop Lightroom Classic";
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
        self.visible && self.owner == 0 && self.title.contains(TITLE_MARK)
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

pub fn iconic(h: isize) -> bool {
    h != 0 && unsafe { IsIconic(hwnd(h)).as_bool() }
}

/// Logs Lightroom's windows, naming the one taken as the main window and why.
pub fn log_windows(why: &str, wins: &[Win], main: isize) {
    let by_title = wins.iter().any(|w| w.hwnd == main && w.is_main());
    write(json!({ "ev": "windows", "why": why, "main": main, "main_by": if by_title { "title" } else { "largest" },
                  "list": wins.iter().map(Win::json).collect::<Vec<_>>() }));
}
