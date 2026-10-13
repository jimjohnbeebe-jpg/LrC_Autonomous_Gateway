// Tool description clauses Claude needs (issue #129) and the UNKNOWN_PARAMETER message.

import { describe, expect, it } from "vitest";
import { MASK_DEFS } from "../src/mcp/defs-masks.js";
import { SESSION_DEFS } from "../src/mcp/defs-session.js";
import { toToolError } from "../src/mcp/errors.js";
import { loadDefaultParamMap } from "../src/params/index.js";

const text = (name: string): string => {
  const def = [...SESSION_DEFS, ...MASK_DEFS].find((d) => d.name === name);
  if (!def) throw new Error(`no tool ${name}`);
  return def.description;
};

describe("tool descriptions (issue #129)", () => {
  it("lr_step defines recoverable and the decay after the fourth pass", () => {
    expect(text("lr_step")).toContain("`recoverable`: true means the same call may work later unchanged");
    expect(text("lr_step")).toContain("a later pass takes the last value again");
  });

  it("lr_edit_mask keeps the sliders it is not sent", () => {
    expect(text("lr_edit_mask")).toContain("sliders not given keep their values");
  });

  it("every mask pass tool says an undone pass counts, what an AI point is, and how to measure a local edit", () => {
    for (const name of ["lr_create_mask", "lr_edit_mask", "lr_delete_mask"]) {
      expect(text(name)).toContain("the pass still counts");
      expect(text(name)).toContain("geometry.point is Lightroom's reference point");
      expect(text(name)).toContain("To measure a local edit");
    }
  });

  it("UNKNOWN_PARAMETER says nothing was written and where the valid names are", () => {
    let err: unknown;
    try {
      loadDefaultParamMap().toSdk({ "crop.angle": 10 }, { processVersion: "15.4", pipeline: "raw" });
    } catch (e) {
      err = e;
    }
    const tool = toToolError(err);
    expect(tool.code).toBe("UNKNOWN_PARAMETER");
    expect(tool.message).toContain('Unknown parameter "crop.angle"');
    expect(tool.message).toContain("nothing was written to the photo and no pass was used");
    expect(tool.message).toContain("lr_get_active_photo_context");
  });
});
