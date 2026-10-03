// Every failure reaches Claude as { code, message, recoverable } (PRD NFR-7), never as a stack.
// Codes follow MCP_TOOLS where it names one (BRIDGE_DISCONNECTED, NO_ACTIVE_PHOTO, TARGET_CHANGED,
// UNKNOWN_PARAMETER, OUT_OF_RANGE, LEGACY_PROCESS_VERSION, INTENT_NOT_FOUND); the others are the
// engine's own (Phase 2 and 3; NEWER_PROCESS_VERSION and FEATURE_UNAVAILABLE, Phase 6).
// `recoverable` means the same call may work later without changing it (e.g. once Lightroom is back).

import { BridgeError } from "../bridge/index.js";
import { IntentError } from "../intents/index.js";
import { ParamError, UnknownCameraProfileError, lightroomLabel, sdkKeysOf, type ParamMap, type SdkSettings } from "../params/index.js";
import { PreviewError } from "../preview/index.js";

export type ToolErrorBody = { code: string; message: string; recoverable: boolean; details?: unknown };
/** The versions the plugin's hello names (bridge client hello()); null when not connected. */
export type LightroomVersions = { lrc_version?: string; plugin_version?: string } | null | undefined;

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

/**
 * A feature this Lightroom or plugin does not have: the call stops there and says so plainly
 * ("<feature> is not available with Lightroom a.b / plugin x.y; <advice>"). Recoverable: the same
 * call works once the plugin or the engine supports the feature.
 */
export function featureUnavailable(feature: string, lightroom: LightroomVersions, advice: string, extra: Record<string, unknown> = {}): ToolError {
  const lrc = lightroom?.lrc_version;
  const plugin = lightroom?.plugin_version;
  const where = [lrc ? `Lightroom ${lrc}` : "", plugin ? `plugin ${plugin}` : ""].filter(Boolean).join(" / ") || "this Lightroom and plugin";
  return new ToolError("FEATURE_UNAVAILABLE", `${feature} is not available with ${where}; ${advice}`, true, {
    feature,
    ...(lrc ? { lrc_version: lrc } : {}),
    ...(plugin ? { plugin_version: plugin } : {}),
    ...extra,
  });
}

/**
 * The error for a write whose read-back differs, or null when it took as sent (every write is read
 * back, Phase 0 P-12). A key written but missing from the read-back is one this Lightroom does not
 * report: FEATURE_UNAVAILABLE, naming its slider in Lightroom's words, so that a Lightroom that drops
 * a key does not read as a failed write [inference: no Lightroom version that drops one was observed].
 * A key read back with another value is WRITE_NOT_TAKEN, as before. The session write, lr_sync_series
 * and lr_set_settings all check here.
 */
export function readbackError(map: ParamMap, written: SdkSettings, readBack: SdkSettings, historyName: string, lightroom: LightroomVersions, extra: Record<string, unknown> = {}): ToolError | null {
  const mismatches = map.verifyReadback(written, readBack);
  if (mismatches.length === 0) return null;
  const details = { history_name: historyName, mismatches, ...extra };
  if (mismatches.some((m) => m.sdk_key in readBack)) {
    return new ToolError("WRITE_NOT_TAKEN", `Lightroom did not take ${mismatches.map((m) => m.sdk_key).join(", ")} as written in "${historyName}".`, false, details);
  }
  const label = (key: string): string => lightroomLabel(map.names().find((n) => sdkKeysOf(map, n).includes(key)) ?? key);
  const sliders = [...new Set(mismatches.map((m) => label(m.sdk_key)))];
  const it = sliders.length > 1 ? "them" : "it";
  const others = Object.keys(written).length > mismatches.length ? " The step's other values were written." : "";
  return featureUnavailable(sliders.join(", "), lightroom, `Lightroom did not report ${it} back after "${historyName}", so ${it} could not be checked. Leave ${it} out of later steps.${others}`, details);
}

function fromBridge(err: BridgeError, lightroom: LightroomVersions): ToolError {
  switch (err.code) {
    case "unknown_command":
      // A plugin older than this engine [handle: plugin\LrC-AVG.lrplugin\Dispatch.lua:79 answers unknown_command].
      return featureUnavailable(err.command ?? "This command", lightroom, "this LrC-AVG plugin does not know it. Update the plugin, then restart Lightroom so it loads it.");
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

function fromParam(err: ParamError, lightroom: LightroomVersions): ToolError {
  const codes: Record<ParamError["code"], string> = {
    unknown_parameter: "UNKNOWN_PARAMETER",
    wrong_type: "WRONG_TYPE",
    out_of_range: "OUT_OF_RANGE",
    // Only process version 15.4 is mapped (ARCHITECTURE section 5): an older one is refused, a newer
    // one comes with a Lightroom this engine does not know yet (map.ts checkProcessVersion).
    unsupported_process_version: "LEGACY_PROCESS_VERSION",
    newer_process_version: "NEWER_PROCESS_VERSION",
  };
  const pv = err.code === "unsupported_process_version" || err.code === "newer_process_version";
  const running = pv && lightroom?.lrc_version ? ` Lightroom ${lightroom.lrc_version} is running.` : "";
  return new ToolError(codes[err.code], err.message + running, false, err.parameter ? { parameter: err.parameter } : undefined);
}

/** `lightroom`: the plugin's hello, when the caller has it, so that a message can name the versions. */
export function toToolError(err: unknown, lightroom?: LightroomVersions): ToolError {
  if (err instanceof ToolError) return err;
  if (err instanceof BridgeError) return fromBridge(err, lightroom);
  if (err instanceof ParamError) return fromParam(err, lightroom);
  if (err instanceof UnknownCameraProfileError) {
    return new ToolError("UNKNOWN_CAMERA_PROFILE", err.message, false, { profile: err.profile });
  }
  if (err instanceof PreviewError) return new ToolError(err.code, err.message, err.recoverable);
  if (err instanceof IntentError) {
    // INTENT_NOT_FOUND is MCP_TOOLS' code; INVALID_INTENT and INTENT_EXISTS are Phase 3's own.
    const codes: Record<IntentError["code"], string> = { intent_not_found: "INTENT_NOT_FOUND", invalid_intent: "INVALID_INTENT", intent_exists: "INTENT_EXISTS" };
    return new ToolError(codes[err.code], err.message, false, err.problems.length ? { problems: err.problems } : undefined);
  }
  return new ToolError("INTERNAL_ERROR", err instanceof Error ? err.message : String(err), false);
}
