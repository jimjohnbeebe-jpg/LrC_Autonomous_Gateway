// The masks capture's two commands in the Lightroom sim (plugin 0.11.0, plugin\LrC-AVG.lrplugin\Masks.lua).
// The sim has no masks and no Develop module: update_ai_settings finds the photo by uuid and answers
// at once; probe_masks_dc refuses another selected photo than target_uuid's (as Develop.lua target()
// does), else answers with one failed step, the way Masks.lua records a call that raised.
// Only the answers' shapes are the plugin's; nothing here is a claim about Lightroom.

import type { FakePlugin, FakeReply } from "./fake-plugin.js";
import { findPhoto, type CatalogSim } from "./lightroom-sim-catalog.js";

const fail = (code: string, message: string, recoverable: boolean): FakeReply => ({ ok: false, error: { code, message, recoverable } });

export function installMasks(sim: CatalogSim, plugin: FakePlugin): void {
  plugin.handlers.set("update_ai_settings", (p): FakeReply => {
    const uuid = findPhoto(sim, p);
    return typeof uuid === "string" ? { ok: true, payload: { uuid, call_ms: 1, command_ms: 2 } } : uuid;
  });
  plugin.handlers.set("probe_masks_dc", (p): FakeReply => {
    const target = p["target_uuid"];
    if (typeof target !== "string" || target === "") return fail("bad_request", "target_uuid must be a non-empty string", false);
    if (sim.selected === "") return fail("no_target_photo", "No photo is selected in Lightroom", true);
    if (sim.selected !== target) return fail("target_mismatch", `The selected photo (${sim.selected}) is not the target (${target})`, true);
    return { ok: true, payload: { uuid: sim.selected, steps: [{ step: "switchToModule_develop", ok: false, error: "the sim has no Develop module", ms: 0 }] } };
  });
}
