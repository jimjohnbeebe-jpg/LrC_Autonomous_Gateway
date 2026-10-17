import { describe, expect, it } from "vitest";
import { prefsListInstalled } from "../src/devtools/cleanroom-scan.js";

// The shape of Jim's "Lightroom Classic CC 7 Preferences.agprefs" after Plug-in Manager > Remove (2026-10-17):
// the path stays under disabledPluginPaths, the installed list is empty.
const list = (paths: string[]): string => `"t = {\\\n${paths.map((p) => `\t[\\"${p}\\"] = true,\\\n`).join("")}}\\\n",`;
const dev = "D:\\\\\\\\Developer\\\\\\\\LrC_Autonomous_Gateway\\\\\\\\plugin\\\\\\\\LrC-AVG.lrplugin";
const other = "D:\\\\\\\\Developer\\\\\\\\other.lrplugin";
const prefs = (installed: string[], disabled: string[]): string =>
  `prefs = {\n\tAgSdkPluginLoader_disabledPluginPaths = ${list(disabled)}\n\tAgSdkPluginLoader_installedPluginPaths = ${list(installed)}\n}\n`;

describe("prefsListInstalled", () => {
  it("is false after Remove, when only the disabled list names the plugin", () => {
    expect(prefsListInstalled(prefs([], [other, dev]))).toBe(false);
  });

  it("is true while the installed list names the plugin", () => {
    expect(prefsListInstalled(prefs([other, dev], []))).toBe(true);
  });

  it("is true when another checkout's path is the disabled one", () => {
    const old = "C:\\\\old\\\\plugin\\\\LrC-AVG.lrplugin";
    expect(prefsListInstalled(prefs([dev], [old]))).toBe(true);
  });

  it("is false when Disable put the path or the ID in a disabled list", () => {
    expect(prefsListInstalled(prefs([dev], [dev]))).toBe(false);
    const byId = prefs([dev], []).replace("prefs = {\n", `prefs = {\n\tAgSdkPluginLoader_disabledPluginIDs = "t = {\\\n\t[\\"com.lrcavg.gateway.dev\\"] = true,\\\n}\\\n",\n`);
    expect(prefsListInstalled(byId)).toBe(false);
  });

  it("ignores the product's ID in the disabled list", () => {
    const product = prefs([dev], []).replace("prefs = {\n", `prefs = {\n\tAgSdkPluginLoader_disabledPluginIDs = "t = {\\\n\t[\\"com.lrcavg.gateway\\"] = true,\\\n}\\\n",\n`);
    expect(prefsListInstalled(product)).toBe(true);
  });

  it("is false without the installed key", () => {
    expect(prefsListInstalled('prefs = {\n\tx = "LrC-AVG.lrplugin",\n}\n')).toBe(false);
  });
});
