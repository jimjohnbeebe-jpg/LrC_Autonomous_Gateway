// The intent library (src/intents/): the bundled starter set, the user folder, validation, saving,
// the intent tools, and the generated JSON Schema (src/devtools/schemas.ts).

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BridgeClient } from "../src/bridge/index.js";
import { generatedSchemas, schemasDir } from "../src/devtools/schemas.js";
import { IntentError, IntentLibrary, bundledIntentsDir, defaultUserIntentsDir } from "../src/intents/index.js";
import { Tools, type ToolOutput } from "../src/mcp/index.js";
import { loadDefaultParamMap } from "../src/params/index.js";
import type { PreviewService } from "../src/preview/index.js";

const map = loadDefaultParamMap();
/** The starter set of PRD section 6.9. */
const STARTERS = [
  "bw_conversion",
  "landscape_blue_hour",
  "landscape_forest_shade",
  "landscape_golden_hour",
  "landscape_midday_high_contrast",
  "landscape_overcast_flat",
  "neutral_technical_correction",
  "night_astro",
  "pet_fur_detail",
  "portrait_natural_light",
  "portrait_skin_priority",
];

const minimal = (id: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  schema_version: 2,
  id,
  label: "Test",
  category: "test",
  brief: "A test intent.",
  priors: {},
  ...extra,
});

let tmp: string;
let userDir: string;
let library: IntentLibrary;

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-intents-"));
  userDir = path.join(tmp, "user");
  library = new IntentLibrary({ map, userDir });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const writeUser = (file: string, content: unknown): void => {
  mkdirSync(userDir, { recursive: true });
  writeFileSync(path.join(userDir, file), typeof content === "string" ? content : JSON.stringify(content), "utf8");
};

describe("intents: the bundled starter set", () => {
  it("loads the eleven starters of PRD 6.9 from engine\\intents, all valid", () => {
    const { intents, warnings } = library.list();
    expect(warnings).toEqual([]);
    expect(intents.map((i) => i.id).sort()).toEqual(STARTERS);
    expect(intents.every((i) => i.source === "bundled")).toBe(true);
    expect(bundledIntentsDir()).toBe(path.resolve(import.meta.dirname, "..", "intents"));
  });

  it("gives every starter a profile per pipeline, lens corrections and A/B/C variants or none at all", () => {
    for (const id of STARTERS) {
      const { intent } = library.get(id);
      expect(intent.profile?.rendered, id).toBe(id === "bw_conversion" ? "Monochrome" : "Color");
      expect(intent.schema_version, id).toBe(2);
      expect(intent.priors["lens.profile_enable"], id).toBe(1);
      if (intent.variants) expect(Object.keys(intent.variants).sort(), id).toEqual(["A", "B", "C"]);
    }
  });

  it("uses the user folder from LRC_AVG_INTENTS_DIR, else %LOCALAPPDATA%\\LrC-AVG\\intents", () => {
    expect(defaultUserIntentsDir({ LRC_AVG_INTENTS_DIR: "D:\\x" })).toBe("D:\\x");
    expect(defaultUserIntentsDir({ LOCALAPPDATA: "C:\\L" })).toBe(path.join("C:\\L", "LrC-AVG", "intents"));
  });
});

describe("intents: the user folder", () => {
  it("lets a user intent with the same id replace the bundled one", () => {
    writeUser("landscape_golden_hour.json", minimal("landscape_golden_hour", { label: "Mine" }));
    const found = library.get("landscape_golden_hour");
    expect(found).toMatchObject({ source: "user", overrides_bundled: true, intent: { label: "Mine" } });
    expect(library.list().intents).toHaveLength(11);
  });

  it("adds a user intent with a new id", () => {
    writeUser("my_look.json", minimal("my_look"));
    expect(library.list().intents.map((i) => i.id)).toContain("my_look");
    expect(library.get("my_look")).toMatchObject({ source: "user", overrides_bundled: false });
  });

  it("skips invalid files with a warning each and keeps the rest", () => {
    writeUser("broken.json", "{ not json");
    writeUser("shape.json", { ...minimal("shape"), prior: {} }); // unknown field (misspelt)
    writeUser("unknown_param.json", minimal("unknown_param", { priors: { exposur: 0.3 } }));
    writeUser("offset.json", minimal("offset", { priors_by_pipeline: { raw: { temperature: 60000 } } }));
    writeUser("switch.json", minimal("switch", { priors: { "lens.profile_enable": 2 } }));
    writeUser("profile_in_priors.json", minimal("profile_in_priors", { priors: { camera_profile: "Adobe Color" } }));
    writeUser("bad_profile.json", minimal("bad_profile", { profile: { raw: "Adobe Imaginary", rendered: "Color" } }));
    writeUser("wrong_name.json", minimal("other_name"));
    writeUser("variant.json", minimal("variant", { variants: { A: { label: "a", priors: {} }, B: { label: "b", priors: {} } } }));
    writeUser("fine.json", minimal("fine"));
    const { intents, warnings } = library.list();
    expect(intents.map((i) => i.id)).toContain("fine");
    const byFile = new Map(warnings.map((w) => [w.file, w.problem]));
    expect([...byFile.keys()].sort()).toEqual(
      ["bad_profile.json", "broken.json", "offset.json", "profile_in_priors.json", "shape.json", "switch.json", "unknown_param.json", "variant.json", "wrong_name.json"],
    );
    expect(byFile.get("broken.json")).toMatch(/not valid JSON/);
    expect(byFile.get("shape.json")).toMatch(/prior/);
    expect(byFile.get("unknown_param.json")).toMatch(/Unknown parameter "exposur"/);
    expect(byFile.get("offset.json")).toMatch(/larger than the whole range/);
    expect(byFile.get("switch.json")).toMatch(/0 or 1/);
    expect(byFile.get("profile_in_priors.json")).toMatch(/in profile, not in priors/);
    expect(byFile.get("bad_profile.json")).toMatch(/Adobe Imaginary/);
    expect(byFile.get("wrong_name.json")).toMatch(/other_name\.json/);
    expect(byFile.get("variant.json")).toMatch(/variants\.C/);
    expect(warnings.every((w) => w.source === "user")).toBe(true);
  });

  it("accepts a numeric prior as an offset within the parameter's range", () => {
    writeUser("warm.json", minimal("warm", { priors: { exposure: -0.5 }, priors_by_pipeline: { raw: { temperature: 300 }, rendered: { temperature: 10 } } }));
    expect(library.get("warm").intent).toMatchObject({ priors: { exposure: -0.5 }, priors_by_pipeline: { raw: { temperature: 300 }, rendered: { temperature: 10 } } });
  });

  it("checks schema v2 per pipeline: the version, white balance per pipeline in its own unit, each profile on its pipeline, colour sliders under a monochrome one", () => {
    const { schema_version: _, ...v1 } = minimal("v1", { default_camera_profile: "Adobe Color" });
    writeUser("v1.json", v1);
    writeUser("v3.json", minimal("v3", { schema_version: 3 }));
    writeUser("wb_shared.json", minimal("wb_shared", { priors: { tint: 5 } }));
    writeUser("wb_rendered.json", minimal("wb_rendered", { priors_by_pipeline: { rendered: { temperature: 300 } } }));
    writeUser("twice.json", minimal("twice", { priors: { exposure: 0.1 }, priors_by_pipeline: { raw: { exposure: 0.2 } } }));
    writeUser("swapped.json", minimal("swapped", { profile: { raw: "Color", rendered: "Adobe Color" } }));
    writeUser("half.json", minimal("half", { profile: { raw: "Adobe Color" } }));
    writeUser("mono.json", minimal("mono", { profile: { raw: "Adobe Color", rendered: "Monochrome" }, priors: { vibrance: 5 } }));
    writeUser("mono_variant.json", minimal("mono_variant", {
      profile: { raw: "Camera Monochrome", rendered: "Monochrome" },
      variants: { A: { label: "a", priors: {} }, B: { label: "b", priors: {} }, C: { label: "c", priors: {}, priors_by_pipeline: { raw: { "hsl.red.sat": 10 } } } },
    }));
    writeUser("variant_wb.json", minimal("variant_wb", {
      variants: { A: { label: "a", priors: {} }, B: { label: "b", priors: { temperature: 100 } }, C: { label: "c", priors: {}, priors_by_pipeline: { rendered: { tint: 5 } } } },
    }));
    const byFile = new Map(library.list().warnings.map((w) => [w.file, w.problem]));
    expect(byFile.get("v1.json")).toMatch(/schema v1 intent.*"profile": {"raw"/);
    expect(byFile.get("v3.json")).toMatch(/schema_version: 3 is not supported/);
    expect(byFile.get("wb_shared.json")).toMatch(/priors.tint: tint goes in priors_by_pipeline.*kelvin on raw, relative on rendered/);
    expect(byFile.get("wb_rendered.json")).toMatch(/priors_by_pipeline.rendered.temperature: an offset of 300 is larger than the whole range -100..100 on the rendered pipeline/);
    expect(byFile.get("twice.json")).toMatch(/priors_by_pipeline.raw.exposure: exposure is also in priors/);
    expect(byFile.get("swapped.json")).toMatch(/profile.raw: "Color" is a rendered-pipeline profile.*profile.rendered: "Adobe Color" is a raw-pipeline profile/);
    expect(byFile.get("half.json")).toMatch(/profile.rendered/);
    expect(byFile.get("mono.json")).toMatch(/priors.vibrance: the rendered profile "Monochrome" is monochrome/);
    expect(byFile.get("mono.json")).not.toMatch(/the raw profile/);
    expect(byFile.get("mono_variant.json")).toMatch(/variants.C.priors_by_pipeline.raw.hsl.red.sat: the raw profile "Camera Monochrome" is monochrome/);
    expect(byFile.get("variant_wb.json")).toMatch(/variants.B.priors.temperature: temperature goes in priors_by_pipeline/);
    expect(byFile.get("variant_wb.json")).not.toMatch(/variants.C/);
  });

  it("says why an intent it skipped cannot be found", () => {
    writeUser("skipped.json", minimal("skipped", { priors: { exposur: 1 } }));
    expect(() => library.get("skipped")).toThrow(/exists but was skipped/);
    try {
      library.get("nothing_here");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(IntentError);
      expect((err as IntentError).code).toBe("intent_not_found");
    }
  });
});

describe("intents: saving", () => {
  it("writes <id>.json into the user folder, creating it", () => {
    expect(existsSync(userDir)).toBe(false);
    const saved = library.save(minimal("saved_one"));
    expect(saved).toEqual({ path: path.join(userDir, "saved_one.json"), replaced: false, overrides_bundled: false });
    expect(JSON.parse(readFileSync(saved.path, "utf8"))).toMatchObject({ id: "saved_one" });
    expect(library.get("saved_one").source).toBe("user");
  });

  it("refuses to replace a user intent unless asked, and says when it overrides a bundled one", () => {
    library.save(minimal("saved_two"));
    expect(() => library.save(minimal("saved_two", { label: "New" }))).toThrow(/replace: true/);
    expect(library.save(minimal("saved_two", { label: "New" }), { replace: true }).replaced).toBe(true);
    expect(library.get("saved_two").intent.label).toBe("New");
    expect(library.save(minimal("bw_conversion")).overrides_bundled).toBe(true);
  });

  it("keeps a user file the loader skipped: it is replaced only with replace: true (Greptile, PR #22)", () => {
    writeUser("kept.json", "{ the user's half-finished edit");
    expect(() => library.save(minimal("kept"))).toThrow(/already exists/);
    expect(readFileSync(path.join(userDir, "kept.json"), "utf8")).toBe("{ the user's half-finished edit");
    expect(library.save(minimal("kept"), { replace: true }).replaced).toBe(true);
    expect(library.get("kept").source).toBe("user");
  });

  it("reports overriding a bundled intent only when the bundled file is a valid intent (Greptile, PR #22)", () => {
    const bundledDir = path.join(tmp, "bundled");
    mkdirSync(bundledDir);
    writeFileSync(path.join(bundledDir, "broken_bundled.json"), "{ not json", "utf8");
    writeFileSync(path.join(bundledDir, "good_bundled.json"), JSON.stringify(minimal("good_bundled")), "utf8");
    const lib = new IntentLibrary({ map, bundledDir, userDir });
    expect(lib.save(minimal("broken_bundled")).overrides_bundled).toBe(false);
    expect(lib.get("broken_bundled").overrides_bundled).toBe(false);
    expect(lib.save(minimal("good_bundled")).overrides_bundled).toBe(true);
    expect(lib.get("good_bundled").overrides_bundled).toBe(true);
  });

  it("writes nothing when the intent is invalid", () => {
    expect(() => library.save(minimal("bad", { priors: { exposure: 99 } }))).toThrow(IntentError);
    expect(existsSync(path.join(userDir, "bad.json"))).toBe(false);
  });
});

describe("intents: tools", () => {
  // The intent tools never touch the bridge, the previews or the bridge gate's call count.
  let gateCalls = 0;
  const tools = (): Tools =>
    new Tools({
      client: { hello: () => null } as unknown as BridgeClient, // a failed call's error names the versions from hello()
      map,
      previews: {} as PreviewService,
      intents: library,
      ensureBridge: () => Promise.reject(new Error("the intent tools must not need Lightroom")),
      onCallStart: () => gateCalls++,
      onCallEnd: () => gateCalls++,
    });

  it("leaves the bridge gate alone, so intent calls do not hold a bridge lock open (Greptile, PR #22)", async () => {
    gateCalls = 0;
    const t = tools();
    await t.listIntents();
    await t.getIntent({ id: "bw_conversion" });
    await t.saveIntent({ intent: minimal("gate_check"), confirmed: true });
    expect(gateCalls).toBe(0);
  });
  const fails = async (p: Promise<ToolOutput>): Promise<{ code: string; details?: unknown }> => {
    try {
      await p;
    } catch (err) {
      return err as { code: string; details?: unknown };
    }
    throw new Error("expected the call to fail");
  };

  it("lists, gets and saves through the tools", async () => {
    const t = tools();
    const listed = (await t.listIntents()).json as { intents: unknown[]; folders: { user: string } };
    expect(listed.intents).toHaveLength(11);
    expect(listed.folders.user).toBe(userDir);
    expect((await t.getIntent({ id: "night_astro" })).json).toMatchObject({ source: "bundled", intent: { guardrail_overrides: { clip_low_pct: 5 } } });
    expect((await t.saveIntent({ intent: minimal("from_chat"), confirmed: true })).json).toMatchObject({ ok: true, id: "from_chat", replaced: false });
  });

  it("maps failures to INTENT_NOT_FOUND, INVALID_INTENT (with the problems), INTENT_EXISTS and NOT_CONFIRMED", async () => {
    const t = tools();
    expect((await fails(t.getIntent({ id: "nope" }))).code).toBe("INTENT_NOT_FOUND");
    const invalid = await fails(t.saveIntent({ intent: minimal("bad_one", { priors: { exposur: 1 } }), confirmed: true }));
    expect(invalid.code).toBe("INVALID_INTENT");
    expect(invalid.details).toEqual({ problems: [expect.stringMatching(/exposur/)] });
    await t.saveIntent({ intent: minimal("twice"), confirmed: true });
    expect((await fails(t.saveIntent({ intent: minimal("twice"), confirmed: true }))).code).toBe("INTENT_EXISTS");
    expect((await fails(t.saveIntent({ intent: minimal("unconfirmed"), confirmed: false }))).code).toBe("NOT_CONFIRMED");
  });
});

describe("schemas", () => {
  it("checks in engine\\schemas\\*.schema.json exactly as generated from the zod schemas (npm run schemas)", () => {
    for (const [name, text] of generatedSchemas()) {
      const file = path.join(schemasDir(), name);
      expect(readFileSync(file, "utf8").replace(/\r\n/g, "\n"), `${name} is stale: run npm run schemas`).toBe(text);
    }
  });

  it("describes the bundled intents: each one validates against the published schema's required fields", () => {
    const schema = JSON.parse(generatedSchemas().get("intent.schema.json") as string) as { required: string[]; additionalProperties: boolean };
    expect(schema.required.sort()).toEqual(["brief", "category", "id", "label", "priors", "schema_version"]);
    expect(schema.additionalProperties).toBe(false);
  });
});
