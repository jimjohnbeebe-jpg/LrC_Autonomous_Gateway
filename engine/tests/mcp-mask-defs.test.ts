// The argument schemas of the mask tools (src/mcp/defs-masks.ts): what reaches the engine.

import { describe, expect, it } from "vitest";
import { MASK_DEFS } from "../src/mcp/defs-masks.js";

const schema = (name: string) => {
  const def = MASK_DEFS.find((d) => d.name === name);
  if (!def) throw new Error(`no tool ${name}`);
  return def.schema;
};
const create = (args: Record<string, unknown>) => schema("lr_create_mask").safeParse({ session_id: "s", rationale: "r", ...args });

describe("lr_create_mask arguments", () => {
  it("takes the kinds its description offers: color_range, depth_range and brush (issue #210; left out since #191)", () => {
    expect(create({ kind: "color_range", point: { x: 0.5, y: 0.5 } }).success).toBe(true);
    expect(create({ kind: "depth_range", geometry: { depth_range: [0, 0, 0.3, 0.5] } }).success).toBe(true);
    expect(create({ kind: "brush", geometry: { strokes: [{ points: [{ x: 0.1, y: 0.5 }] }] } }).success).toBe(true);
    expect(create({ kind: "nonsense" }).success).toBe(false);
  });
});
