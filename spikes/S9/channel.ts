// Spike S9: the HUD channel's messages (spec 3.3), shared by stub-engine.ts (Node) and the HUD's UI
// (tauri\ui\ui.ts, copied by build-ui.ts). One file for both sides is the spike's stand-in for the
// contract reuse of spec D2: the UI validates what the engine sends with the same zod schemas.
//
// Transport: WebSocket on 127.0.0.1, one JSON message per frame, in place of 3.3's newline-delimited
// TCP: a WebView page cannot open a raw TCP socket [inference] [stated: Jim, 2026-10-04, "Use
// recommendations for websocket"]. The endpoint file, handshake and message names are 3.3's.
// The `state` body is a subset of hudUpdatePayloadSchema (engine\src\bridge\hud-protocol.ts): what the
// collapsed Deck shows. `spike` (engine -> HUD) and `paint` (HUD -> engine) exist only in S9.
import { z } from "zod";

export const STAGES = [
  "begin", "pass0", "applying", "acquiring_preview", "metrics", "awaiting_claude", "awaiting_pick",
  "awaiting_approval", "converged", "target_changed", "accepted", "aborted", "ended",
] as const;
/** Stages where the photographer has the turn: the HUD shows itself if hidden (spec 3.2, Q13 proposal). */
export const TURN_STAGES: readonly string[] = ["awaiting_pick", "awaiting_approval", "converged", "target_changed"];

export const endpointSchema = z.strictObject({
  port: z.number().int().min(1).max(65535),
  token: z.string().regex(/^[0-9a-f]{64}$/),
  pid: z.number().int().min(1),
  engine_version: z.string(),
  written_at: z.string(),
});
export type Endpoint = z.infer<typeof endpointSchema>;

export const stateSchema = z.strictObject({
  session_id: z.string().min(1).max(64),
  stage: z.enum(STAGES),
  mode: z.enum(["converge", "variants"]).optional(),
  pass: z.number().int().min(0).max(99).optional(),
  max_passes: z.number().int().min(1).max(99).optional(),
  target: z.strictObject({ uuid: z.string().min(1).max(64), filename: z.string().max(120).optional() }),
  variants: z.array(z.enum(["A", "B", "C"])).max(3).optional(),
  snapshot: z.string().max(120).optional(),
  note: z.string().max(120).optional(),
});
export type HudState = z.infer<typeof stateSchema>;

export const serverMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("welcome"),
    engine_version: z.string(),
    session_id: z.string().nullable(),
    lightroom: z.enum(["connected", "waiting", "down"]),
  }),
  z.strictObject({ type: z.literal("state"), seq: z.number().int().min(1), state: stateSchema }),
  z.strictObject({ type: z.literal("ping") }),
  z.strictObject({ type: z.literal("spike"), action: z.enum(["show", "hide"]) }),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("hello"),
    token: z.string(),
    hud_version: z.string(),
    pid: z.number().int().min(1),
    reduced_motion: z.boolean(),
  }),
  z.strictObject({ type: z.literal("pong") }),
  /** The HUD rendered state `seq`; `t` is epoch ms taken in the first requestAnimationFrame after it. */
  z.strictObject({ type: z.literal("paint"), seq: z.number().int().min(1), t: z.number() }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;
