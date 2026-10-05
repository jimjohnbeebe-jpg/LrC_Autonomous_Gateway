// One JSON line per event in %TEMP%\LrC-AVG\S9\hud_<pid>.jsonl; `t` is epoch milliseconds, as
// measure.ts and stub-engine.ts write them, so the three logs share one clock.
use serde_json::Value;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

static FILE: OnceLock<Option<Mutex<File>>> = OnceLock::new();

pub fn now_ms() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64() * 1000.0).unwrap_or(0.0)
}

fn open() -> Option<Mutex<File>> {
    let dir = std::env::temp_dir().join("LrC-AVG").join("S9");
    std::fs::create_dir_all(&dir).ok()?;
    let path = dir.join(format!("hud_{}.jsonl", std::process::id()));
    // Truncated at the process's first line: Windows reuses pids, and an appended file mixed an earlier
    // HUD's lines (and window handle) into a new one's in Claude Code's dry run (S9.md "Pre-run findings").
    OpenOptions::new().create(true).write(true).truncate(true).open(path).ok().map(Mutex::new)
}

pub fn write(mut line: Value) {
    if let Some(obj) = line.as_object_mut() {
        obj.entry("t").or_insert(Value::from(now_ms()));
    }
    if let Some(file) = FILE.get_or_init(open) {
        if let Ok(mut f) = file.lock() {
            let _ = writeln!(f, "{line}");
        }
    }
}
