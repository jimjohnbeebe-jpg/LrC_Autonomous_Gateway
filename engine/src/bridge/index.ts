// Entry point of the bridge module (engine <-> Lightroom plugin).

export { BridgeClient, BridgeError, defaultTokenPath } from "./client.js";
export type { BridgeClientOptions, BridgeState, BridgeStats } from "./client.js";
export { DEFAULT_MAX_LINE_CHARS, LineSplitter, LineTooLongError } from "./lines.js";
export { COMMANDS, PROTOCOL_VERSION } from "./protocol.js";
export type { CommandName, CommandPayloads, CommandResult, EventEnvelope, HelloResult } from "./protocol.js";
