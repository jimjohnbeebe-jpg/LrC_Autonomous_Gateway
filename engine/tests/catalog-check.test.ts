// `npm run catalog:check` (issue #218): the verdict of devtools\catalog-check.ts. The steps run against Lightroom only.

import { describe, expect, it } from "vitest";
import { keywordNames, STEPS, verdict } from "../src/devtools/catalog-check.js";

const step = (ok: boolean) => ({ step: "s", ok, detail: null });

describe("catalog:check verdict", () => {
  it("WORKED only with every step, every put-back and both answers yes; put back needs at least one put-back step", () => {
    expect(verdict([step(true)], [step(true)], ["y", "y"])).toMatchObject({ worked: true, putBack: true });
    expect(verdict([step(true)], [step(true)], ["y", "n"]).worked).toBe(false);
    expect(verdict([step(false)], [step(true)], ["y", "y"])).toMatchObject({ worked: false, putBack: true });
    expect(verdict([step(true)], [], ["y", "y"])).toMatchObject({ worked: false, putBack: false });
    expect(verdict([step(true)], [step(true)], ["y"]).lines).toEqual(["YES s", "YES s", "YES Jim's answer 1: y"]);
  });

  it("names the test keywords per run, so a second run in the same catalog does not meet the first run's (run 2 of CATALOG-PARITY.md)", () => {
    const a = keywordNames("2026-10-28T02-32-41-166Z");
    const b = keywordNames("2026-10-28T04-15-41-490Z");
    expect(new Set([...Object.values(a), ...Object.values(b)]).size).toBe(6);
    expect(a.caseOnly).not.toBe(a.renamed);
    expect(a.caseOnly.toLowerCase()).toBe(a.renamed.toLowerCase());
    expect(Object.values(a).every((n) => !n.includes("|"))).toBe(true);
  });

  it("has a step for each tool group of rows 1-9", () => {
    expect(STEPS.map((s) => s.step).join(" ")).toMatch(/lr_get_metadata[\s\S]*lr_list_folders[\s\S]*lr_set_color_label[\s\S]*filters[\s\S]*lr_set_iptc[\s\S]*lr_rename_keyword[\s\S]*lr_create_smart_collection[\s\S]*lr_delete_collection[\s\S]*lr_export_metadata[\s\S]*lr_set_ai_metadata/);
  });
});
