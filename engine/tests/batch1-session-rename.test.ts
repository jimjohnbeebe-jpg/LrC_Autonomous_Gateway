// Hands-on batch 1 items 3 and 4: an lr_edit_mask that only renames uses no pass (src/session/masks.ts
// renameMask), and SESSION_NOT_ACTIVE is recoverable and names the open session, from the session manager
// and from the read tools' openSession (src/mcp/tools-shared.ts).

import { describe, expect, it } from "vitest";
import { ToolError } from "../src/mcp/errors.js";
import { openSession, type ToolContext } from "../src/mcp/tools-shared.js";
import { MASK_TABLE_KEY, type Correction } from "../src/params/index.js";
import { defaultSimPrefs } from "./helpers/lightroom-sim-prefs.js";
import { ID, SHORT, clean, fails, lr, manager, newManager, plugin, readLog, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

const masks = (): Correction[] => (lr.settings[MASK_TABLE_KEY] ?? []) as Correction[];
const pass = { session_id: ID, rationale: "test", return_image: "none" as const };
const LINEAR = { kind: "linear", geometry: { zero: { x: 0.5, y: 0.67 }, full: { x: 0.5, y: 0.9 } }, sliders: { "local.exposure": 1 } };
const renders = (): number => plugin.received.filter((r) => r.name === "export_preview").length;

describe("lr_edit_mask with only a new name", () => {
  it("writes the name without a pass, at the cap, with no render; the same name again is NO_CHANGE", async () => {
    clean();
    await manager.begin({ intent_id: "test_plain", return_image: "none", max_passes: 1 });
    const created = await manager.createMask({ ...pass, ...LINEAR, name: "my mask!" });
    const id = (created.json["mask"] as { id: string }).id;
    expect(masks()[0]?.["CorrectionName"]).toBe("my mask!"); // any name is written as given
    expect(created.json).toMatchObject({ pass: "1/1", cap_reached: true });
    const history = lr.history.length;
    const before = renders();
    const logged = readLog().passes.length;
    const out = await manager.editMask({ ...pass, mask_id: id, name: "1. Sky - Darken" });
    expect(out.json).toMatchObject({ pass: "1/1", pass_used: false, op: "rename", mask: { id, name: "1. Sky - Darken" }, history_names: [`AVG ${SHORT} pass 1/1 mask rename`] });
    expect(out.log).toMatchObject({ op: "rename", mask_id: id });
    expect(out.image).toBeUndefined();
    expect(lr.history.slice(history)).toEqual([`AVG ${SHORT} pass 1/1 mask rename`]);
    expect(renders()).toBe(before);
    expect(masks()[0]?.["CorrectionName"]).toBe("1. Sky - Darken");
    expect(manager.current()?.pass).toBe("1/1");
    expect(readLog().passes).toHaveLength(logged); // no session-log pass
    expect(await fails(manager.editMask({ ...pass, mask_id: id, name: "1. Sky - Darken" }))).toMatchObject({ code: "NO_CHANGE" });
    expect(lr.history.length).toBe(history + 1);
  });

  it("leaves the last render standing: the next step does not render again first", async () => {
    clean();
    await manager.begin({ max_passes: 4, intent_id: "test_plain", return_image: "none" });
    const id = ((await manager.createMask({ ...pass, ...LINEAR, name: "a" })).json["mask"] as { id: string }).id;
    await manager.editMask({ ...pass, mask_id: id, name: "b" });
    const before = renders();
    const step = await manager.step({ session_id: ID, settings: { exposure: 0.2 }, rationale: "test", return_image: "none" });
    expect(step.json["metrics_refreshed"]).toBeUndefined();
    expect(renders()).toBe(before + 1);
  });

  it("a name with another change is still a pass", async () => {
    clean();
    await manager.begin({ max_passes: 4, intent_id: "test_plain", return_image: "none" });
    const id = ((await manager.createMask({ ...pass, ...LINEAR, name: "a" })).json["mask"] as { id: string }).id;
    const out = await manager.editMask({ ...pass, mask_id: id, name: "b", inverted: true });
    expect(out.json).toMatchObject({ pass: "2/4", op: "edit", mask: { name: "b", inverted: true } });
    expect(lr.history.at(-1)).toBe(`AVG ${SHORT} pass 2/4 mask edit`);
  });

  it("does not wait for an approval in approve_each_pass mode", async () => {
    clean();
    lr.prefs = { ...defaultSimPrefs(), mode: "approve_each_pass" };
    const m = newManager({ approvalWaitMs: 150 });
    await m.begin({ max_passes: 4, intent_id: "test_plain", return_image: "none" });
    const id = ((await m.createMask({ ...pass, ...LINEAR, name: "a" })).json["mask"] as { id: string }).id;
    expect((await m.editMask({ ...pass, mask_id: id, name: "b" })).json).toMatchObject({ pass: "1/4", pass_used: false });
  });
});

describe("SESSION_NOT_ACTIVE", () => {
  it("from a session tool: recoverable, naming the open session", async () => {
    clean();
    expect(await fails(manager.step({ session_id: "nope", settings: { shadows: 1 }, rationale: "r" }))).toMatchObject({ code: "SESSION_NOT_ACTIVE", recoverable: true, details: { session_id: "nope", open_session_id: null } });
    await manager.begin({ max_passes: 4, intent_id: "test_plain", return_image: "none" });
    const err = await fails(manager.listMasks({ session_id: "nope" }));
    expect(err).toMatchObject({ code: "SESSION_NOT_ACTIVE", recoverable: true, details: { session_id: "nope", open_session_id: ID } });
    expect(err.message).toContain(ID);
  });

  it("from a read tool's session_id: recoverable, naming the open session", () => {
    const ctx = { sessions: { userEnded: () => null, current: () => ({ id: ID, uuid: "u" }) } } as unknown as ToolContext;
    let err: unknown;
    try {
      openSession(ctx, "nope");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ToolError);
    expect(err).toMatchObject({ code: "SESSION_NOT_ACTIVE", recoverable: true, details: { session_id: "nope", open_session_id: ID } });
  });
});
