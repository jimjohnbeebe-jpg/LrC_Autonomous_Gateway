// Every failure reaches Claude as { code, message, recoverable } (PRD NFR-7), never as a stack.
// Codes follow MCP_TOOLS where it names one (BRIDGE_DISCONNECTED, NO_ACTIVE_PHOTO, TARGET_CHANGED,
// UNKNOWN_PARAMETER, OUT_OF_RANGE, LEGACY_PROCESS_VERSION); the others are Phase 2's own.
// `recoverable` means the same call may work later without changing it (e.g. once Lightroom is back).

import { BridgeError } from "../bridge/index.js";
import { ParamError, UnknownCameraProfileError } from "../params/index.js";
import { PreviewError } from "../preview/index.js";

export type ToolErrorBody = { code: string; message: string; recoverable: boolean; details?: unknown };

export class ToolError extends Error {
  readonly code: string;
  readonly recoverable: boolean;
  readonly details: unknown;

  constructor(code: string, message: string, recoverable: boolean, details?: unknown) {
    super(message);
    this.name = "ToolError";
    this.code = code;
    this.recoverable = recoverable;
    this.details = details;
  }

  body(): ToolErrorBody {
    return {
      code: this.code,
      message: this.message,
      recoverable: this.recoverable,
      ...(this.details !== undefined ? { details: this.details } : {}),
    };
  }
}

const NOT_CONNECTED = "Lightroom is not connected. Lightroom Classic must be open with the LrC-AVG plugin enabled (File > Plug-in Manager).";

function fromBridge(err: BridgeError): ToolError {
  switch (err.code) {
    case "not_connected":
    case "disconnected":
    case "stopped":
    case "unauthorized":
      return new ToolError("BRIDGE_DISCONNECTED", `${NOT_CONNECTED} (${err.message})`, true);
    case "timeout":
      return new ToolError("BRIDGE_TIMEOUT", `Lightroom did not answer in time: ${err.message}`, true);
    case "no_target_photo":
      return new ToolError("NO_ACTIVE_PHOTO", "No photo is selected in Lightroom. Select one photo and try again.", true);
    case "target_mismatch":
      return new ToolError(
        "TARGET_CHANGED",
        `The photo selected in Lightroom is not the one this call names: ${err.message}. Call lr_get_active_photo_context or lr_get_preview again to see the selected photo.`,
        false,
      );
    case "bad_response":
      return new ToolError("BRIDGE_PROTOCOL", err.message, false);
    default:
      return new ToolError(err.code.toUpperCase(), err.message, err.recoverable);
  }
}

function fromParam(err: ParamError): ToolError {
  const codes: Record<ParamError["code"], string> = {
    unknown_parameter: "UNKNOWN_PARAMETER",
    wrong_type: "WRONG_TYPE",
    out_of_range: "OUT_OF_RANGE",
    // Only process version 15.4 is mapped; on LrC 15.5.1 any other is an older one (ARCHITECTURE section 5).
    unsupported_process_version: "LEGACY_PROCESS_VERSION",
  };
  return new ToolError(codes[err.code], err.message, false, err.parameter ? { parameter: err.parameter } : undefined);
}

export function toToolError(err: unknown): ToolError {
  if (err instanceof ToolError) return err;
  if (err instanceof BridgeError) return fromBridge(err);
  if (err instanceof ParamError) return fromParam(err);
  if (err instanceof UnknownCameraProfileError) {
    return new ToolError("UNKNOWN_CAMERA_PROFILE", err.message, false, { profile: err.profile });
  }
  if (err instanceof PreviewError) return new ToolError(err.code, err.message, err.recoverable);
  return new ToolError("INTERNAL_ERROR", err instanceof Error ? err.message : String(err), false);
}
