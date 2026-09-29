// The bridge client's public types and its error (client.ts has the client). Moved out of client.ts
// in PHASE5_PLAN row 3, with endpoint.ts, to take client.ts off the size rule's list.

import type { BridgePorts, PortsChoice } from "./endpoint.js";

export type BridgeState = "stopped" | "connecting" | "handshaking" | "connected";

/** A structured bridge failure ({code, message, recoverable}, PRD NFR-7). */
export class BridgeError extends Error {
  readonly code: string;
  readonly recoverable: boolean;
  readonly command: string | null;

  constructor(code: string, message: string, recoverable: boolean, command: string | null = null) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
    this.recoverable = recoverable;
    this.command = command;
  }
}

export type BridgeClientOptions = {
  host?: string;
  /** The plugin's receive socket: the engine writes commands here. Given, it wins over the ports file. */
  commandPort?: number;
  /** The plugin's send socket: the engine reads responses and events here. Given, it wins over the ports file. */
  eventPort?: number;
  reconnectMs?: number;
  heartbeatMs?: number;
  missedBeats?: number;
  requestTimeoutMs?: number;
  handshakeTimeoutMs?: number;
  connectTimeoutMs?: number;
  /** Pause between connecting the command socket and the event socket. */
  connectGapMs?: number;
  engineVersion?: string;
  /** Returns the plugin's current token, or null if there is none. Default: read defaultTokenPath(). */
  readToken?: () => string | null;
  /**
   * Returns the plugin's ports for the start that wrote `token` (the one just read), or null for
   * 8765/8766. Default: read defaultPortsPath() (endpoint.ts readPortsFile).
   */
  readPorts?: (token: string) => BridgePorts | null;
  log?: (message: string) => void;
};

export type BridgeStats = {
  connects: number;
  /** Connection attempts that failed before the handshake started (e.g. Lightroom not running). */
  connect_failures: number;
  last_connect_error: string | null;
  /** Established or handshaking connections that were lost. */
  drops: number;
  last_drop_reason: string | null;
  malformed_lines: number;
  unknown_response_ids: number;
  /** The ports of the last connection attempt, and where they came from. */
  ports: PortsChoice | null;
};
