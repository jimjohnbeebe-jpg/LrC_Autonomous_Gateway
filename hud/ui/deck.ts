// The Deck's UI (Phase 7 rows 4b-4c; spec docs\hud\lrc-avg-hud-spec-v2.md 2.7, 3.3, 3.7, 4.6, 5, 6). It
// holds the channel client (spec D2, "Contract reuse"): it reads the endpoint through the Rust command
// `endpoint`, connects over WebSocket, sends the token in `hello`, validates every message with the
// engine's own zod schemas (engine\src\hud\channel-protocol.ts, built into ui-dist by hud\build-ui.ts),
// answers pings and drops a silent engine after 6 s. Row 4c: it draws the state (view.ts, render.ts),
// sends clicks as `event`, a chosen copy as `show` (E12), asks for thumbnails, and takes keys only while
// it has the keyboard (keys.ts). After a pointer action it hands the keyboard back to Lightroom
// (Option C docs\hud\option-c\NOTES.md section 3, "Focus"). Showing, hiding, opening and placing go
// through Rust commands (src-tauri\src\window.rs).
import type { invoke as InvokeFn } from "@tauri-apps/api/core";
import type { getCurrentWindow as GetCurrentWindowFn } from "@tauri-apps/api/window";
import { engineMessageSchema, hudEndpointSchema, type HudChannelState } from "../../engine/src/hud/channel-protocol.ts";
import * as C from "./clicks.ts";
import { command, keyCtx, type Command } from "./keys.ts";
import { startPulse } from "./glyphs.ts";
import { html } from "./render.ts";
import { approveLabel, LABEL, pickLabel } from "./text.ts";
import { primary, view, type ActionId, type View } from "./view.ts";
import { HIDDEN, onReveal, onState, onTick, onUserHide, type Change } from "./visibility.ts";

declare global {
  interface Window {
    __TAURI__: { core: { invoke: typeof InvokeFn }; window: { getCurrentWindow: typeof GetCurrentWindowFn } };
  }
}

const invoke = window.__TAURI__.core.invoke;
const host = document.getElementById("deck-host") as HTMLElement;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let ws: WebSocket | null = null;
let connected = false;
/** The engine's welcome named another edit (or none) than the one shown (spec 3.7 "gone"). */
let gone = false;
let state: HudChannelState | null = null;
let seq = 0;
let lastMessage = 0;
let vis = HIDDEN;
let open = true;
let local: C.Local = C.FRESH;
/** Each pass's guardrail mark seen while connected (spec D4 "Gap 2"; lost on a restart). */
let marks: Record<number, string> = {};
const thumbs = new Map<string, string>();
const asked = new Set<string>();
let current: View | null = null;

const log = (line: Record<string, unknown>): void => void invoke("deck_log", { line });
const send = (msg: unknown): void => ws?.send(JSON.stringify(msg));
const lightroom = (why: string): void => void invoke("deck_focus_lightroom", { why });

function apply(change: Change, reason: string): void {
  if (change === "show") void invoke("deck_show", { reason, open });
  else if (change === "hide") void invoke("deck_hide", { reason });
}

function render(): void {
  const now = Date.now();
  current = state ? view(state, local, { connected, gone, focus: document.hasFocus(), open, now, marks }) : null;
  const active = document.activeElement as HTMLElement | null;
  const focusKey = active?.dataset["act"] ?? (active?.dataset["card"] ? `card:${active.dataset["card"]}` : null);
  host.innerHTML = html(current, { open, armed: C.armed(local, now), twoColumns: window.innerWidth >= 1460, thumbs });
  if (focusKey) {
    const sel = focusKey.startsWith("card:") ? `[data-card="${focusKey.slice(5)}"]` : `[data-act="${focusKey}"]`;
    host.querySelector<HTMLElement>(sel)?.focus();
  }
}

function setOpen(o: boolean): void {
  open = o;
  void invoke("deck_set_open", { open });
  render();
}

const EVENTS: Partial<Record<ActionId, string>> = { approve: "hud_approve_pass", accept: "hud_accept", abort: "hud_abort", continue: "hud_pick" };

/** Sends a click: spec 3.3's `event` with the bridge event's fields (hud-protocol.ts hudEventSchemas). */
function click(id: ActionId): void {
  const s = state;
  if (!s || !ws || !connected) return;
  const extra = id === "approve" ? { pass: s.approve_pass } : id === "continue" ? { variant: local.chosen } : {};
  const name = EVENTS[id];
  if (name === undefined) return;
  const label = id === "approve" ? approveLabel(s.approve_pass ?? 0) : id === "continue" ? pickLabel(local.chosen ?? "") : id === "accept" ? LABEL.accept : LABEL.abort;
  const cid = C.clickId();
  const at = Date.now(); // row 6: the click's time before the send, for the click-to-userAction budget (spec 9)
  send({ type: "event", name, payload: { session_id: s.session_id, seq_seen: seq, click_id: cid, source: "hud", ...extra } });
  local = C.sent(local, cid, label, at);
  log({ click: name, click_id: cid, at, ...extra });
  render();
}

function chooseCard(letter: C.Letter): void {
  if (!state) return;
  local = C.choose(local, letter);
  send({ type: "show", session_id: state.session_id, variant: letter });
  log({ choose: letter });
  render();
}

function act(id: string, pointer: boolean): void {
  if (id === "toggle") setOpen(!open);
  else if (id === "hide") userHide();
  else if (id === "show_copies") setOpen(true);
  else click(id as ActionId);
  if (pointer) lightroom(`pointer_${id}`);
}

function userHide(): void {
  const [v, change] = onUserHide(vis);
  vis = v;
  apply(change, "user");
}

/** What a control does: its data-act, or "card:X". The DOM is redrawn often, so controls are matched by this, not by identity. */
function keyOf(target: EventTarget | null): string | null {
  const el = (target as HTMLElement | null)?.closest<HTMLElement>("[data-act],[data-card]");
  if (!el || (el as HTMLButtonElement).disabled) return null;
  return el.dataset["card"] ? `card:${el.dataset["card"]}` : (el.dataset["act"] ?? null);
}

function activate(k: string, pointer: boolean): void {
  if (k.startsWith("card:")) {
    chooseCard(k.slice(5) as C.Letter);
    if (pointer) lightroom("pointer_card");
  } else act(k, pointer);
}

// A pointer press is the same control under mouse-down and mouse-up: a state that redrew the Deck in
// between would make the browser drop the click event.
let downKey: string | null = null;
host.addEventListener("pointerdown", (e) => {
  downKey = e.button === 0 ? keyOf(e.target) : null;
});
host.addEventListener("pointerup", (e) => {
  const k = keyOf(e.target);
  if (e.button === 0 && k !== null && k === downKey) activate(k, true);
  downKey = null;
});
// Space on a focused control (the keyboard's press; Enter is keys.ts's).
host.addEventListener("click", (e) => {
  const k = e.detail === 0 ? keyOf(e.target) : null;
  if (k !== null) activate(k, false);
});

function run(cmd: Command): void {
  const now = Date.now();
  if (cmd.do === "primary" && current) {
    const p = primary(current, C.armed(local, now));
    if (p) act(p.id, false);
  } else if (cmd.do === "arm") local = C.arm(local, now);
  else if (cmd.do === "abort") click("abort");
  else if (cmd.do === "disarm") local = C.disarm(local);
  else if (cmd.do === "hide") userHide();
  else if (cmd.do === "collapse") setOpen(false);
  else if (cmd.do === "lightroom") lightroom("esc");
  else if (cmd.do === "choose") chooseCard(cmd.letter);
  else if (cmd.do === "card") {
    const cards = [...host.querySelectorAll<HTMLElement>("[data-card]:not([disabled])")];
    const i = cards.indexOf(document.activeElement as HTMLElement);
    cards[(i + cmd.step + cards.length) % cards.length]?.focus();
  }
  render();
}

window.addEventListener("keydown", (e) => {
  const cmd = current ? command({ key: e.key, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey }, keyCtx(current, C.armed(local, Date.now()), open)) : null;
  if (!cmd) return;
  e.preventDefault();
  run(cmd);
});
window.addEventListener("resize", render);
const keyboard = (): void => void document.body.classList.toggle("kbd", document.hasFocus());
window.addEventListener("focus", keyboard);
window.addEventListener("blur", keyboard);

function onEngineState(next: HudChannelState, nextSeq: number): void {
  if (next.session_id !== state?.session_id) {
    marks = {};
    thumbs.clear();
    asked.clear();
    open = true; // every edit starts opened [stated: Jim, 2026-10-05, "Opened by default"]
  }
  state = next;
  seq = nextSeq;
  gone = false;
  local = C.onState(local, next);
  // A pass's mark, once it is done: while a pass runs, `guardrail` is still the previous pass's.
  const running = ["begin", "pass0", "applying"].includes(next.stage);
  if (next.mode !== "variants" && next.pass !== undefined && next.guardrail && !running) marks = { ...marks, [next.pass]: next.guardrail.status };
  for (const c of next.copies ?? []) {
    if (c.thumb && !thumbs.has(c.thumb) && !asked.has(c.thumb) && ws?.readyState === WebSocket.OPEN) {
      asked.add(c.thumb);
      send({ type: "get_thumb", key: c.thumb });
    }
  }
  const [v, change] = onState(vis, next, Date.now());
  vis = v;
  apply(change, "edit_start");
  render();
}

function onMessage(text: string): void {
  lastMessage = Date.now();
  let parsed;
  try {
    parsed = engineMessageSchema.safeParse(JSON.parse(text));
  } catch {
    parsed = null;
  }
  if (!parsed?.success) return log({ bad_message: text.slice(0, 200) });
  const msg = parsed.data;
  if (msg.type === "ping") send({ type: "pong" });
  else if (msg.type === "state") {
    // Row 6 (phase7:check, spec 9): receipt and first frame after it, in JS time, as S9's `paint` (spikes\S9\tauri\ui\ui.ts).
    log({ got: msg.seq, session: msg.state.session_id, stage: msg.state.stage, in_edit: msg.state.selection?.in_edit ?? null, at: Date.now() });
    onEngineState(msg.state, msg.seq);
    requestAnimationFrame(() => log({ painted: msg.seq, at: Date.now() }));
  } else if (msg.type === "answer") {
    local = C.onAnswer(local, msg.click_id);
    log({ answer: msg.click_id });
    render();
  } else if (msg.type === "thumb") {
    if (msg.jpeg_b64) thumbs.set(msg.key, `data:image/jpeg;base64,${msg.jpeg_b64}`);
    else thumbs.delete(msg.key);
    render();
  } else if (msg.type === "reveal") {
    // Row 5 (Q4): the menu's "Show Vision Gateway HUD". Shown opened, without the keyboard (window.rs show; S9-6, docs\reports\phase7\S9.md).
    const [v, change] = onReveal(vis, msg.session_id, state?.session_id === msg.session_id ? state.close_after : undefined, Date.now());
    vis = v;
    if (change) open = true;
    log({ reveal: msg.session_id, shown: change !== null });
    apply(change, "menu");
    render();
  } else if (msg.type === "welcome") {
    connected = true;
    gone = state !== null && msg.session_id !== state.session_id && !["accepted", "aborted", "ended"].includes(state.stage);
    log({ welcome: msg.session_id, engine_version: msg.engine_version, gone });
    render();
  }
}

function disconnect(): void {
  ws = null;
  asked.clear(); // a thumbnail asked for and not answered is asked again after the reconnect
  if (connected) {
    connected = false;
    render(); // keeps the last state, with the not-connected headline and the undo line (spec 3.2)
  }
}

type Endpoint = { text: string; pid_alive: boolean; hud_pid: number; hud_version: string };

/** One attempt at a time: the 2 s timer must not start a second one while the first awaits the endpoint. */
let connecting = false;

async function connect(): Promise<void> {
  if (connecting) return;
  connecting = true;
  try {
    const ep = (await invoke("endpoint")) as Endpoint | null;
    if (!ep?.pid_alive) return; // no engine, or a stale file (spec 3.3)
    let endpoint;
    try {
      endpoint = hudEndpointSchema.parse(JSON.parse(ep.text));
    } catch {
      return log({ bad_endpoint: true });
    }
    const socket = new WebSocket(`ws://127.0.0.1:${endpoint.port}`);
    ws = socket;
    lastMessage = Date.now(); // a socket that never opens is dropped by the same 6 s rule
    socket.onopen = () => socket.send(JSON.stringify({ type: "hello", token: endpoint.token, hud_version: ep.hud_version, pid: ep.hud_pid }));
    socket.onmessage = (e) => onMessage(String(e.data));
    socket.onclose = () => {
      if (ws === socket) disconnect();
    };
  } finally {
    connecting = false;
  }
}

for (const grip of document.querySelectorAll<HTMLElement>("[data-resize]")) {
  grip.addEventListener("mousedown", (e) => {
    if (e.button === 0) void window.__TAURI__.window.getCurrentWindow().startResizeDragging(grip.dataset["resize"] as "East" | "West");
  });
}

// While disconnected, read the endpoint every 2 s (spec 3.3); drop after 3 missed pings (spec 3.7).
setInterval(() => {
  if (!ws) void connect();
  else if (Date.now() - lastMessage > 6000) ws.close();
}, 2000);
// The end-of-edit hide (rule 5), the click and Abort timeouts (clicks.ts).
setInterval(() => {
  const now = Date.now();
  const [v, change] = onTick(vis, now);
  vis = v;
  apply(change, "edit_end");
  const next = C.tick(local, now);
  if (next !== local) {
    local = next;
    render();
  }
}, 500);
startPulse(host, reducedMotion);
keyboard();
render();
void connect();
