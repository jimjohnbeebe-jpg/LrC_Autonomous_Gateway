// SCRATCH: put 20260907-_OZ80099.NEF back after the Phase 4 check (Jim's approval, 2026-09-28:
// "Claude Code does it"): apply session A's pre-session snapshot by photo_uuid, read back, compare
// with the photo's settings before the check (from the check's results file). Takes the engine's
// instance lock, so Claude Desktop must not be using LrC-AVG. Usage: node putback-m.mjs <results.json>
import { readFileSync } from "node:fs";
const E = "file:///D:/Developer/LrC_Autonomous_Gateway/engine/dist/";
const { BridgeClient } = await import(E + "bridge/index.js");
const { acquireInstanceLock, ENGINE_VERSION } = await import(E + "mcp/index.js");
const { loadDefaultParamMap, differingSettings } = await import(E + "params/index.js");

const results = JSON.parse(readFileSync(process.argv[2], "utf8"));
const uuid = results.photo.uuid;
const start = results.photo.start_settings;
const SNAPSHOT_ID = "3943F429-F18A-4254-99B5-9D0649E2E113"; // "AVG pre-session 2026-09-28T04:20:17.408Z" (session A)
const lock = await acquireInstanceLock();
if (!lock.ok) {
  console.log(`BUSY: another engine holds the bridge (pid ${lock.pid ?? "?"}). Quit Claude Desktop and run again.`);
  process.exit(2);
}
const client = new BridgeClient({ engineVersion: ENGINE_VERSION, log: () => {} });
client.start();
try {
  const hello = await client.waitConnected(20000);
  console.log(`connected: plugin ${hello.plugin_version}`);
  const map = loadDefaultParamMap();
  const ctx = await client.request("get_context", { photo_uuid: uuid });
  console.log(`photo: ${ctx.filename}, virtual copy: ${ctx.is_virtual_copy}`);
  if (ctx.filename !== "20260907-_OZ80099.NEF" || ctx.is_virtual_copy === true) throw new Error("not the original photo; nothing written");
  const before = map.fromSdk((await client.request("get_settings", { photo_uuid: uuid })).settings).settings;
  console.log(`before: differing from the start: ${differingSettings(before, start).join(", ") || "(none)"}`);
  if (process.argv[3] !== "--apply") {
    console.log("read-only run: nothing written (add --apply to put the photo back)");
  } else {
    const back = await client.request("apply_snapshot", { photo_uuid: uuid, snapshot_id: SNAPSHOT_ID }, { timeoutMs: 30000 });
    const after = differingSettings(map.fromSdk(back.read_back).settings, start);
    console.log(`after apply_snapshot: differing from the start: ${after.join(", ") || "(none)"}`);
    console.log(after.length === 0 ? "PUT BACK: YES" : "PUT BACK: NO");
  }
} finally {
  client.stop();
  await lock.lock.release();
}
