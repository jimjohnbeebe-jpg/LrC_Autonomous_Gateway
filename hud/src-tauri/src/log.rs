// One JSON line per event in %TEMP%\LrC-AVG\hud\hud_<pid>_<start ms>.jsonl; `t` is epoch milliseconds.
// The start time in the name keeps each process's log apart: Windows reuses pids (S9.md "Pre-run
// findings"). The row 4b probe (hud\probe\probe.ts) reads these lines.
// ponytail: one small file per Deck start, never pruned; prune by age if they ever add up.
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
    let dir = std::env::temp_dir().join("LrC-AVG").join("hud");
    std::fs::create_dir_all(&dir).ok()?;
    let path = dir.join(format!("hud_{}_{}.jsonl", std::process::id(), now_ms() as u64));
    OpenOptions::new().create(true).append(true).open(path).ok().map(Mutex::new)
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
