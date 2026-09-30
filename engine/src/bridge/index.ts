// Entry point of the bridge module (engine <-> Lightroom plugin).

export { BridgeClient, BridgeError } from "./client.js";
export type { BridgeClientOptions, BridgeState, BridgeStats } from "./client.js";
export { DEFAULT_COMMAND_PORT, DEFAULT_EVENT_PORT, TOKEN_CHECK_CHARS, defaultPortsPath, defaultTokenPath, readPortsFile } from "./endpoint.js";
export type { BridgePorts, PortsChoice } from "./endpoint.js";
export { DEFAULT_MAX_LINE_CHARS, LineSplitter, LineTooLongError } from "./lines.js";
export { COMMANDS, PROTOCOL_VERSION } from "./protocol.js";
export { PLUGIN_VERSION, pluginVersionAtLeast } from "./version.js";
export { HUD_END_STAGES, HUD_EVENTS, HUD_GUARDRAIL, HUD_LIMITS, HUD_STAGES, HUD_VARIANTS, hudEventSchemas, hudUpdatePayloadSchema, hudUpdateResultSchema, parseHudEvent } from "./hud-protocol.js";
export type { HudEvent, HudEventName, HudStage, HudUpdatePayload } from "./hud-protocol.js";
export type { CommandName, CommandPayloads, CommandResult, EventEnvelope, HelloResult, PhotoExpect } from "./protocol.js";
