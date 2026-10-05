// The HUD channel's messages (Phase 7 row 3; spec docs\hud\lrc-avg-hud-spec-v2.md 3.3, D5 E1-E4, E6,
// E7, E10): what the engine (hud\channel.ts, hud\deck.ts) and the Deck (Phase 7 row 4) send each other.
// The Deck's UI validates with these same schemas, so this file imports only zod and
// bridge\hud-protocol.ts, and counts bytes with TextEncoder (spec 2.7 "From S9": `TextEncoder` in the
// shared schemas).
//
// Transport: WebSocket on 127.0.0.1, one JSON message per frame, in place of 3.3's newline-delimited
// TCP: a WebView page cannot open a raw TCP socket [inference] [stated: Jim, 2026-10-04, "Use
// recommendations for websocket"; vault AVG-014]. The endpoint file, handshake and message names are 3.3's.
//
// The state is the Lua HUD's update (hudUpdatePayloadSchema) without `open` and `seq`, plus the fields
// only the Deck gets. Left out while their D5 items are deferred (spec 2.7, vault PHASE7_PLAN
// "Deferred"): `whole_edit` (E5) and `history_prefix` (E9). The "Target changed" sentence is the Deck's
// to build from `selection` and `session_photos` (row 3 decision 3, Jim's go 2026-10-05).

import { z } from "zod";
import { HUD_EVENTS, HUD_LIMITS, HUD_VARIANTS, hudUpdatePayloadSchema, utf8Bytes } from "../bridge/hud-protocol.js";

/** connected; waiting: the plugin missed a beat inside an allowed silence (E10); down: no bridge. */
export const LIGHTROOM_STATES = ["connected", "waiting", "down"] as const;
export type LightroomState = (typeof LIGHTROOM_STATES)[number];
/** The HUD events the Deck may send: every one but hud_put_back (deckMessageSchema). */
export const DECK_EVENTS = HUD_EVENTS.filter((e) => e !== "hud_put_back") as ["hud_abort", "hud_accept", "hud_pick", "hud_approve_pass"];

/** At most HUD_LIMITS.text bytes; the engine cuts its own text to fit (hud\extras.ts fit). */
const text = z.string().refine((s) => utf8Bytes(s) <= HUD_LIMITS.text, `at most ${HUD_LIMITS.text} bytes`);
const id = z.string().min(1).refine((s) => utf8Bytes(s) <= HUD_LIMITS.id, `at most ${HUD_LIMITS.id} bytes`);
const int = (min: number, max: number) => z.number().int().min(min).max(max);
/** A value as the row shows it: a number, or text for profiles, switches ("on"/"off") and curves ("curve"). */
const value = z.union([z.number(), text]);

/** One copy in Variants mode (E3), with its thumbnail's key when it has a render (E4, hud\thumbs.ts). */
export const deckCopySchema = z.strictObject({
  letter: z.enum(HUD_VARIANTS),
  /** The intent's label for the copy ("natural"). */
  label: text.optional(),
  copy_name: text.optional(),
  uuid: id,
  pass: int(0, HUD_LIMITS.pass),
  thumb: id.optional(),
  guardrail: hudUpdatePayloadSchema.shape.guardrail,
});

/** One changed slider of the target's last pass (E6): `deltas` with its canonical name, panel group, range and weight. */
export const deckRowSchema = z.strictObject({
  name: text,
  label: text,
  group: text,
  before: value.optional(),
  after: value,
  delta: z.number().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  /** |delta| / the slider's full scale, capped at 1 (spec 7 "Weights"); 1 for a non-numeric change. */
  weight: z.number().min(0).max(1),
});

/** The photo selected in Lightroom (E7): null uuid when none is selected; in_edit when it is one of `session_photos`. */
export const deckSelectionSchema = z.strictObject({ uuid: id.nullable(), name: text.nullable(), in_edit: z.boolean() });

export const hudChannelStateSchema = hudUpdatePayloadSchema.omit({ open: true, seq: true }).extend({
  lightroom: z.enum(LIGHTROOM_STATES),
  copies: z.array(deckCopySchema).max(HUD_VARIANTS.length).optional(),
  picked: z.enum(HUD_VARIANTS).nullable().optional(),
  rows: z.array(deckRowSchema).max(HUD_LIMITS.rows).optional(),
  selection: deckSelectionSchema.optional(),
});
export type HudChannelState = z.infer<typeof hudChannelStateSchema>;
export type DeckRow = z.infer<typeof deckRowSchema>;
export type DeckCopy = z.infer<typeof deckCopySchema>;
export type DeckSelection = z.infer<typeof deckSelectionSchema>;

/** `%USERPROFILE%\.lrc-avg\hud_endpoint.json`, written by the engine that holds the bridge lock (E1). */
export const hudEndpointSchema = z.strictObject({
  port: z.number().int().min(1).max(65535),
  token: z.string().regex(/^[0-9a-f]{64}$/),
  pid: z.number().int().min(1),
  engine_version: z.string(),
  written_at: z.string(),
});
export type HudEndpoint = z.infer<typeof hudEndpointSchema>;

export const engineMessageSchema = z.discriminatedUnion("type", [
  /** The answer to a valid hello; `session_id` is the open edit's, or null. */
  z.strictObject({ type: z.literal("welcome"), engine_version: z.string(), session_id: id.nullable(), lightroom: z.enum(LIGHTROOM_STATES) }),
  /** The whole state, every time; `seq` rises by 1 within an edit. */
  z.strictObject({ type: z.literal("state"), seq: z.number().int().min(1), state: hudChannelStateSchema }),
  /** The answer to a click, sent at once; it is folded into the next state too. */
  z.strictObject({ type: z.literal("answer"), click_id: id, note: z.string() }),
  /** The reply to get_thumb: a JPEG, or null when the key names no current thumbnail (a newer pass replaced it). */
  z.strictObject({ type: z.literal("thumb"), key: id, jpeg_b64: z.string().nullable() }),
  z.strictObject({ type: z.literal("ping") }),
]);
export type EngineMessage = z.infer<typeof engineMessageSchema>;

export const deckMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("hello"), token: z.string(), hud_version: z.string(), pid: z.number().int().min(1) }),
  /**
   * A click: `payload` is checked as the bridge's event of that name (hudEventSchemas). Not
   * `hud_put_back`: Put back is the plugin's own action, which it reports after it applied the snapshot
   * (spec D5, "Put back"); the Deck cannot press it, so a Deck's report would record a put-back that
   * never happened (Greptile, PR #85).
   */
  z.strictObject({ type: z.literal("event"), name: z.enum(DECK_EVENTS), payload: z.unknown() }),
  z.strictObject({ type: z.literal("get_thumb"), key: id }),
  z.strictObject({ type: z.literal("pong") }),
]);
export type DeckMessage = z.infer<typeof deckMessageSchema>;
