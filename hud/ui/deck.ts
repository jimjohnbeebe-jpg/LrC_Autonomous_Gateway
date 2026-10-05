// The Deck's UI (Phase 7 row 4b; spec docs\hud\lrc-avg-hud-spec-v2.md 2.7, 3.3, 3.7). It holds the
// channel client (spec D2, "Contract reuse"): it reads the endpoint through the Rust command `endpoint`,
// connects over WebSocket, sends the token in `hello`, validates every message with the engine's own zod
// schemas (engine\src\hud\channel-protocol.ts, built into ui-dist by hud\build-ui.ts), answers pings and
// drops a silent engine after 6 s. Showing, hiding, opening and placing go through Rust commands
// (src-tauri\src\window.rs). Row 4c draws the Deck's states, copy cards and keyboard and sends clicks;
// this row's bar shows a plain line of text, so the window rules can be checked first.
import type { invoke as InvokeFn } from "@tauri-apps/api/core";
import type { getCurrentWindow as GetCurrentWindowFn } from "@tauri-apps/api/window";
import { engineMessageSchema, hudEndpointSchema, type HudChannelState } from "../../engine/src/hud/channel-protocol.ts";
import { HIDDEN, onState, onTick, onUserHide, type Change } from "./visibility.ts";

declare global {
  interface Window {
    __TAURI__: { core: { invoke: typeof InvokeFn }; window: { getCurrentWindow: typeof GetCurrentWindowFn } };
  }
}

const invoke = window.__TAURI__.core.invoke;
const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

// Strings used verbatim from plugin\LrC-AVG.lrplugin\HudText.lua (spec 10.1).
const HEADLINE = {
  not_connected: "Claude is not connected. Your edit so far stays.",
  gone: "This edit is no longer open in Claude. Your edit so far stays.",
  working: "Claude is working. Nothing needed from you.",
  awaiting_pick: "Your turn: pick a copy, or tell Claude which one.",
  converged: "Your turn: Claude thinks the edit is done.",
  target_changed: "Your turn: select the edit's photo again.",
  accepted: "Done: the edit is kept.",
  aborted: "Done: the photo is back as it was.",
  ended: "The edit has ended.",
} as const;
const CONNECTION_NONE = "Not connected to Claude.";
const UNDO = "To undo it: Develop > Snapshots > ";
const UNDO_NO_SNAPSHOT = "the newest AVG pre-session snapshot";
const STEP: Record<string, string> = {
  begin: "Starting", pass0: "Setting profile, lens corrections and baseline", applying: "Applying pass",
  acquiring_preview: "Rendering a preview", metrics: "Measuring the preview", awaiting_claude: "Claude is looking at the result",
  awaiting_pick: "Waiting for your pick", awaiting_approval: "Waiting for your approval", converged: "Claude thinks the edit is done",
  target_changed: "Another photo is selected", accepted: "Accepted", aborted: "Aborted", ended: "Ended",
};

let ws: WebSocket | null = null;
let connected = false;
/** The engine's welcome named another edit (or none) than the one shown (spec 3.7 "gone"). */
let gone = false;
let state: HudChannelState | null = null;
let lastMessage = 0;
let vis = HIDDEN;
let open = false;

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

function apply(change: Change, reason: string): void {
  if (change === "show") void invoke("deck_show", { reason });
  else if (change === "hide") void invoke("deck_hide", { reason });
}

function headline(s: HudChannelState): string {
  if (gone) return HEADLINE.gone;
  if (!connected) return HEADLINE.not_connected;
  if (s.stage in HEADLINE) return HEADLINE[s.stage as keyof typeof HEADLINE];
  if (s.stage === "awaiting_approval" && s.approve_pass !== undefined) return `Your turn: approve pass ${s.approve_pass} so Claude can go on.`;
  return HEADLINE.working;
}

function render(): void {
  if (!state) {
    $("words").innerHTML = `<b>${CONNECTION_NONE}</b>`;
    $("more").textContent = "";
    return;
  }
  const s = state;
  const lost = gone || !connected;
  const pass = s.pass !== undefined && s.max_passes !== undefined ? ` · pass ${s.pass} of ${s.max_passes}` : "";
  const detail = lost ? UNDO + (s.snapshot ?? UNDO_NO_SNAPSHOT) : `${STEP[s.stage] ?? s.stage}${pass} · ${s.target.filename ?? ""}`;
  $("words").innerHTML = `<b>${esc(headline(s))}</b> <span class="fid">${esc(detail)}</span>`;
  const sel = s.selection;
  $("more").textContent = sel ? `Selected in Lightroom: ${sel.name ?? "nothing"}${sel.in_edit ? " (in this edit)" : ""}` : "";
}

function onEngineState(next: HudChannelState): void {
  state = next;
  gone = false;
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
  if (!parsed?.success) return void invoke("deck_log", { line: { bad_message: text.slice(0, 200) } });
  const msg = parsed.data;
  if (msg.type === "ping") ws?.send(JSON.stringify({ type: "pong" }));
  else if (msg.type === "state") onEngineState(msg.state);
  else if (msg.type === "welcome") {
    connected = true;
    gone = state !== null && msg.session_id !== state.session_id && !["accepted", "aborted", "ended"].includes(state.stage);
    void invoke("deck_log", { line: { welcome: msg.session_id, engine_version: msg.engine_version, gone } });
    render();
  }
  // `answer` and `thumb` are row 4c's.
}

function disconnect(): void {
  ws = null;
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
      return void invoke("deck_log", { line: { bad_endpoint: true } });
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

$("hide").addEventListener("click", () => {
  const [v, change] = onUserHide(vis);
  vis = v;
  apply(change, "user");
});
$("toggle").addEventListener("click", () => {
  open = !open;
  $("toggle").textContent = open ? "Close" : "Open";
  $("toggle").setAttribute("aria-expanded", String(open));
  void invoke("deck_set_open", { open });
});
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
// The end-of-edit hide (rule 5).
setInterval(() => {
  const [v, change] = onTick(vis, Date.now());
  vis = v;
  apply(change, "edit_end");
}, 500);
render();
void connect();
