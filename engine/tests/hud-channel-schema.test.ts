// The HUD channel's state schema (Phase 7 row 3; src\hud\channel-protocol.ts; spec docs\hud\
// lrc-avg-hud-spec-v2.md 3.3, 11.2 "hud-channel-schema.test.ts"): strict after .omit/.extend (true in
// zod 4.6.5, spec 3.3; kept as a guard against an upgrade), the row limit, the text limit in bytes, and
// the engine's own text cut to fit. That every state a session sends passes is checked in
// hud-channel.test.ts and hud-extras.test.ts (no state the Deck got failed the schema).

import { describe, expect, it } from "vitest";
import { HUD_LIMITS } from "../src/bridge/index.js";
import { hudChannelStateSchema } from "../src/hud/index.js";
import { fit } from "../src/hud/extras.js";

const base = { session_id: "s1", stage: "awaiting_claude", target: { uuid: "U1" }, lightroom: "connected" } as const;
const row = { name: "exposure", label: "Exposure", group: "Basic", before: 0, after: 0.2, delta: 0.2, min: -5, max: 5, weight: 0.2 };

describe("hudChannelStateSchema", () => {
  it("takes a state with every Deck field", () => {
    const state = {
      ...base,
      rows: [row],
      copies: [{ letter: "A", label: "natural", copy_name: "AVG x A", uuid: "C1", pass: 1, thumb: "A:1:0123456789ab", guardrail: { status: "green" } }],
      picked: null,
      selection: { uuid: null, name: null, in_edit: false },
      close_after: 10,
    };
    expect(hudChannelStateSchema.safeParse(state).success).toBe(true);
  });

  it("refuses unknown fields, at the top, in a row and in a copy", () => {
    expect(hudChannelStateSchema.safeParse({ ...base, whole_edit: { rows: [], more: 0 } }).success).toBe(false);
    expect(hudChannelStateSchema.safeParse({ ...base, rows: [{ ...row, colour: "red" }] }).success).toBe(false);
    expect(hudChannelStateSchema.safeParse({ ...base, copies: [{ letter: "A", uuid: "C1", pass: 0, extra: 1 }] }).success).toBe(false);
    // The Lua HUD's `open` and `seq` are not the channel's.
    expect(hudChannelStateSchema.safeParse({ ...base, open: true }).success).toBe(false);
    expect(hudChannelStateSchema.safeParse({ ...base, seq: 1 }).success).toBe(false);
  });

  it("refuses more than HUD_LIMITS.rows rows, and a state without Lightroom's state", () => {
    expect(hudChannelStateSchema.safeParse({ ...base, rows: Array(HUD_LIMITS.rows).fill(row) }).success).toBe(true);
    expect(hudChannelStateSchema.safeParse({ ...base, rows: Array(HUD_LIMITS.rows + 1).fill(row) }).success).toBe(false);
    const { lightroom: _, ...without } = base;
    expect(hudChannelStateSchema.safeParse(without).success).toBe(false);
  });

  it("counts text in UTF-8 bytes: 120 pass, 121 do not", () => {
    const at = "é".repeat(60); // 120 bytes
    expect(hudChannelStateSchema.safeParse({ ...base, rows: [{ ...row, label: at }] }).success).toBe(true);
    expect(hudChannelStateSchema.safeParse({ ...base, rows: [{ ...row, label: `${at}x` }] }).success).toBe(false);
  });

  it("cuts the engine's own text to 120 bytes on a character boundary", () => {
    expect(fit("short")).toBe("short");
    const cut = fit("é".repeat(70));
    expect(cut).toBe("é".repeat(60));
    expect(fit(`x${"é".repeat(70)}`)).toBe(`x${"é".repeat(59)}`);
  });
});
