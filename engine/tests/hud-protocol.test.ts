// The HUD's bridge contract (engine\src\bridge\hud-protocol.ts, PHASE5_PLAN row 4): the hud_update
// payload and result schemas, the four HUD events, and both crossing the engine's bridge client
// against the fake plugin. What the plugin's Lua does with the same payloads is in the smoke
// transcript (docs\reports\phase5\hud-plugin-smoke\smoke.txt), since no Lua runs here.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BridgeClient,
  COMMANDS,
  HUD_LIMITS,
  hudEventSchemas,
  hudUpdatePayloadSchema,
  parseHudEvent,
  type EventEnvelope,
  type HudUpdatePayload,
} from "../src/bridge/index.js";
import { FakePlugin, waitUntil } from "./helpers/fake-plugin.js";

const FULL: HudUpdatePayload = {
  session_id: "20260929-abc123",
  seq: 4,
  open: true,
  stage: "awaiting_pick",
  mode: "variants",
  pass: 1,
  max_passes: 4,
  target: { uuid: "CF12AF60-0858-4181-9562-376D16B89126", filename: "20260907-_OZ80099.NEF", copy_name: "AVG 20260929-abc123 A", iso: 400, shutter: "1/250 s", aperture: "f/8", lens: "NIKKOR Z 24-120mm f/4 S", lens_profile: "on" },
  session_photos: ["CF12AF60-0858-4181-9562-376D16B89126", "COPY-A", "COPY-B", "COPY-C"],
  variants: ["A", "B", "C"],
  approve_pass: 2,
  answered_click_id: "CLICK-1",
  deltas: [{ slider: "Exposure", before: "+0.30", after: "+0.55", delta: "+0.25" }, { slider: "Highlights", before: -20, after: -35, delta: -15 }],
  guardrail: { status: "corrected", reason: "Highlight clipping was 0.6 % (limit 0.5 %); corrected." },
  note: "Pick the copy you like best.",
  settings: { mode: "autonomous", max_passes: 4, variant_count: 3, long_edge: 1600, quality: 75, clip_high_pct: 0.5, clip_low_pct: 1, decay: [1, 0.6, 0.4, 0.25] },
  snapshot: "AVG pre-session 2026-09-29T10:00:00.000Z",
  put_back: { photo_uuid: "CF12AF60-0858-4181-9562-376D16B89126", snapshot_id: "08B9CE9B-881C-4272-B595-79FBDAC44981", snapshot_name: "AVG pre-session 2026-09-29T10:00:00.000Z" },
};
const MINIMAL = { session_id: "s1", seq: 1, stage: "begin", target: { uuid: "U1" } };

describe("hud-protocol: hud_update payload", () => {
  it("accepts every field, and the minimal update", () => {
    expect(hudUpdatePayloadSchema.safeParse(FULL).success).toBe(true);
    expect(hudUpdatePayloadSchema.safeParse(MINIMAL).success).toBe(true);
  });

  it.each([
    ["an unknown field", { ...MINIMAL, colour: "red" }],
    ["an unknown field inside the target", { ...MINIMAL, target: { uuid: "U1", camera: "Z8" } }],
    ["an unknown stage", { ...MINIMAL, stage: "rendering" }],
    ["no target", { session_id: "s1", seq: 1, stage: "begin" }],
    ["seq 0", { ...MINIMAL, seq: 0 }],
    ["a fractional seq", { ...MINIMAL, seq: 1.5 }],
    ["an empty session id", { ...MINIMAL, session_id: "" }],
    ["a session id over the byte limit (UTF-8 bytes, as Lua counts)", { ...MINIMAL, session_id: "é".repeat(HUD_LIMITS.id / 2 + 1) }],
    ["a variant letter D", { ...MINIMAL, variants: ["A", "D"] }],
    ["more delta rows than the HUD has", { ...MINIMAL, deltas: Array.from({ length: HUD_LIMITS.rows + 1 }, () => ({ slider: "x" })) }],
    ["a delta row without its slider", { ...MINIMAL, deltas: [{ before: 1 }] }],
    ["an unknown guardrail status", { ...MINIMAL, guardrail: { status: "amber" } }],
    ["open as text", { ...MINIMAL, open: "yes" }],
    ["text given as an object", { ...MINIMAL, note: { text: "x" } }],
    ["a snapshot given as an object (plugin 0.9.0)", { ...MINIMAL, snapshot: { name: "AVG pre-session" } }],
    ["a put_back without its snapshot id (plugin 0.13.0)", { ...MINIMAL, put_back: { photo_uuid: "U1", snapshot_name: "AVG pre-session" } }],
    ["a put_back with an extra field", { ...MINIMAL, put_back: { photo_uuid: "U1", snapshot_id: "S1", snapshot_name: "x", history: "AVG" } }],
    ["a put_back photo uuid over the byte limit", { ...MINIMAL, put_back: { photo_uuid: "x".repeat(HUD_LIMITS.id + 1), snapshot_id: "S1", snapshot_name: "x" } }],
    ["a pass over the limit", { ...MINIMAL, pass: HUD_LIMITS.pass + 1 }],
    ["a settings key the HUD does not show", { ...MINIMAL, settings: { log_dir: "D:\\logs" } }],
  ])("refuses %s", (_what, payload) => {
    expect(hudUpdatePayloadSchema.safeParse(payload).success).toBe(false);
  });

  it("keeps a session id of exactly the byte limit", () => {
    expect(hudUpdatePayloadSchema.safeParse({ ...MINIMAL, session_id: "é".repeat(HUD_LIMITS.id / 2) }).success).toBe(true);
  });
});

describe("hud-protocol: HUD events", () => {
  const base = { session_id: "s1", seq_seen: 3, click_id: "CLICK-1", source: "hud" };
  const evt = (name: string, payload: unknown): EventEnvelope => ({ id: "e1", type: "evt", name, payload });

  it("parses each of the four events", () => {
    expect(parseHudEvent(evt("hud_abort", base))).toEqual({ ok: true, event: { name: "hud_abort", payload: base } });
    expect(parseHudEvent(evt("hud_accept", { ...base, source: "menu" }))).toMatchObject({ ok: true, event: { name: "hud_accept" } });
    expect(parseHudEvent(evt("hud_pick", { ...base, variant: "B" }))).toMatchObject({ ok: true, event: { payload: { variant: "B" } } });
    expect(parseHudEvent(evt("hud_approve_pass", { ...base, pass: 2 }))).toMatchObject({ ok: true, event: { payload: { pass: 2 } } });
  });

  it("returns null for an event that is not the HUD's", () => {
    expect(parseHudEvent(evt("hello", {}))).toBeNull();
  });

  it.each([
    ["a pick without its letter", "hud_pick", base],
    ["an approve without its pass", "hud_approve_pass", base],
    ["an unknown source", "hud_abort", { ...base, source: "hotkey" }],
    ["a missing click id", "hud_accept", { session_id: "s1", seq_seen: 3, source: "hud" }],
    ["an extra field", "hud_abort", { ...base, variant: "A" }],
    ["no payload", "hud_abort", undefined],
  ])("refuses %s and says which event", (_what, name, payload) => {
    const r = parseHudEvent(evt(name, payload));
    expect(r).toMatchObject({ ok: false });
    expect(r && !r.ok ? r.error : "").toContain(name);
  });

  it("has one schema per event name", () => {
    expect(Object.keys(hudEventSchemas).sort()).toEqual(["hud_abort", "hud_accept", "hud_approve_pass", "hud_pick", "hud_put_back"]);
  });
});

describe("hud-protocol: across the bridge", () => {
  let plugin: FakePlugin;
  let client: BridgeClient;
  const FAST = { reconnectMs: 30, heartbeatMs: 40, missedBeats: 3, connectGapMs: 5, handshakeTimeoutMs: 500, requestTimeoutMs: 300 };

  beforeEach(async () => {
    plugin = await FakePlugin.start();
    client = new BridgeClient({ ...FAST, commandPort: plugin.commandPort, eventPort: plugin.eventPort, readToken: () => plugin.token });
    client.start();
    await client.waitConnected(2000);
  });

  afterEach(async () => {
    client.stop();
    await plugin.close();
  });

  it("sends hud_update as given and returns the plugin's validated result", async () => {
    plugin.handlers.set("hud_update", () => ({ ok: true, payload: { applied: true, shown: true, opened: true } }));
    await expect(client.request("hud_update", FULL)).resolves.toEqual({ applied: true, shown: true, opened: true });
    expect(plugin.received.at(-1)).toEqual({ name: "hud_update", payload: FULL });
  });

  it("refuses a result without its flags (COMMANDS.hud_update)", async () => {
    plugin.handlers.set("hud_update", () => ({ ok: true, payload: { applied: true } }));
    await expect(client.request("hud_update", FULL)).rejects.toMatchObject({ code: "bad_response" });
    expect(COMMANDS.hud_update.safeParse({ applied: false, shown: false, opened: false, reason: "update 3 is not newer than 4" }).success).toBe(true);
  });

  it("hands a HUD event from the plugin to onEvent, where parseHudEvent reads it", async () => {
    const seen: EventEnvelope[] = [];
    client.onEvent((e) => seen.push(e));
    const payload = { session_id: "s1", seq_seen: 7, click_id: "CLICK-9", source: "hud", variant: "C" };
    plugin.send({ id: "evt-1", type: "evt", name: "hud_pick", ts: new Date().toISOString(), payload });
    await waitUntil(() => seen.length > 0);
    expect(parseHudEvent(seen[0] as EventEnvelope)).toEqual({ ok: true, event: { name: "hud_pick", payload } });
  });
});
