// The version gates (GitHub issue #209). Info.lua declares LrSdkVersion 15.2 and LrSdkMinimumVersion 13.0, so a feature from a
// later Lightroom Classic checks its SDK call first (plugin\LrC-AVG.lrplugin\Needs.lua) and answers feature_unavailable,
// "<feature> needs Lightroom Classic N or later: ...". No Lua runs here (rule 01-stack), so the plugin half is a static check
// that no such call bypasses the gate; the engine half drives each gated tool with a plugin that answers like the gate does.

import path from "node:path";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeError } from "../src/bridge/index.js";
import { IntentLibrary } from "../src/intents/index.js";
import { Tools, toToolError } from "../src/mcp/index.js";
import { VERIFIED_FORMS } from "../src/params/index.js";
import { PreviewService } from "../src/preview/index.js";
import { avgPlugin, codeOnly, luaFiles, pluginRoot } from "./helpers/lua-code.js";
import { ID, clean, client, fails, lr, logDir, map, newManager, plugin, tmp, useSessionHarness, userDir } from "./helpers/session-harness.js";

useSessionHarness();

/** Every SDK call newer than LrSdkMinimumVersion 13.0 the plugin makes: what Needs.check is given, and the release the SDK 15.2 reference names. */
const GATES = [
  { feature: "Computing an AI mask", version: "13.3", prefix: "photo:", object: "photo", names: ["updateAISettings"], file: "Masks.lua" },
  { feature: "AI Denoise", version: "14.5", prefix: "LrDevelopController.", object: "LrDevelopController", names: ["getEnhancePanelState", "setEnhance", "changeDenoiseAmount"], file: "Denoise.lua" },
] as const;
const [AI_MASK, DENOISE] = GATES;

const lua = (file: string): string => readFileSync(path.join(avgPlugin, file), "utf8");
const own = luaFiles(avgPlugin);
/** What Needs.check answers for a Lightroom that lacks `gate`'s first call. */
const refusal = (gate: (typeof GATES)[number]): string => `${gate.feature} needs Lightroom Classic ${gate.version} or later: ${gate.prefix}${gate.names[0]} not found in this Lightroom Classic 13.1`;

describe("plugin: the declared SDK versions", () => {
  it("declares the newest SDK the plugin was written against and keeps 13.0 as the minimum", () => {
    const info = lua("Info.lua");
    expect(info).toMatch(/^\s*LrSdkVersion = 15\.2,/m);
    expect(info).toMatch(/^\s*LrSdkMinimumVersion = 13\.0,/m);
  });
});

describe("plugin: Needs.lua", () => {
  const needs = lua("Needs.lua");
  it("answers feature_unavailable, recoverable, naming the feature, the release, the missing calls and this Lightroom", () => {
    expect(needs).toMatch(/code = "feature_unavailable", recoverable = true,/);
    expect(needs).toMatch(/message = feature \.\. " needs Lightroom Classic " \.\. version \.\. " or later: " \.\. table\.concat\(missing, ", "\)/);
    expect(needs).toMatch(/" not found in this Lightroom Classic " \.\. tostring\(LrApplication\.versionString\(\)\)/);
  });
});

describe("plugin: every call newer than 13.0 goes through Needs.check", () => {
  it.each(GATES.map((g) => [g.file, g]))("%s gives Needs.check the feature, the release and every call it makes", (_file, gate) => {
    const names = gate.names.map((n) => `"${n}"`).join(", ");
    expect(lua(gate.file)).toContain(`Needs.check("${gate.feature}", "${gate.version}", "${gate.prefix}", ${gate.object}, { ${names} })`);
  });

  it("checks photo:updateAISettings before it calls it, and no other file calls it", () => {
    const code = codeOnly(lua(AI_MASK.file));
    const entry = code.indexOf("function Masks.updateAISettings(");
    const check = code.indexOf("Needs.check(", entry);
    const call = code.search(/:updateAISettings\s*\(/);
    expect([entry, check, call].every((i) => i >= 0) && entry < check && check < call).toBe(true);
    const callers = own.filter((f) => /:updateAISettings\b/.test(codeOnly(readFileSync(f, "utf8")))).map((f) => path.basename(f));
    expect(callers).toEqual([AI_MASK.file]);
  });

  it("checks the Enhance calls before Denoise.apply touches Lightroom, makes them nowhere else, and exports only apply", () => {
    const code = codeOnly(lua(DENOISE.file));
    const entry = code.indexOf("function Denoise.apply(");
    const check = code.indexOf("Needs.check(", entry);
    const work = code.indexOf("Catalog.exclusive(", entry);
    expect([entry, check, work].every((i) => i >= 0) && check < work).toBe(true);
    expect([...code.matchAll(/^function Denoise\.(\w+)/gm)].map((m) => m[1])).toEqual(["apply"]);
    const used = new Set([...code.matchAll(/\b(getEnhancePanelState|setEnhance|toggleEnhance|changeDenoiseAmount)\b/g)].map((m) => m[1]));
    expect([...used].sort()).toEqual([...DENOISE.names].sort());
    const callers = own.filter((f) => /\b(getEnhancePanelState|setEnhance|toggleEnhance|changeDenoiseAmount)\b/.test(codeOnly(readFileSync(f, "utf8")))).map((f) => path.basename(f));
    expect(callers).toEqual([DENOISE.file]);
  });

  it("reads and writes the accessibility keys (13.2, issue #218) only after Needs.release, and names them in no other file", () => {
    const code = codeOnly(lua("Metadata.lua"));
    expect(lua("Metadata.lua")).toContain('Needs.release("Accessibility text", 13, 2)');
    const set = code.slice(code.indexOf("function Metadata.setIptc("));
    expect(set.indexOf("accessible()")).toBeGreaterThan(0);
    expect(set.indexOf("accessible()")).toBeLessThan(set.indexOf("Gate.run("));
    const text = code.slice(code.indexOf("local function textOf("));
    expect(text).toMatch(/^local function textOf\(catalog, photo\)\s+local withAccessibility = accessible\(\)[\s\S]*?if withAccessibility then/);
    const callers = own.filter((f) => /altTextAccessibility|extDescrAccessibility/.test(readFileSync(f, "utf8"))).map((f) => path.basename(f));
    expect(callers).toEqual(["Metadata.lua"]);
  });

  it("keeps the mask calls (SDK 11.0, below the minimum) without a gate of their own, probed by MaskProbe.begin only to name a build that lacks one", () => {
    expect(lua("MaskProbe.lua")).toContain('Needs.check("Masking through LrDevelopController", "11.0", "LrDevelopController.", LrDevelopController, { "getAllMasks" })');
  });
});

describe("plugin: deprecated calls", () => {
  // The calls the SDK 15.2 reference marks "Deprecated API" and the hashes it deprecates in 13.5 [handle: D:\Developer\LightRoom Classic Dev Kit\
  // API Reference\modules, grep -i deprecated: LrApplicationView, LrDevelopController, LrPhoto, LrDigest]; the audit of 2026-10-26 found none in the plugins.
  const DEPRECATED = ["zoomInSome", "zoomOutSome", "goToDevelopGraduatedFilter", "goToDevelopRadialFilter", "goToHealing", "goToSpotRemoval", "resetBrushing", "resetCircularGradient", "resetGradient", "resetSpotRemoval", "quickDevelopSetWhiteBalacne"];
  it("uses none of them in any plugin, spikes included", () => {
    for (const file of luaFiles(pluginRoot)) {
      const source = readFileSync(file, "utf8");
      expect(codeOnly(source), path.basename(file)).not.toMatch(new RegExp(`\\b(${DEPRECATED.join("|")})\\b`));
      expect(source, path.basename(file)).not.toMatch(/\bLrDigest\b/);
    }
  });
});

describe("engine: a plugin's feature_unavailable reaches the tool result with its release", () => {
  it("maps it to FEATURE_UNAVAILABLE and passes the plugin's message on", () => {
    const e = toToolError(new BridgeError("feature_unavailable", refusal(DENOISE), true, "apply_denoise"));
    expect([e.code, e.recoverable, e.message]).toEqual(["FEATURE_UNAVAILABLE", true, refusal(DENOISE)]);
  });

  describe("lr_apply_denoise", () => {
    let tools: Tools;
    beforeEach(() => {
      plugin.handlers.set("apply_denoise", () => ({ ok: false, error: { code: "feature_unavailable", message: refusal(DENOISE), recoverable: true } }));
      tools = new Tools({
        client,
        map,
        previews: new PreviewService(client, { previewDir: path.join(tmp, "previews") }),
        intents: new IntentLibrary({ map, userDir }),
        sessionLogDir: logDir,
        engineVersion: "test",
        ensureBridge: () => client.waitConnected(2000).then(() => undefined),
      });
    });

    it("lists the photo as failed with FEATURE_UNAVAILABLE and \"needs Lightroom Classic 14.5 or later\", having changed nothing", async () => {
      const out = await tools.applyDenoise({ uuids: ["A"], amount: 50 });
      expect(out.json["failed"]).toEqual([{ uuid: "A", code: "FEATURE_UNAVAILABLE", message: expect.stringContaining("needs Lightroom Classic 14.5 or later") }]);
      expect(out.json["counts"]).toMatchObject({ applied: 0, failed: 1 });
    });
  });

  describe("AI masks (update_ai_settings)", () => {
    afterEach(() => VERIFIED_FORMS.delete("radial, subtract sky"));
    const pass = { session_id: ID, rationale: "test", return_image: "none" as const };

    it("lr_create_mask: FEATURE_UNAVAILABLE says the release when neither route makes the mask, with nothing left written", async () => {
      clean();
      const m = newManager({ aiTimings: { computeMs: 300, dcWaitMs: 300, pollMs: 10, pollMaxMs: 20 } });
      await m.begin({ intent_id: "test_plain", return_image: "none", max_passes: 4 });
      lr.masks.tableRoute = "unavailable";
      lr.masks.dc = "unknown";
      const e = await fails(m.createMask({ ...pass, kind: "sky" }));
      expect(e).toMatchObject({ code: "FEATURE_UNAVAILABLE", recoverable: true, message: expect.stringContaining("needs Lightroom Classic 13.3 or later") });
      expect(e.details).toMatchObject({ routes_tried: [{ route: "table", why: expect.stringContaining("needs Lightroom Classic 13.3 or later") }, { route: "dc" }] });
    });

    it("lr_edit_mask: an AI part says the release too", async () => {
      clean();
      const m = newManager({ aiTimings: { computeMs: 300, dcWaitMs: 300, pollMs: 10, pollMaxMs: 20 } });
      await m.begin({ intent_id: "test_plain", return_image: "none", max_passes: 8 });
      VERIFIED_FORMS.add("radial, subtract sky");
      const made = await m.createMask({ ...pass, kind: "radial", name: "AVG pool", geometry: { left: 0.2, top: 0.3, right: 0.7, bottom: 0.9 } });
      const id = String((made.json["mask"] as { id: string }).id);
      lr.masks.tableRoute = "unavailable";
      const e = await fails(m.editMask({ ...pass, mask_id: id, combine: { mode: "subtract", kind: "sky" } }));
      expect(e).toMatchObject({ code: "FEATURE_UNAVAILABLE", message: expect.stringContaining("needs Lightroom Classic 13.3 or later") });
    });
  });
});
