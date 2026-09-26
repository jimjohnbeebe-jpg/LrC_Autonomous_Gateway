// Entry point of the mcp module (the server's entry is main.ts).

export { BridgeGate } from "./bridge-gate.js";
export { ToolError, toToolError } from "./errors.js";
export type { ToolErrorBody } from "./errors.js";
export { acquireInstanceLock, defaultLockFile } from "./instance-lock.js";
export type { InstanceLock, LockResult } from "./instance-lock.js";
export { createServer } from "./server.js";
export { DEFAULT_LONG_EDGE, MAX_LONG_EDGE, MIN_LONG_EDGE, PREVIEW_QUALITY, Tools } from "./tools.js";
export type { LastRender, SetSettingsArgs, ToolOutput, ToolsDeps } from "./tools.js";
export { ENGINE_VERSION } from "./version.js";
