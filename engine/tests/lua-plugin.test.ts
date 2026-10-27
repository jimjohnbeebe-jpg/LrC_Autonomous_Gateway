// Static checks on the Lua plugins, since no Lua runtime runs in CI (rule 01-stack: Lightroom embeds
// Lua 5.1, so no goto, no //, no utf8 library). luaparse parses each file as Lua 5.1.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import luaparse from "luaparse";
import { describe, expect, it } from "vitest";
import { COMMANDS, HUD_END_STAGES, HUD_EVENTS, HUD_GUARDRAIL, HUD_LIMITS, HUD_STAGES, HUD_VARIANTS, PLUGIN_VERSION, hudUpdatePayloadSchema } from "../src/bridge/index.js";
import { KEYWORD_SEPARATOR, MAX_COLLECTION_PHOTOS, MAX_PAGE } from "../src/library/index.js";
import { aiWatch } from "../src/params/index.js";
import { DECAY_MAX_VALUES, LOCK_PORT, PAGE_SPECS } from "../src/settings/index.js";
import { avgPlugin, codeOnly, luaFiles, pluginRoot } from "./helpers/lua-code.js";

const files = luaFiles(pluginRoot);

describe("lua: every plugin file", () => {
  it("finds the LrC-AVG plugin files", () => {
    const names = files.filter((f) => f.startsWith(avgPlugin)).map((f) => path.basename(f)).sort();
    expect(names).toEqual([
      "Bridge.lua", "Catalog.lua", "Denoise.lua", "Develop.lua", "Dispatch.lua", "Endpoint.lua", "Events.lua", "Gate.lua", "Hud.lua", "HudClick.lua", "HudSelection.lua", "HudState.lua", "HudText.lua", "HudView.lua",
      "Info.lua", "Json.lua", "KeywordTree.lua", "Library.lua", "Log.lua", "MaskProbe.lua", "Masks.lua", "MenuAbort.lua", "MenuAccept.lua", "MenuApprove.lua", "MenuHud.lua",
      "MenuPickA.lua", "MenuPickB.lua", "MenuPickC.lua", "MenuStatus.lua", "Metadata.lua", "Needs.lua", "Pending.lua", "Photos.lua",
      "PluginDisable.lua", "PluginEnable.lua", "PluginInfoProvider.lua", "PluginInit.lua", "Prefs.lua", "Preview.lua", "Sockets.lua", "Stall.lua", "Transfer.lua",
    ]);
  });

  it.each(files.map((f) => [path.relative(pluginRoot, f), f]))("%s parses as Lua 5.1", (_name, file) => {
    expect(() => luaparse.parse(readFileSync(file, "utf8"), { luaVersion: "5.1" })).not.toThrow();
  });

  it.each(files.map((f) => [path.relative(pluginRoot, f), f]))("%s does not use the utf8 library", (_name, file) => {
    expect(codeOnly(readFileSync(file, "utf8"))).not.toMatch(/\butf8\s*\./);
  });
});

describe("lua: LrC-AVG.lrplugin", () => {
  const own = new Set(readdirSync(avgPlugin).filter((f) => f.endsWith(".lua")).map((f) => f.slice(0, -4)));

  it("requires only modules in its own folder (a .lrplugin cannot require outside it)", () => {
    for (const file of files.filter((f) => f.startsWith(avgPlugin))) {
      for (const [, name] of readFileSync(file, "utf8").matchAll(/\brequire\s*\(?\s*['"]([^'"]+)['"]/g)) {
        expect(own.has(name as string), `${path.basename(file)} requires ${name}`).toBe(true);
      }
    }
  });

  it("names every file that Info.lua points at", () => {
    const info = readFileSync(path.join(avgPlugin, "Info.lua"), "utf8");
    const named = [...info.matchAll(/(?:file|LrInitPlugin|LrPluginInfoProvider)\s*=\s*['"]([^'"]+\.lua)['"]/g)].map((m) => m[1] as string);
    expect(named).toContain("PluginInfoProvider.lua");
    for (const file of named) {
      expect(own.has(file.slice(0, -4)), file).toBe(true);
    }
  });

  it("uses LrTasks.pcall, except where a plain pcall is marked as safe (rule 03-lightroom)", () => {
    // Plain pcall cannot cross a yield: in Jim's first Phase 1 run it raised "Yielding is not allowed
    // within a C or metamethod call" around getRawMetadata (docs/reports/phase1/PHASE1.md, run 1).
    // A plain pcall is allowed only with a "-- plain pcall: <why>" comment on the same line.
    for (const file of files.filter((f) => f.startsWith(avgPlugin))) {
      const source = readFileSync(file, "utf8");
      const lines = source.split(/\r?\n/);
      codeOnly(source).split(/\r?\n/).forEach((code, i) => {
        if (/(?<![.\w])pcall\s*\(/.test(code)) {
          expect(lines[i], `${path.basename(file)}:${i + 1}`).toMatch(/--\s*plain pcall: \S/);
        }
      });
    }
  });

  it("strips comments and strings from whole files without moving lines (helper for the checks above)", () => {
    const source = ["local a = 1", "--[[ a block comment", "x = pcall(f)", "]]", "local s = [[", "pcall(", "]]", "y = pcall(g) -- plain pcall: test"].join("\n");
    const code = codeOnly(source).split("\n");
    expect(code).toHaveLength(8);
    expect(code.slice(0, 7).some((l) => l.includes("pcall"))).toBe(false);
    expect(code[7]).toContain("pcall(g)");
  });

  it("does not let a [[ inside a quoted string or a line comment hide the code after it", () => {
    const source = [
      'local open = "[["',
      "x = pcall(f)",
      "local close = ']]'",
      "-- see [[ here",
      "y = pcall(g)",
      "-- and ]] here",
      'local esc = "a \\" [[ b"',
      "z = pcall(h)",
    ].join("\n");
    const code = codeOnly(source).split("\n");
    expect(code).toHaveLength(8);
    expect(code[1]).toContain("pcall(f)");
    expect(code[4]).toContain("pcall(g)");
    expect(code[7]).toContain("pcall(h)");
    expect(code.filter((l) => l.includes("[["))).toEqual([]);
  });

  it("keeps line numbers when a quoted string continues over an escaped line break", () => {
    const source = ['local s = "first \\', 'second"', "x = pcall(f)"].join("\n");
    const code = codeOnly(source).split("\n");
    expect(code).toHaveLength(3);
    expect(code[2]).toContain("pcall(f)");
  });

  it("opens every catalog write gate through Gate.lua, which passes timeoutParams and answers gate_busy for aborted (issue #59, PR C step 2b)", () => {
    for (const file of files.filter((f) => f.startsWith(avgPlugin) && path.basename(f) !== "Gate.lua")) {
      expect(codeOnly(readFileSync(file, "utf8")), path.basename(file)).not.toMatch(/with(Prolonged)?WriteAccessDo/);
    }
    const gate = codeOnly(readFileSync(path.join(avgPlugin, "Gate.lua"), "utf8"));
    for (const [call] of gate.matchAll(/withWriteAccessDo\(([^\n]*)\)/g)) expect(call, call).toMatch(/\{ timeout = seconds/);
    expect(gate).toMatch(/if status == "" then return nil, busy\(name, seconds\) end/);
    // The AI update runs in its own task, its gate inside it, and the command answers "started" at once (plugin 0.14.0).
    const masks = codeOnly(readFileSync(path.join(avgPlugin, "Masks.lua"), "utf8"));
    expect(masks).toMatch(/LrTasks\.startAsyncTask\(function\(\)\s+local ok, err = LrTasks\.pcall\(function\(\)\s+local gated = Gate\.write\(catalog, ""/);
    expect(masks).toMatch(/return \{ uuid = found\.uuid, status = "", state = rec\.state/);
    expect(gate).not.toMatch(/asynchronous/);
  });

  it("closes the HUD close_after seconds after an update that carries it, unless another session's update came; a click's answer does not keep it open (D15, plugin 0.16.0)", () => {
    const hud = codeOnly(readFileSync(path.join(avgPlugin, "Hud.lua"), "utf8"));
    expect(hud).toMatch(/if s\.close_after then[\s\S]*?LrTasks\.startAsyncTask\(function\(\)\s+LrTasks\.sleep\(s\.close_after\)\s+if H\.open and H\.state and H\.state\.session_id == sid and HudState\.isEnd\(H\.state\.stage\) then[\s\S]*?LrDialogs\.closeFloatingDialogsForPlugin\(_PLUGIN\)/);
    expect(readFileSync(path.join(avgPlugin, "HudState.lua"), "utf8")).toMatch(/close_after = \{ kind = "int", min = 1, max = 60 \}/);
    expect(hudUpdatePayloadSchema.shape.close_after.unwrap().maxValue).toBe(60);
  });

  it("guards every write to a photo while an AI mask computes on it, before its gate, with the engine's field names (Pending.lua, plugin 0.16.0, D16)", () => {
    const read = (f: string): string => codeOnly(readFileSync(path.join(avgPlugin, f), "utf8"));
    const develop = read("Develop.lua");
    expect(develop).toMatch(/local function writeTarget\(payload\)\s+local catalog, photo, uuid, err = Develop\.target\(payload\)\s+if err then return nil, nil, nil, err end\s+local refused = Pending\.refusal\(catalog, photo, uuid\)\s+if refused then return nil, nil, nil, refused end/);
    for (const fn of ["applySettings", "createSnapshot", "applySnapshot"]) {
      const body = develop.match(new RegExp(`function Develop\\.${fn}\\(payload\\)([\\s\\S]*?)\\nend`))?.[1] ?? "";
      expect(body, fn).toMatch(/= writeTarget\(payload\)[\s\S]*Gate\.write/);
    }
    const masks = read("Masks.lua");
    expect(masks).toMatch(/local guard = Pending\.start\(found\.uuid, rec\.request_id, payload\.watch\)\s+LrTasks\.startAsyncTask/);
    expect(masks).toMatch(/if rec\.state == "" or rec\.state == "" then Pending\.clear\(found\.uuid, guard\) end/);
    expect(masks).toMatch(/local refused = Pending\.refusal\(ctx\.catalog, ctx\.photo, ctx\.uuid\)\s+if refused then return nil, refused end\s+MaskProbe\.openMasking\(ctx\)/);
    expect(read("HudClick.lua")).toMatch(/local notDevelop = Develop\.toDevelop\(\)\s+if notDevelop then return nil, PB_REASON\.not_in_develop, notDevelop\.message end\s+if not sameEdit\(sid\) then return nil, PB_REASON\.newer, "" end\s+local refused = Pending\.refusal\(catalog, photo, pb\.photo_uuid\)\s+if refused then return nil, PB_REASON\.computing, refused\.message end\s+local stale = false\s+local gated, busy = Gate\.write/);
    // Plugin 0.18.1 (fix/snapshot-develop): a snapshot applies only in Develop [inference, Develop.lua toDevelop], so both applies switch
    // there first, outside the gate, and every check runs after the switch's wait (Greptile, PR #93).
    expect(develop).toMatch(/function Develop\.applySnapshot\(payload\)\s+local id = payload\.snapshot_id\s+if [^\n]*\s+local notDevelop = Develop\.toDevelop\(\)\s+if notDevelop then return nil, notDevelop end\s+local catalog, photo, uuid, err = writeTarget\(payload\)/);
    // No SDK key in the plugin (rule 03): the guard reads the fields `watch` names, the engine's aiWatch.
    const pending = readFileSync(path.join(avgPlugin, "Pending.lua"), "utf8");
    expect(pending).not.toMatch(/"(MaskGroupBasedCorrections|CorrectionID|CorrectionMasks|MaskDigest|ErrorReason)"/);
    const listed = (name: string) => pending.match(new RegExp(`local ${name} = \\{([^}]*)\\}`))?.[1]?.match(/"[^"]*"/g)?.map((s) => s.slice(1, -1)) ?? [];
    const { ids: _ids, ...names } = aiWatch([]);
    expect([...listed("FIELDS"), ...listed("AI_FIELDS")]).toEqual(Object.keys(names)); // AI_FIELDS: plugin 0.21.0, issue #131
    expect(pending).toMatch(/_G\.LrCAVG_PendingAi = _G\.LrCAVG_PendingAi or \{\}/);
    expect(read("Bridge.lua")).toMatch(/process_started_at = _G\.LrCAVG_ProcessStartedAt,/);
    // Phase 9 run 1b: a bridge left with no listener heals itself; it binds afresh while no engine is connected.
    // Issue #174: only once, since every rebind spent ~10 s in the socket work and Lightroom stuttered. Issue #176:
    // only after a start that overlapped another, not on every start; other lost listeners rebind on their events.
    expect(read("Bridge.lua")).not.toMatch(/STARTUP_REBIND|startupRebind/);
    expect(read("Bridge.lua")).toMatch(/if S\.receiveConnected then S\.overlapped = false end\s+if S\.overlapped and S\.boundAt and \(LrDate\.currentTime\(\) - S\.boundAt\) > OVERLAP_REBIND_SECONDS then\s+Stall\.rebind\([^)]*\)\s+S\.overlapped = false\s+S\.receiveNeedsRebind, S\.sendNeedsRebind = true, true/);
    expect(read("Bridge.lua")).toMatch(/LrTasks\.pcall\(Endpoint\.recentStart, OVERLAP_SECONDS\)[\s\S]{0,400}LrTasks\.pcall\(Endpoint\.newToken\)/);
    // codeOnly blanks string literals to "".
    expect(read("Sockets.lua")).toMatch(/S\.receiveConnected = false\s+Log\.info\(""\)\s+rebindOr\(B, "", ""\)/);
    // PR #191 denoise:check pass 2: a new connection cancels that rebind, which otherwise closed it.
    expect(read("Sockets.lua")).toMatch(/S\.receiveConnected = true\s+(--[^\n]*\s+)*S\.receiveNeedsRebind = false/);
    expect(read("Sockets.lua")).toMatch(/if S\.rebindAt\[side\] and now - S\.rebindAt\[side\] < REBIND_MIN_SECONDS then\s+S\[side \.\. ""\] = true/);
    // Issue #174 diagnosis: every monitor tick is timed, its socket work too (Stall.lua).
    // Issue #174 runs 2-3: Disable did not end the loop, a disabled plugin's init started the bridge and Enable
    // did not start it. Now Enable and Disable have their own scripts, and init starts nothing while disabled.
    expect(read("Bridge.lua")).toMatch(/monitor\(B\)[\s\S]{0,120}if _PLUGIN\.enabled == false or _G\.LrCAVG_BridgeStopped then Log\.info\(/);
    expect(read("Bridge.lua")).toMatch(/function Bridge\.stop\(\)\s+_G\.LrCAVG_BridgeStopped = true\s+_G\.LrCAVG_BridgeGeneration = _G\.LrCAVG_BridgeGeneration \+ 1/);
    expect(readFileSync(path.join(avgPlugin, "Info.lua"), "utf8")).toMatch(/LrEnablePlugin = 'PluginEnable\.lua',\s+LrDisablePlugin = 'PluginDisable\.lua',/);
    expect(read("PluginInit.lua")).toMatch(/if _PLUGIN\.enabled == false then\s+Log\.info\([^)]*\)\s+else\s+local ok, err = pcall\(Bridge\.start\)/);
    expect(read("PluginEnable.lua")).toMatch(/pcall\(Bridge\.start\)/);
    expect(read("PluginDisable.lua")).toMatch(/pcall\(Bridge\.stop\)/);
    expect(read("Bridge.lua")).toMatch(/while B\.current\(\) and _PLUGIN\.enabled ~= false do\s+Stall\.tick\(D\)[\s\S]*Stall\.timed\(D, function\(\) tendSockets\(B\) end\)/);
    expect(read("Sockets.lua")).toMatch(/S\.receiveSocket = bindReceive\(B, S\.receiveGen\)[\s\S]{0,120}S\.boundAt = LrDate\.currentTime\(\)/);
  });

  it("passes a History name to every applyDevelopSettings call (rule 03-lightroom)", () => {
    for (const file of files.filter((f) => f.startsWith(avgPlugin))) {
      for (const [call] of codeOnly(readFileSync(file, "utf8")).matchAll(/applyDevelopSettings\s*\(([^)]*)\)/g)) {
        expect(call.split(",").length, `${path.basename(file)}: ${call}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("reports the plugin version the engine's bridge matches, in Bridge.lua and Info.lua", () => {
    const bridge = readFileSync(path.join(avgPlugin, "Bridge.lua"), "utf8");
    expect(bridge.match(/Bridge\.PLUGIN_VERSION = "([^"]+)"/)?.[1]).toBe(PLUGIN_VERSION);
    const info = readFileSync(path.join(avgPlugin, "Info.lua"), "utf8");
    const v = info.match(/VERSION = \{ major = (\d+), minor = (\d+), revision = (\d+)/);
    expect(v?.slice(1, 4).join(".")).toBe(PLUGIN_VERSION);
  });

  it("keeps Prefs.lua's SPECS equal to the engine's PAGE_SPECS: keys, wire names, kinds, defaults, ranges (engine\\src\\settings\\page.ts)", () => {
    const source = readFileSync(path.join(avgPlugin, "Prefs.lua"), "utf8");
    const table = source.match(/Prefs\.SPECS = \{([\s\S]*?)\n\}/)?.[1] ?? "";
    const raw = (line: string, name: string): string | undefined => line.match(new RegExp(`\\b${name} = ("[^"]*"|[\\d.]+)`))?.[1];
    const lua = table
      .split(/\r?\n/)
      .filter((line) => line.includes("key = "))
      .map((line) => {
        const value = (name: string): string | number | undefined => {
          const v = raw(line, name);
          return v === undefined ? undefined : v.startsWith('"') ? v.slice(1, -1) : Number(v);
        };
        const choices = line.match(/choices = \{([^}]*)\}/)?.[1]?.match(/"[^"]*"/g)?.map((c) => c.slice(1, -1));
        const spec: Record<string, unknown> = { key: value("key"), wire: value("wire"), kind: value("kind"), default: value("default") };
        if (choices) spec["choices"] = choices;
        if (value("min") !== undefined) Object.assign(spec, { min: value("min"), max: value("max") });
        return spec;
      });
    expect(lua).toHaveLength(PAGE_SPECS.length);
    expect(lua).toEqual(PAGE_SPECS.map((s) => ({ ...s })));
    expect(source).toMatch(new RegExp(`Prefs\\.LOCK_PORT = ${LOCK_PORT}\\b`));
    expect(source).toMatch(new RegExp(`Prefs\\.DECAY_MAX_VALUES = ${DECAY_MAX_VALUES}\\b`));
  });

  it("moves a stored 4 passes (the pre-1.2.0 default fillDefaults stored) to 8 once, before every read of the settings", () => {
    const prefs = readFileSync(path.join(avgPlugin, "Prefs.lua"), "utf8");
    expect(prefs).toMatch(/if prefs\.maxPassesMigrated then return end\s+if prefs\.maxPasses == 4 then prefs\.maxPasses = 8 end\s+prefs\.maxPassesMigrated = true/);
    expect(prefs).toMatch(/Prefs\.migrate\(prefs\)\s+local values, invalid = Prefs\.read\(prefs\)/);
    const page = readFileSync(path.join(avgPlugin, "PluginInfoProvider.lua"), "utf8");
    expect(page).toMatch(/Prefs\.migrate\(prefs\)\s+Prefs\.fillDefaults\(prefs\)/);
  });

  it("keeps HudState.lua's stage, event, guardrail and variant lists and its limits equal to the engine's (engine\\src\\bridge\\hud-protocol.ts)", () => {
    const source = readFileSync(path.join(avgPlugin, "HudState.lua"), "utf8");
    const list = (name: string) => source.match(new RegExp(`HudState\\.${name} = \\{([^}]*)\\}`))?.[1]?.match(/"[^"]*"/g)?.map((s) => s.slice(1, -1));
    expect(list("STAGES")).toEqual([...HUD_STAGES]);
    expect(list("END_STAGES")).toEqual([...HUD_END_STAGES]);
    expect(list("GUARDRAIL")).toEqual([...HUD_GUARDRAIL]);
    expect(list("EVENTS")).toEqual([...HUD_EVENTS]);
    expect(list("VARIANTS")).toEqual([...HUD_VARIANTS]);
    const limits = source.match(/HudState\.LIMITS = \{([^}]*)\}/)?.[1] ?? "";
    expect(Object.fromEntries([...limits.matchAll(/(\w+) = (\d+)/g)].map((m) => [m[1], Number(m[2])]))).toEqual(HUD_LIMITS);
  });

  it("keeps HudState.lua's put_back fields equal to the engine's, and puts back through a write gate that waits (plugin 0.13.0, HudClick.lua)", () => {
    const state = readFileSync(path.join(avgPlugin, "HudState.lua"), "utf8");
    const fields = state.match(/local PUT_BACK = \{(.*)\}\r?\n/)?.[1] ?? "";
    const keys = [...fields.matchAll(/(\w+) = \{ kind = "(\w+)", required = true \}/g)].map((m) => `${m[1]}:${m[2]}`).sort();
    expect(keys).toEqual(["photo_uuid:id", "snapshot_id:id", "snapshot_name:text"]);
    expect(Object.keys(hudUpdatePayloadSchema.shape.put_back.unwrap().shape).sort()).toEqual(["photo_uuid", "snapshot_id", "snapshot_name"]);
    expect(state).toMatch(/put_back = \{ kind = "object", fields = PUT_BACK \}/);
    const click = codeOnly(readFileSync(path.join(avgPlugin, "HudClick.lua"), "utf8"));
    expect(click).toMatch(/Gate\.write\(catalog, "", function\(\)\s+if not sameEdit\(sid\) then stale = true; return end\s+photo:applyDevelopSnapshot\(pb\.snapshot_id\)/);
    expect(click).toMatch(/if not sameEdit\(sid\) then return nil, PB_REASON\.newer/); // checked before the gate too
    expect(click).toMatch(/Events\.send\("", r\)/); // hud_put_back, told to the engine
    expect(codeOnly(readFileSync(path.join(avgPlugin, "Hud.lua"), "utf8"))).toMatch(/function Hud\.markUnknown\(\)\s+HudClick\.resendReport\(\)/);
    expect(click).not.toMatch(/withWriteAccessDo/);
    expect(codeOnly(readFileSync(path.join(avgPlugin, "HudView.lua"), "utf8"))).toMatch(/v\.putBackEnabled = HudState\.canPutBack\(s, conn, hud\)/);
  });

  it("checks the AI's name and model as HUD fields, as the engine sends them (issue #155, plugin 0.23.0)", () => {
    const fields = readFileSync(path.join(avgPlugin, "HudState.lua"), "utf8").match(/local FIELDS = \{([\s\S]*?)\n\}/)?.[1] ?? "";
    for (const key of ["ai_name", "ai_model"]) {
      expect(fields, key).toMatch(new RegExp(`\\b${key} = TEXT,`));
      expect(Object.keys(hudUpdatePayloadSchema.shape), key).toContain(key);
    }
  });

  it("keeps the HUD's and the Deck's shared words equal, with the {ai} tokens and no 'Claude' (issue #155)", () => {
    // %d/%s (Lua) and ${...} (TypeScript) are the parameters: both read as "#".
    const normalize = (t: string): string => t.replace(/%[ds]/g, "#").replace(/\$\{[^}]*\}/g, "#");
    const SHARED = [
      "{AI} is not connected. Your edit so far stays.",
      "This edit is no longer open in {ai}. Your edit so far stays.",
      "{AI} is working. Nothing needed from you.",
      "Your turn: pick a copy, or tell {ai} which one.",
      "Your turn: {ai} thinks the edit is done.",
      "Your turn: approve pass # so {ai} can go on.",
      "{AI} is looking at the result",
      "{AI} thinks the edit is done",
      "# sent; waiting for {ai}.",
      "#: no answer from {ai} within # s; the buttons are on again.",
      "{AI}'s next call selects the edit's photo again",
    ];
    const hudText = readFileSync(path.join(avgPlugin, "HudText.lua"), "utf8");
    const lua = normalize(hudText + readFileSync(path.join(avgPlugin, "HudState.lua"), "utf8"));
    const deck = normalize(readFileSync(fileURLToPath(new URL("../../hud/ui/text.ts", import.meta.url)), "utf8"));
    for (const words of SHARED) {
      expect(lua, `plugin: ${words}`).toContain(words);
      expect(deck, `Deck: ${words}`).toContain(words);
    }
    expect((hudText.match(/"[^"\n]*"/g) ?? []).filter((q) => q.includes("Claude"))).toEqual([]);
  });

  it("keeps KeywordTree.lua's separator and Library.lua's page limit equal to the engine's (engine\\src\\library\\)", () => {
    expect(readFileSync(path.join(avgPlugin, "KeywordTree.lua"), "utf8")).toMatch(new RegExp(`KeywordTree\\.SEPARATOR = "\\${KEYWORD_SEPARATOR}"`));
    expect(readFileSync(path.join(avgPlugin, "Library.lua"), "utf8")).toMatch(new RegExp(`Library\\.MAX_PAGE = ${MAX_PAGE}\\b`));
    expect(readFileSync(path.join(avgPlugin, "Transfer.lua"), "utf8")).toMatch(new RegExp(`Transfer\\.MAX_UUIDS = ${MAX_COLLECTION_PHOTOS}\\b`));
  });

  it("handles every command the engine sends (engine\\src\\bridge\\protocol.ts COMMANDS)", () => {
    const dispatch = codeOnly(readFileSync(path.join(avgPlugin, "Dispatch.lua"), "utf8"));
    const table = dispatch.match(/local HANDLERS = \{([\s\S]*?)\n\s*\}/)?.[1] ?? "";
    const handled = [...table.matchAll(/^\s*(\w+)\s*=/gm)].map((m) => m[1]).sort();
    expect(handled).toEqual(Object.keys(COMMANDS).sort());
  });
});
