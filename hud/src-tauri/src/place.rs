// Where the Deck goes (Phase 7 row 4b; spec docs\hud\lrc-avg-hud-spec-v2.md 2.7, window rules 2 and 4).
// Pure geometry in physical pixels, so `cargo test` covers it; monitors.rs feeds it the monitors.
//   - The remembered spot (left, bottom, width; window.json) is used when its bar's bottom centre lies on
//     a connected monitor's work area. Otherwise: bottom centre of the work area of Lightroom's monitor.
//   - The bottom edge stays put: opening grows the Deck upward (option-c/NOTES.md section 1), and every
//     rectangle is kept inside its monitor's work area.
// Sizes are CSS pixels times the monitor's scale. The bar and deck heights are the mockup's
// (option-c/NOTES.md section 1); the 1200 px default width is spec 2.7 rule 4 [inference: chosen, not
// measured]; the 640 px minimum is [inference: room for the headline and two buttons].

pub const BAR_H: f64 = 44.0;
pub const DECK_H: f64 = 144.0;
pub const DEFAULT_W: f64 = 1200.0;
pub const MIN_W: f64 = 640.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl Rect {
    pub fn width(&self) -> i32 {
        self.right - self.left
    }
    fn contains(&self, x: i32, y: i32) -> bool {
        x >= self.left && x < self.right && y >= self.top && y < self.bottom
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Monitor {
    pub work: Rect,
    /// DPI / 96.
    pub scale: f64,
}

/// The remembered spot: the Deck's left and bottom edges and its width, physical pixels.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Saved {
    pub left: i32,
    pub bottom: i32,
    pub width: i32,
}

fn px(css: f64, scale: f64) -> i32 {
    (css * scale).round() as i32
}

pub fn height(open: bool, scale: f64) -> i32 {
    px(if open { DECK_H } else { BAR_H }, scale)
}

/// The monitor a remembered spot lies on, if any.
pub fn monitor_of<'a>(saved: &Saved, monitors: &'a [Monitor]) -> Option<&'a Monitor> {
    monitors.iter().find(|m| m.work.contains(saved.left + saved.width / 2, saved.bottom - 1))
}

/// Where the Deck shows at the start of an edit, and whether it is the remembered spot.
pub fn place(saved: Option<Saved>, monitors: &[Monitor], home: &Monitor, open: bool) -> (Rect, bool) {
    if let Some((s, m)) = saved.and_then(|s| monitor_of(&s, monitors).map(|m| (s, m))) {
        return (fit(s.left, s.bottom, s.width, open, m), true);
    }
    let w = px(DEFAULT_W, home.scale).min(home.work.width());
    let left = home.work.left + (home.work.width() - w) / 2;
    (fit(left, home.work.bottom, w, open, home), false)
}

/// The rectangle with this left and bottom edge and width, at the bar's or the deck's height, inside `m`'s work area.
pub fn fit(left: i32, bottom: i32, width: i32, open: bool, m: &Monitor) -> Rect {
    let work = m.work;
    let h = height(open, m.scale).min(work.bottom - work.top);
    let width = width.clamp(px(MIN_W, m.scale).min(work.width()), work.width());
    let left = left.clamp(work.left, work.right - width);
    let bottom = bottom.clamp(work.top + h, work.bottom);
    Rect { left, top: bottom - h, right: left + width, bottom }
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: Monitor = Monitor { work: Rect { left: 0, top: 0, right: 3840, bottom: 2100 }, scale: 1.5 };
    const B: Monitor = Monitor { work: Rect { left: 3840, top: 200, right: 5760, bottom: 1240 }, scale: 1.0 };

    #[test]
    fn first_run_is_bottom_centre_of_lightrooms_monitor() {
        let (r, remembered) = place(None, &[A, B], &A, false);
        assert!(!remembered);
        assert_eq!(r, Rect { left: 1020, top: 2034, right: 2820, bottom: 2100 });
        let (r, _) = place(None, &[A, B], &B, false);
        assert_eq!(r, Rect { left: 4200, top: 1196, right: 5400, bottom: 1240 });
    }

    #[test]
    fn a_remembered_spot_on_a_monitor_is_kept() {
        let s = Saved { left: 4000, bottom: 900, width: 1000 };
        let (r, remembered) = place(Some(s), &[A, B], &A, false);
        assert!(remembered);
        assert_eq!(r, Rect { left: 4000, top: 856, right: 5000, bottom: 900 });
    }

    #[test]
    fn a_remembered_spot_on_no_monitor_falls_back() {
        let s = Saved { left: -9000, bottom: 500, width: 1000 };
        let (r, remembered) = place(Some(s), &[A, B], &A, false);
        assert!(!remembered);
        assert_eq!(r, place(None, &[A, B], &A, false).0);
    }

    #[test]
    fn opening_grows_upward_and_stays_inside_the_work_area() {
        let r = fit(4000, 900, 1000, true, &B);
        assert_eq!((r.top, r.bottom), (756, 900));
        // Near the top of the work area the bottom edge moves down instead of the deck leaving it.
        let r = fit(4000, 250, 1000, true, &B);
        assert_eq!((r.top, r.bottom), (200, 344));
    }

    #[test]
    fn width_and_edges_are_clamped() {
        let r = fit(5500, 900, 100, false, &B);
        assert_eq!((r.left, r.right), (5120, 5760)); // widened to 640, pulled back on screen
        let r = fit(3000, 900, 99999, false, &B);
        assert_eq!((r.left, r.right), (3840, 5760));
    }
}
