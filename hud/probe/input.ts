// The mouse for the hidden-Deck input probe (idle.ts, fix/deck-relaunch): move the pointer, press the left
// button, and ask Windows which process's window is under a point. Through koffi 3.3.2, as spike S9's
// spikes\S9\win32.ts; signatures follow the MicrosoftDocs sdk-api pages (SetCursorPos, GetCursorPos,
// mouse_event, WindowFromPoint, GetWindowThreadProcessId, SetProcessDpiAwarenessContext).
import koffi from "koffi";

const user32 = koffi.load("user32.dll");
const POINT = koffi.struct("IDLE_POINT", { x: "int32_t", y: "int32_t" });

const SetCursorPos = user32.func("bool __stdcall SetCursorPos(int x, int y)");
const GetCursorPos = user32.func("bool __stdcall GetCursorPos(_Out_ IDLE_POINT *p)");
const mouseEvent = user32.func("void __stdcall mouse_event(uint32_t flags, uint32_t dx, uint32_t dy, uint32_t data, uintptr_t extra)");
const WindowFromPoint = user32.func("uintptr_t __stdcall WindowFromPoint(IDLE_POINT p)");
const GetWindowThreadProcessId = user32.func("uint32_t __stdcall GetWindowThreadProcessId(uintptr_t h, _Out_ uint32_t *pid)");
const SetProcessDpiAwarenessContext = user32.func("bool __stdcall SetProcessDpiAwarenessContext(intptr_t ctx)");

const MOUSEEVENTF_LEFTDOWN = 0x0002;
const MOUSEEVENTF_LEFTUP = 0x0004;
/** DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2: points are physical pixels, as the Deck's `place` log line. */
const PER_MONITOR_AWARE_V2 = -4;

export type Point = { x: number; y: number };
void POINT;

export function physicalPixels(): boolean {
  return SetProcessDpiAwarenessContext(PER_MONITOR_AWARE_V2) as boolean;
}

export function cursor(): Point {
  const p: Point = { x: 0, y: 0 };
  GetCursorPos(p);
  return p;
}

export const moveTo = (p: Point): boolean => SetCursorPos(p.x, p.y) as boolean;

export function pressLeft(): void {
  mouseEvent(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
  mouseEvent(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
}

/** The process whose window is under `p`, or 0. */
export function pidAt(p: Point): number {
  const h = WindowFromPoint(p) as number;
  if (!h) return 0;
  const out = [0];
  GetWindowThreadProcessId(h, out);
  return out[0] ?? 0;
}
