// Spike S9: the Win32 reads measure.ts needs, through koffi 3.3.2 (prebuilt @koromix/koffi-win32-x64,
// no C++ toolchain). Window handles are plain numbers (uintptr_t), process handles intptr_t.
// Signatures follow the MicrosoftDocs sdk-api pages for each function (docs\hud\research\SOURCES.md).
import koffi from "koffi";

const user32 = koffi.load("user32.dll");
const kernel32 = koffi.load("kernel32.dll");
const winmm = koffi.load("winmm.dll");

koffi.struct("RECT", { left: "int32_t", top: "int32_t", right: "int32_t", bottom: "int32_t" });
koffi.struct("POINT", { x: "int32_t", y: "int32_t" });
koffi.struct("FILETIME", { lo: "uint32_t", hi: "uint32_t" });
koffi.struct("PMC_EX", {
  cb: "uint32_t", PageFaultCount: "uint32_t", PeakWorkingSetSize: "size_t", WorkingSetSize: "size_t",
  QuotaPeakPagedPoolUsage: "size_t", QuotaPagedPoolUsage: "size_t", QuotaPeakNonPagedPoolUsage: "size_t",
  QuotaNonPagedPoolUsage: "size_t", PagefileUsage: "size_t", PeakPagefileUsage: "size_t", PrivateUsage: "size_t",
});
const PE = koffi.struct("PROCESSENTRY32W", {
  dwSize: "uint32_t", cntUsage: "uint32_t", th32ProcessID: "uint32_t", th32DefaultHeapID: "uintptr_t",
  th32ModuleID: "uint32_t", cntThreads: "uint32_t", th32ParentProcessID: "uint32_t", pcPriClassBase: "int32_t",
  dwFlags: "uint32_t", szExeFile: koffi.array("char16_t", 260, "String"),
});

type Rect = { left: number; top: number; right: number; bottom: number };
type FileTime = { lo: number; hi: number };

const GetForegroundWindow = user32.func("uintptr_t __stdcall GetForegroundWindow()");
const IsWindowVisible = user32.func("bool __stdcall IsWindowVisible(uintptr_t h)");
const IsIconic = user32.func("bool __stdcall IsIconic(uintptr_t h)");
const GetWindowRect = user32.func("bool __stdcall GetWindowRect(uintptr_t h, _Out_ RECT *r)");
const GetClientRect = user32.func("bool __stdcall GetClientRect(uintptr_t h, _Out_ RECT *r)");
const ClientToScreen = user32.func("bool __stdcall ClientToScreen(uintptr_t h, _Inout_ POINT *p)");
const GetWindowThreadProcessId = user32.func("uint32_t __stdcall GetWindowThreadProcessId(uintptr_t h, _Out_ uint32_t *pid)");
const GetTopWindow = user32.func("uintptr_t __stdcall GetTopWindow(uintptr_t h)");
const GetWindow = user32.func("uintptr_t __stdcall GetWindow(uintptr_t h, uint32_t cmd)");
const GetWindowLongPtrW = user32.func("intptr_t __stdcall GetWindowLongPtrW(uintptr_t h, int index)");
const GetDpiForWindow = user32.func("uint32_t __stdcall GetDpiForWindow(uintptr_t h)");
const GetWindowTextW = user32.func("int __stdcall GetWindowTextW(uintptr_t h, _Out_ uint8_t *buf, int max)");
const SystemParametersInfoW = user32.func("bool __stdcall SystemParametersInfoW(uint32_t action, uint32_t param, _Out_ int32_t *value, uint32_t ini)");
const OpenProcess = kernel32.func("intptr_t __stdcall OpenProcess(uint32_t access, bool inherit, uint32_t pid)");
const CloseHandle = kernel32.func("bool __stdcall CloseHandle(intptr_t h)");
const GetProcessTimes = kernel32.func("bool __stdcall GetProcessTimes(intptr_t h, _Out_ FILETIME *c, _Out_ FILETIME *e, _Out_ FILETIME *k, _Out_ FILETIME *u)");
const K32GetProcessMemoryInfo = kernel32.func("bool __stdcall K32GetProcessMemoryInfo(intptr_t h, _Out_ PMC_EX *pmc, uint32_t cb)");
const CreateToolhelp32Snapshot = kernel32.func("intptr_t __stdcall CreateToolhelp32Snapshot(uint32_t flags, uint32_t pid)");
const Process32FirstW = kernel32.func("bool __stdcall Process32FirstW(intptr_t snap, _Inout_ PROCESSENTRY32W *pe)");
const Process32NextW = kernel32.func("bool __stdcall Process32NextW(intptr_t snap, _Inout_ PROCESSENTRY32W *pe)");
const SetProcessDpiAwarenessContext = user32.func("bool __stdcall SetProcessDpiAwarenessContext(intptr_t ctx)");
const timeBeginPeriod = winmm.func("uint32_t __stdcall timeBeginPeriod(uint32_t ms)");

// Per-monitor aware (DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4), like the HUD (tao). Otherwise
// Windows gives this process scaled rectangles: Claude Code's probe on a 150 % monitor read Notepad's
// client as 1359 px wide where the HUD read 2039 (S9.md "Pre-run findings").
SetProcessDpiAwarenessContext(-4);
const timeEndPeriod = winmm.func("uint32_t __stdcall timeEndPeriod(uint32_t ms)");

const GW_HWNDNEXT = 2;
const GWL_EXSTYLE = -20;
const WS_EX_TOPMOST = 0x8;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const PROCESS_VM_READ = 0x10;
const TH32CS_SNAPPROCESS = 0x2;
const SPI_GETCLIENTAREAANIMATION = 0x1042;
/** As src-tauri\src\win.rs: the Deck is 44 px over a 144 px filmstrip band [stage]. */
const DECK_H = 44;
const BAND_H = 144;

export const foreground = (): number => GetForegroundWindow() as number;
export const visible = (h: number): boolean => h !== 0 && (IsWindowVisible(h) as boolean);
export const iconic = (h: number): boolean => IsIconic(h) as boolean;

export function rect(h: number): Rect {
  const r: Rect = { left: 0, top: 0, right: 0, bottom: 0 };
  GetWindowRect(h, r);
  return r;
}

export function pidOf(h: number): number {
  const out = [0];
  GetWindowThreadProcessId(h, out);
  return out[0] ?? 0;
}

export function title(h: number): string {
  const buf = Buffer.alloc(1024);
  const n = GetWindowTextW(h, buf, 512) as number;
  return buf.subarray(0, n * 2).toString("utf16le");
}

export const topmost = (h: number): boolean => (Number(GetWindowLongPtrW(h, GWL_EXSTYLE)) & WS_EX_TOPMOST) !== 0;

/** Every top-level window, top of the z-order first. */
export function zOrder(): number[] {
  const out: number[] = [];
  for (let h = GetTopWindow(0) as number; h !== 0 && out.length < 5000; h = GetWindow(h, GW_HWNDNEXT) as number) out.push(h);
  return out;
}

export function processes(): Map<number, { ppid: number; exe: string }> {
  const map = new Map<number, { ppid: number; exe: string }>();
  const snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) as number;
  if (snap === -1) return map;
  const pe: Record<string, unknown> = { dwSize: koffi.sizeof(PE) };
  for (let ok = Process32FirstW(snap, pe) as boolean; ok; ok = Process32NextW(snap, pe) as boolean) {
    map.set(pe.th32ProcessID as number, { ppid: pe.th32ParentProcessID as number, exe: String(pe.szExeFile) });
  }
  CloseHandle(snap);
  return map;
}

export function pidsByExe(exe: string): number[] {
  return [...processes()].filter(([, p]) => p.exe.toLowerCase() === exe.toLowerCase()).map(([pid]) => pid);
}

/** The process and all its descendants (WebView2's browser and renderer processes for the HUD). */
export function tree(root: number): number[] {
  const all = processes();
  const out = [root];
  for (let i = 0; i < out.length; i++) for (const [pid, p] of all) if (p.ppid === out[i] && !out.includes(pid)) out.push(pid);
  return out.filter((pid) => all.has(pid));
}

/** The largest visible top-level window of a process (spec 4.1). */
export function mainWindow(pid: number): number {
  let best = 0;
  let area = 0;
  for (const h of zOrder()) {
    if (!visible(h) || pidOf(h) !== pid) continue;
    const r = rect(h);
    const a = (r.right - r.left) * (r.bottom - r.top);
    if (a > area) [best, area] = [h, a];
  }
  return best;
}

function withProcess<T>(pid: number, access: number, fn: (h: number) => T): T | null {
  const h = OpenProcess(access, false, pid) as number;
  if (!h) return null;
  try {
    return fn(h);
  } finally {
    CloseHandle(h);
  }
}

/** Private bytes (PrivateUsage of PROCESS_MEMORY_COUNTERS_EX). */
export function privateBytes(pid: number): number | null {
  return withProcess(pid, PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, (h) => {
    const pmc: Record<string, number> = {};
    return K32GetProcessMemoryInfo(h, pmc, 80) ? (pmc.PrivateUsage ?? null) : null;
  });
}

/** Kernel + user CPU time in ms. */
export function cpuMs(pid: number): number | null {
  return withProcess(pid, PROCESS_QUERY_LIMITED_INFORMATION, (h) => {
    const t = Array.from({ length: 4 }, (): FileTime => ({ lo: 0, hi: 0 }));
    if (!GetProcessTimes(h, t[0], t[1], t[2], t[3])) return null;
    const ms = (f: FileTime | undefined): number => (f ? (f.hi * 2 ** 32 + f.lo) / 10_000 : 0);
    return ms(t[2]) + ms(t[3]);
  });
}

/**
 * The process's creation time (GetProcessTimes, 100 ns units), or null when no such process: with the
 * pid, it names one process, since Windows reuses pids.
 */
export function startedAt(pid: number): number | null {
  return withProcess(pid, PROCESS_QUERY_LIMITED_INFORMATION, (h) => {
    const t = Array.from({ length: 4 }, (): FileTime => ({ lo: 0, hi: 0 }));
    return GetProcessTimes(h, t[0], t[1], t[2], t[3]) && t[0] ? t[0].hi * 2 ** 32 + t[0].lo : null;
  });
}

/** Where win.rs puts the Deck over Lightroom's window `lr`, in physical pixels. */
export function deckRect(lr: number): Rect {
  const c: Rect = { left: 0, top: 0, right: 0, bottom: 0 };
  const p = { x: 0, y: 0 };
  GetClientRect(lr, c);
  ClientToScreen(lr, p);
  const scale = (GetDpiForWindow(lr) as number) / 96;
  const top = p.y + c.bottom - Math.round(BAND_H * scale);
  return { left: p.x, top, right: p.x + c.right, bottom: top + Math.round(DECK_H * scale) };
}

export const dpi = (h: number): number => GetDpiForWindow(h) as number;

/** Windows "Animation effects" (SPI_GETCLIENTAREAANIMATION), for the reduced-motion check (spec 8.4). */
export function clientAreaAnimation(): boolean {
  const out = [0];
  SystemParametersInfoW(SPI_GETCLIENTAREAANIMATION, 0, out, 0);
  return (out[0] ?? 0) !== 0;
}

/**
 * 1 ms timer resolution while measuring, so setTimeout polls every few ms: with it, setTimeout(1)
 * took 1.67 ms in Claude Code's check [handle: docs/reports/phase7/S9-prerun/prerun.txt section 8]; the default is coarser [inference].
 */
export const fineTimers = (on: boolean): void => void (on ? timeBeginPeriod(1) : timeEndPeriod(1));
