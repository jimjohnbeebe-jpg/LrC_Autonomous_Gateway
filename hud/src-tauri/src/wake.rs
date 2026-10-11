// A second Deck launch wakes the running one (Phase 8.5, fix/deck-relaunch). The engine starts the Deck
// at an edit's begin when none is connected (engine\src\hud\launch.ts). When a Deck is already running,
// hidden and disconnected after the engine's idle release, the new process used to exit at once on the
// one-Deck mutex (main.rs), and the running Deck found the engine only through its page's 2 s timer, which
// took 23 s and 36 s on 2026-10-10 [handle: docs\reports\phase8.5\deck-relaunch.md "Pre-run findings" 3]. Now the
// second launch sets a named event and exits; the running Deck waits on it in a Rust thread (no page
// timer involved) and tells its page to connect at once (deck.ts `deckWake`).
use crate::log::write;
use serde_json::json;
use tauri::WebviewWindow;
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
use windows::Win32::System::Threading::{CreateEventW, OpenEventW, SetEvent, WaitForSingleObject, EVENT_MODIFY_STATE, INFINITE};

// Tests use their own name, so `cargo test` never wakes a Deck running on the same PC.
#[cfg(not(test))]
const WAKE: PCWSTR = w!(r"Local\LrC-AVG-HUD-wake");
#[cfg(test)]
const WAKE: PCWSTR = w!(r"Local\LrC-AVG-HUD-wake-test");

/// The first Deck: make the auto-reset event, before the window exists, so a launch during start-up finds it.
pub fn create() -> Option<isize> {
    // Kept for the life of the process; Windows closes it at exit.
    unsafe { CreateEventW(None, false, false, WAKE).ok().map(|h| h.0 as isize) }
}

/// A second launch: wake the running Deck. False when no Deck made the event (it is still starting, or
/// none runs); a starting Deck connects from its page's load anyway.
pub fn signal() -> bool {
    unsafe {
        match OpenEventW(EVENT_MODIFY_STATE, false, WAKE) {
            Ok(h) => {
                let set = SetEvent(h).is_ok();
                let _ = CloseHandle(h);
                set
            }
            Err(_) => false,
        }
    }
}

/// The first Deck: each signal asks the page to connect now (deck.ts `deckWake`).
pub fn listen(event: isize, window: WebviewWindow) {
    std::thread::spawn(move || loop {
        let h = HANDLE(event as *mut core::ffi::c_void);
        if unsafe { WaitForSingleObject(h, INFINITE) } != WAIT_OBJECT_0 {
            write(json!({ "ev": "wake_wait_failed" }));
            return;
        }
        let asked = window.eval("window.deckWake && window.deckWake()").is_ok();
        write(json!({ "ev": "wake", "asked_page": asked }));
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_launch_wakes_the_event_the_first_deck_made_once() {
        assert!(!signal(), "no event before the first Deck makes it");
        let event = create().expect("event");
        assert!(signal());
        let h = HANDLE(event as *mut core::ffi::c_void);
        assert_eq!(unsafe { WaitForSingleObject(h, 0) }, WAIT_OBJECT_0);
        // Auto-reset: one signal, one wake.
        assert_ne!(unsafe { WaitForSingleObject(h, 0) }, WAIT_OBJECT_0);
    }
}
