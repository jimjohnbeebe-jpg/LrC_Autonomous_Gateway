import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEV_ID, PRODUCT_ID, PRODUCT_NAME, productInfoLua } from "../src/setup/plugin-id.js";

const repoInfo = readFileSync(fileURLToPath(new URL("../../plugin/LrC-AVG.lrplugin/Info.lua", import.meta.url)), "utf8");

describe("the setup's plugin ID", () => {
  it("turns the repo's dev Info.lua into the product's ID and name", () => {
    const out = productInfoLua(repoInfo);
    expect(out).toContain(`LrToolkitIdentifier = '${PRODUCT_ID}'`);
    expect(out).toContain(`LrPluginName = "${PRODUCT_NAME}"`);
    expect(out).not.toContain(DEV_ID);
  });

  it("refuses an Info.lua without the dev ID, so a missed swap fails the build", () => {
    expect(() => productInfoLua(productInfoLua(repoInfo))).toThrow(/exactly once/);
  });
});
