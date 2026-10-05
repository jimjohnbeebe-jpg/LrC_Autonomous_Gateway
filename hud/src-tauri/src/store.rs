// The remembered spot, `%LOCALAPPDATA%\LrC-AVG\hud\window.json` (spec 2.7 rule 4): one entry, the Deck's
// left and bottom edges and its width in physical pixels. Written to a temporary name and renamed, so a
// reader never sees half a file; a missing or unreadable file reads as "no spot" (first run).
use crate::place::Saved;
use serde_json::{json, Value};
use std::path::PathBuf;

fn path() -> Option<PathBuf> {
    Some(PathBuf::from(std::env::var("LOCALAPPDATA").ok()?).join("LrC-AVG").join("hud").join("window.json"))
}

pub fn load() -> Option<Saved> {
    let v: Value = serde_json::from_str(&std::fs::read_to_string(path()?).ok()?).ok()?;
    let int = |k: &str| v.get(k)?.as_i64().and_then(|n| i32::try_from(n).ok());
    Some(Saved { left: int("left")?, bottom: int("bottom")?, width: int("width")? }).filter(|s| s.width > 0)
}

pub fn save(s: &Saved) -> std::io::Result<()> {
    let file = path().ok_or_else(|| std::io::Error::other("LOCALAPPDATA is not set"))?;
    std::fs::create_dir_all(file.parent().expect("window.json has a folder"))?;
    let temp = file.with_extension(format!("{}.tmp", std::process::id()));
    std::fs::write(&temp, json!({ "left": s.left, "bottom": s.bottom, "width": s.width }).to_string())?;
    std::fs::rename(&temp, &file) // MoveFileExW with MOVEFILE_REPLACE_EXISTING on Windows [handle: https://doc.rust-lang.org/std/fs/fn.rename.html]
}
