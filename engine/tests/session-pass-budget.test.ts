// The pass budget (Phase 10 row 3, decision Q3 [stated: Jim, 2026-10-25]): a session begun without
// max_passes on a page that sets none gets 8 passes; lr_begin_session takes 1-16 and refuses 17.

import { describe, expect, it } from "vitest";
import { SESSION_DEFS } from "../src/mcp/defs-session.js";
import { clean, lr, manager, useSessionHarness } from "./helpers/session-harness.js";
import { defaultSimPrefs } from "./helpers/lightroom-sim-prefs.js";

useSessionHarness();

const beginSchema = SESSION_DEFS.find((d) => d.name === "lr_begin_session")?.schema;

describe("lr_begin_session: the pass budget", () => {
  it("gives 8 passes when neither the argument nor the page sets max_passes", async () => {
    clean();
    lr.prefs = defaultSimPrefs();
    delete lr.prefs["max_passes"];
    const out = await manager.begin({ intent_id: "test_plain", return_image: "none" });
    expect(out.json).toMatchObject({ pass: "0/8", max_passes: 8 });
    expect(out.json["session_settings"]).toMatchObject({ from: { max_passes: "default" } });
  });

  it("accepts max_passes 16 and refuses 17", async () => {
    expect(beginSchema?.safeParse({ max_passes: 16 }).success).toBe(true);
    expect(beginSchema?.safeParse({ max_passes: 17 }).success).toBe(false);
    clean();
    const out = await manager.begin({ intent_id: "test_plain", max_passes: 16, return_image: "none" });
    expect(out.json).toMatchObject({ pass: "0/16", max_passes: 16 });
  });
});
