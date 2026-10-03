// Entry point of the HUD module (PHASE5_PLAN row 5): the updates the engine sends the plugin's HUD,
// and the events its buttons and menu items send back.

export { HudEvents } from "./events.js";
export type { HudEventRecord } from "./events.js";
export { aperture, hudGuardrail, hudState, shutter } from "./payload.js";
export type { HudState } from "./payload.js";
export { HUD_PLUGIN, HudPublisher } from "./publisher.js";
export type { HudRecord } from "./publisher.js";
