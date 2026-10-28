// The pure parts of `npm run masks:parity` (src/devtools/masks-verify-parity.ts, issue #217): its steps' writes build
// on a table (so a run does not stop on a refused argument), and the curve capture names what changed.

import { describe, expect, it } from "vitest";
import { BANDS, ERASE, SWATCH, changedFields } from "../src/devtools/masks-verify-parity.js";
import { applyOp, type Correction } from "../src/params/index.js";

describe("masks:parity", () => {
  it("builds every step's write in turn", () => {
    const brush = applyOp([], { op: "create", kind: "brush", name: "AVG parity brush", geometry: { strokes: BANDS } });
    const erased = applyOp(brush.entries, { op: "edit", mask_id: brush.id, geometry: { strokes: [ERASE] } });
    const coloured = applyOp(erased.entries, { op: "edit", mask_id: brush.id, point_colors: { action: "add", swatch: SWATCH } });
    const copied = applyOp(coloured.entries, { op: "edit", mask_id: brush.id, inverted: true, copy: true });
    expect(copied.entries).toHaveLength(2);
    expect(copied.after).toMatchObject({ name: "AVG parity brush inverted", inverted: true, point_colors: [expect.objectContaining({ hue_shift: 0.5 })] });
  });

  it("names the new and changed fields of a correction, not its parts", () => {
    const before = { What: "Correction", CorrectionID: "A", LocalExposure2012: 0.5, CorrectionMasks: [] } as unknown as Correction;
    const after = { ...before, LocalExposure2012: 0.5, MainCurve: ["0, 0", "128, 150", "255, 255"], CorrectionMasks: [{ What: "x" }] } as unknown as Correction;
    expect(changedFields(before, after)).toEqual({ MainCurve: ["0, 0", "128, 150", "255, 255"] });
    expect(changedFields(before, undefined)).toEqual({});
  });
});
