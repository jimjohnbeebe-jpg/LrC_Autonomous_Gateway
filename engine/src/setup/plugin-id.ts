// The repo's plugin is the development copy, added in Plug-in Manager from plugin\LrC-AVG.lrplugin; the
// setup ships the same files under the product's ID and name. Lightroom keeps its enabled/disabled
// state by plugin ID, so a dev copy that is disabled or removed must not share the ID of the installed
// one: with one shared ID, the installed plugin came up disabled in Jim's run 1 [handle: Jim, 2026-10-17,
// "When viewed in Plugin Manager it showed as disabled"; AgSdkPluginLoader_disabledPluginIDs in his
// "Lightroom Classic CC 7 Preferences.agprefs" holds IDs, e.g. com.macphun.exportLuminarNeoPlugin].

export const DEV_ID = "com.lrcavg.gateway.dev";
export const PRODUCT_ID = "com.lrcavg.gateway";
export const DEV_NAME = "LrC-AVG (dev)";
export const PRODUCT_NAME = "LrC-AVG (Autonomous Vision Gateway)";

/** Info.lua text with the dev ID and name turned into the product's; throws unless each occurs exactly once. */
export function productInfoLua(text: string): string {
  const swap = (s: string, from: string, to: string): string => {
    const parts = s.split(from);
    if (parts.length !== 2) throw new Error(`Info.lua: expected ${from} exactly once, found ${parts.length - 1}`);
    return parts.join(to);
  };
  return swap(swap(text, `LrToolkitIdentifier = '${DEV_ID}'`, `LrToolkitIdentifier = '${PRODUCT_ID}'`), `LrPluginName = "${DEV_NAME}"`, `LrPluginName = "${PRODUCT_NAME}"`);
}
