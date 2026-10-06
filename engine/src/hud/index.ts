// Entry point of the HUD module (PHASE5_PLAN row 5): the updates the engine sends the plugin's HUD,
// and the events its buttons and menu items send back.

export { HudEvents } from "./events.js";
export type { HudEventRecord } from "./events.js";
export { aperture, hudGuardrail, hudState, shutter } from "./payload.js";
export type { HudState } from "./payload.js";
export { HUD_PLUGIN, HudPublisher } from "./publisher.js";
export type { HudRecord } from "./publisher.js";
// The Deck (Phase 7 row 3): the HUD channel, the state the Deck gets, and the fan-out to both HUDs.
export { Deck } from "./deck.js";
export type { DeckRecord } from "./deck.js";
export { HudChannel, defaultHudEndpointPath } from "./channel.js";
export * from "./channel-protocol.js";
export { HudLauncher, findHudExe } from "./launch.js";
export type { HudLauncherOptions } from "./launch.js";
export { HudFanOut } from "./sinks.js";
// Row 5: the menu items and the Deck (hud_deck to the plugin, hud_show to the Deck).
export { DeckMenu } from "./deck-menu.js";
export type { DeckMenuRecord } from "./deck-menu.js";
export type { DeckDeps } from "./sinks.js";
