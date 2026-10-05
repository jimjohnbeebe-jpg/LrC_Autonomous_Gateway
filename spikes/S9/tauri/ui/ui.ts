// Spike S9: the HUD's UI. It holds the channel client (spec D2, "Contract reuse"): it reads the
// endpoint through the Rust command `endpoint`, connects over WebSocket, sends the token in `hello`,
// validates every message with the zod schemas of ..\..\channel.ts, and draws the collapsed Deck bar
// (adapted from docs\hud\option-c\option-c.html; fidelity is not the goal, the measurements are).
// Showing and hiding go through the Rust commands hud_show / hud_hide (Win32, src-tauri\src\win.rs).
// Each rendered state is reported back as `paint`, timed in the first requestAnimationFrame after
// the render (spec D2, S9-1 to S9-3).
import type { invoke as InvokeFn } from "@tauri-apps/api/core";
import { endpointSchema, serverMessageSchema, TURN_STAGES, type ClientMessage, type HudState } from "../../channel.ts";

declare global {
  interface Window {
    __TAURI__: { core: { invoke: typeof InvokeFn } };
  }
}

const invoke = window.__TAURI__.core.invoke;
const deck = document.getElementById("deck") as HTMLElement;
const now = (): number => performance.timeOrigin + performance.now();
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// Strings used verbatim from plugin\LrC-AVG.lrplugin\HudText.lua (spec 10.1) and spec 10.2.
const HEADLINE = {
  not_connected: "Claude is not connected. Your edit so far stays.",
  awaiting_pick: "Your turn: pick a copy, or tell Claude which one.",
  converged: "Your turn: Claude thinks the edit is done.",
  none_connected: "Not connected to Claude.",
};
const STEP: Record<string, string> = {
  begin: "Starting", pass0: "Setting profile, lens corrections and baseline", applying: "Applying pass",
  acquiring_preview: "Rendering a preview", metrics: "Measuring the preview", awaiting_claude: "Claude is looking at the result",
};
const UNDO = "To undo it: Develop > Snapshots > ";

const GLYPH = {
  // The halo is stepped by the timer at the end of this file (style.css says why).
  working: '<span class="ring"><span class="halo"></span><svg width="16" height="16"><circle cx="8" cy="8" r="4" fill="none" stroke="#9fb7d4" stroke-width="2"/></svg></span>',
  turn: '<svg width="16" height="16"><circle cx="8" cy="8" r="5" fill="#eda447"/></svg>',
  problem: '<svg width="16" height="16"><path d="M8 2.2L14.6 13.6H1.4Z" fill="none" stroke="#ee8064" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6.4v3.4" stroke="#ee8064" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="11.7" r=".95" fill="#ee8064"/></svg>',
};

let ws: WebSocket | null = null;
let connected = false;
let state: HudState | null = null;
let shownSession: string | null = null;
let shown = false;
let lastMessage = 0;

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

function setShown(want: boolean, reason: string): void {
  if (want === shown) return;
  shown = want;
  void invoke(want ? "hud_show" : "hud_hide", { reason });
}

function actions(primary: string | null, abortOff: boolean, acceptText: boolean): string {
  const accept = acceptText ? '<span class="btn textonly">Accept</span>' : "";
  const first = primary ? `<span class="btn primary">${primary}</span>` : accept;
  return `<div class="rcol">${first}<span class="btn abort${abortOff ? " off" : ""}">Abort</span></div>`;
}

function bar(s: HudState): string {
  const file = esc(s.target.filename ?? "");
  if (!connected) {
    const undo = UNDO + esc(s.snapshot ?? "the newest AVG pre-session snapshot");
    return `<div class="glyph">${GLYPH.problem}</div><div class="words"><b>${HEADLINE.not_connected}</b> <span class="fid">${undo}</span></div>`
      + '<div class="cq">Off until Claude is connected.</div>' + actions(null, true, false);
  }
  if (s.stage === "converged") {
    return `<div class="glyph">${GLYPH.turn}</div><div class="words turn15"><b>${HEADLINE.converged}</b> <span class="fid">${file}</span></div>`
      + '<div class="cq u">Accept ends the edit; the sliders stay as they are. Abort puts the pre-session snapshot back.</div>' + actions("Accept", false, false);
  }
  if (s.stage === "awaiting_pick") {
    const copies = s.variants?.length ?? 0;
    return `<div class="glyph">${GLYPH.turn}</div><div class="words turn15"><b>${HEADLINE.awaiting_pick}</b> <span class="fid">${file} · ${copies} copies</span></div>`
      + '<div class="cq u">Abort leaves the master as it was; the copies stay in the catalog.</div>' + actions("Show the copies", false, false);
  }
  const pass = s.pass !== undefined && s.max_passes !== undefined ? ` · pass ${s.pass} of ${s.max_passes}` : "";
  return `<div class="glyph">${GLYPH.working}</div><div class="words"><b>Working</b>${pass} · ${STEP[s.stage] ?? s.stage} · ${file}</div>`
    + '<div class="cq">Abort puts the pre-session snapshot back.</div>' + actions(null, false, true);
}

function render(): void {
  deck.innerHTML = state ? bar(state) : `<div class="words">${HEADLINE.none_connected}</div>`;
}

function send(msg: ClientMessage): void {
  ws?.send(JSON.stringify(msg));
}

function onState(seq: number, next: HudState): void {
  state = next;
  render();
  if (next.session_id !== shownSession) {
    shownSession = next.session_id; // opens by itself once per edit (spec 3.2, decision 6)
    setShown(true, "begin");
  } else if (TURN_STAGES.includes(next.stage)) {
    setShown(true, "turn"); // re-show at a turn: the Q13 proposal, used here to time S9-2
  }
  requestAnimationFrame(() => send({ type: "paint", seq, t: now() }));
}

function onMessage(text: string): void {
  lastMessage = now();
  let parsed;
  try {
    parsed = serverMessageSchema.safeParse(JSON.parse(text));
  } catch {
    parsed = null;
  }
  if (!parsed?.success) return void invoke("hud_log", { line: { bad_message: text.slice(0, 200) } });
  const msg = parsed.data;
  if (msg.type === "state") onState(msg.seq, msg.state);
  else if (msg.type === "ping") send({ type: "pong" });
  else if (msg.type === "spike") setShown(msg.action === "show", "spike");
}

function disconnect(): void {
  ws = null;
  if (connected) {
    connected = false;
    render(); // keeps the last state, with the not-connected headline and the undo line (spec 3.2)
  }
}

/** One attempt at a time: the 2 s timer must not start a second one while the first awaits the endpoint. */
let connecting = false;

async function connect(): Promise<void> {
  if (connecting) return;
  connecting = true;
  try {
    await open();
  } finally {
    connecting = false;
  }
}

async function open(): Promise<void> {
  const ep = (await invoke("endpoint")) as { text: string; pid_alive: boolean; hud_pid: number } | null;
  if (!ep?.pid_alive) return; // no engine, or a stale file (spec 3.3)
  let endpoint;
  try {
    endpoint = endpointSchema.parse(JSON.parse(ep.text));
  } catch {
    return void invoke("hud_log", { line: { bad_endpoint: true } });
  }
  const socket = new WebSocket(`ws://127.0.0.1:${endpoint.port}`);
  ws = socket;
  lastMessage = now(); // a socket that never opens is dropped by the same 6 s rule
  socket.onopen = () => {
    connected = true;
    lastMessage = now();
    send({ type: "hello", token: endpoint.token, hud_version: "s9", pid: ep.hud_pid, reduced_motion: reducedMotion });
  };
  socket.onmessage = (e) => onMessage(String(e.data));
  socket.onclose = () => {
    if (ws === socket) disconnect();
  };
}

// While disconnected, read the endpoint every 2 s (spec 3.3); drop after 3 missed pings (spec 3.7).
setInterval(() => {
  if (!ws) void connect();
  else if (now() - lastMessage > 6000) ws.close();
}, 2000);
// The working ring's pulse: 8 steps per 1.6 s loop (spec 8.4), none under reduced motion.
const HALO = [0.15, 0.26, 0.37, 0.49, 0.6, 0.49, 0.37, 0.26];
let haloStep = 0;
setInterval(() => {
  const halo = deck.querySelector<HTMLElement>(".halo");
  if (!halo || reducedMotion) return;
  haloStep = (haloStep + 1) % HALO.length;
  halo.style.borderColor = `rgba(159, 183, 212, ${HALO[haloStep]})`;
}, 200);
render();
void connect();
