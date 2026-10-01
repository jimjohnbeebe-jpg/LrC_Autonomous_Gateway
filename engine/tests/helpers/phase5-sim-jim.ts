// Simulated Jim for the Phase 5 check tests (phase5-harness.ts), acting on the check's words as Jim
// would on the window's:
//   - the Plug-in Manager visit: Lightroom stops answering pings for 1.8 s (Plug-in Manager paused the
//     plugin in Lightroom [handle: vault PHASE5_PLAN.md row 3 "Probe done"]); "set Mode to ..." sets the
//     page's mode, as Jim does in the "Sessions" box;
//   - "click Abort / Approve / Pick / Accept in the HUD" and the menu items: the HUD's event with its
//     "sent" line (phase5-harness.ts click), Approve after 1.1 s ("wait about 10 seconds");
//   - "click <photo> (the original": the photo selected, under that file name;
//   - the copies' removal empties the sim's copies;
//   - "Come back to this window": the chat, held by a second engine standing in for Claude Desktop's,
//     with its own tool log (collectChat reads it) and the settings page: the approve chat (a wait in
//     vain, then Jim's Approve) or a golden-hour session.
// `h.sim` turns each of these off or changes it (phase5-harness.ts SimOptions).

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ChatLogs } from "../../src/devtools/phase2-check.js";
import { MENU } from "../../src/devtools/phase5-config.js";
import { toToolError, type Tools } from "../../src/mcp/index.js";
import { APPROVAL_WAIT_MS, click, dir, h, newClient, newTools, pluginLog } from "./phase5-harness.js";

const later = (ms: number, fn: () => void): void => void setTimeout(fn, ms);
const unless = (skip: string, fn: () => void): void => {
  if (!h.sim.skip.has(skip)) fn();
};

/** What Jim does on a line the check says. */
export function jimSays(line: string): void {
  const chat = /^(The approve chat|Chat \d of 6)/.exec(line);
  if (chat) h.chat = chat[1] as string;
  if (/Now a visit to Plug-in Manager/.test(line) && !h.sim.noPause) {
    h.plugin.answerPings = false;
    later(1800, () => (h.plugin.answerPings = true));
  }
  const mode = /set Mode to "(Approve each pass|Autonomous)"/.exec(line);
  if (mode && !(h.sim.pageUnchanged && mode[1] === "Approve each pass") && h.lr.prefs) h.lr.prefs["mode"] = mode[1] === "Autonomous" ? "autonomous" : "approve_each_pass";
  if (/^ {2}Now click Abort in the HUD\./.test(line)) unless("abort-a", () => later(20, () => click("hud_abort")));
  if (/then click "Approve pass 1" in the HUD/.test(line)) unless("approve", () => later(1100, () => click("hud_approve_pass", { pass: 1 })));
  if (/This time click Abort in the HUD/.test(line)) unless("abort-wait", () => later(50, () => click("hud_abort")));
  if (/"Pick A", "Pick B" and "Pick C" are now on/.test(line)) unless("pick", () => later(20, () => pick()));
  if (/^ {2}Now click Accept in the HUD\./.test(line)) unless("accept-c", () => later(20, () => click("hud_accept")));
  if (line.includes(MENU.accept)) unless("menu-accept", () => later(20, () => click("hud_accept", {}, "menu")));
  if (line.includes(MENU.abort)) unless("menu-abort", () => later(20, () => click("hud_abort", {}, "menu")));
  if (line.includes(MENU.hud)) {
    unless("menu-hud", () =>
      later(20, () => {
        h.lr.hud.shown = true;
        pluginLog("hud: shown");
      }),
    );
  }
}

function pick(): void {
  if (h.sim.tamperOnPick) h.lr.settings["Exposure2012"] = Number(h.lr.settings["Exposure2012"]) + 0.5;
  click("hud_pick", { variant: h.sim.pick });
}

/** What Jim types at a prompt (Enter, mostly), after doing what it asks. */
export async function jimPrompt(text: string): Promise<string | null> {
  const photo = /[Cc]lick (.+?) \(the original/.exec(text);
  if (photo) {
    h.lr.selected = h.lr.uuid;
    h.lr.filename = photo[1] as string;
  }
  if (/5\. Press D to go back|Still in the catalog/.test(text)) h.lr.copies.clear();
  if (/Claude Desktop still holds the bridge/.test(text)) h.busy = false;
  if (/Come back to this window and press Enter/.test(text)) {
    const n = /^Chat (\d)/.exec(h.chat);
    if (n && Number(n[1]) === h.sim.stopAtChat) {
      h.lr.settings["Exposure2012"] = Number(h.lr.settings["Exposure2012"]) + 1; // Claude had edited the photo when the window was closed
      return null;
    }
    await (h.chat === "The approve chat" ? approveChat() : goldenChat());
    if (h.sim.lockBusyAfterChat) h.busy = true;
  }
  return "";
}

/** Claude Desktop's engine for one chat: a second client of the plugin, its tool log in chat-logs. */
async function desktop<T>(fn: (tools: Tools) => Promise<T>): Promise<T> {
  let tools: Tools | null = null;
  const client = newClient(() => (tools?.sessionManager()?.current() ?? null) !== null);
  client.start();
  tools = newTools(client, () => client.waitConnected(2000).then(() => undefined), "desk");
  try {
    return await fn(tools);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 60)); // the HUD's last update
    client.stop();
  }
}

/** AC-1's chat: Claude begins the golden-hour session, makes its passes and accepts. */
function goldenChat(): Promise<void> {
  return desktop(async (tools) => {
    const sid = String((await tools.beginSession({ intent_id: "landscape_golden_hour", return_image: "none" })).json["session_id"]);
    for (let i = 0; i < h.sim.chatPasses; i++) await tools.step({ session_id: sid, settings: { vibrance: 3 }, rationale: "golden hour", return_image: "none" });
    await tools.endSession({ session_id: sid, outcome: "accept" });
  });
}

/** The approve chat: pass 1; pass 2 waits in vain; Jim's Approve; pass 2; pass 3 after Jim's Approve of pass 2; accept. */
function approveChat(): Promise<void> {
  return desktop(async (tools) => {
    const sid = String((await tools.beginSession({ intent_id: "landscape_golden_hour", return_image: "none" })).json["session_id"]);
    const step = () => tools.step({ session_id: sid, settings: { vibrance: 3 }, rationale: "golden hour", return_image: "none" });
    await step();
    try {
      await step();
    } catch (err) {
      if (toToolError(err).code !== "AWAITING_APPROVAL") throw err;
    }
    click("hud_approve_pass", { pass: 1 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await step();
    later(Math.min(100, APPROVAL_WAIT_MS / 2), () => click("hud_approve_pass", { pass: 2 }));
    await step();
    await tools.endSession({ session_id: sid, outcome: "accept" });
  });
}

/** The chat's records from the Desktop engine's tool log, from `since` on. */
export function collectChat(since: Date): ChatLogs & { desktop_errors: string[] } {
  const records = readdirSync(dir("chat-logs"))
    .flatMap((f) => readFileSync(path.join(dir("chat-logs"), f), "utf8").trim().split("\n"))
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((r) => new Date(String(r["ts"])).getTime() >= since.getTime());
  return { desktop_log: { found: true, saved_as: "desktop.txt", lines: 20 }, engine_log: { found: true, saved_as: "chat.jsonl", records }, desktop_errors: [] };
}
