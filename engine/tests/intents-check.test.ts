// The pure parts of `npm run intents:check` (issue #180; src/devtools/intents-check.ts).

import { describe, expect, it } from "vitest";
import { CHAT_PROMPT, PAINTED_HILLS, TEST_ID, describeFindings, judge, withoutTestLine, type Findings, type Place } from "../src/devtools/intents-check.js";
import { INTENT_ID_PATTERN } from "../src/intents/index.js";

const place = (kind: Place["kind"], ids: string[], exists = true): Place => ({ kind, dir: `C:\\${kind}`, exists, ids });
const findings = (target: string[], real: string[], pkg: string[], marker: string | null = null): Findings => ({
  target: place("new", target),
  old: [place("real", real), place("package", pkg)],
  marker,
});

describe("intents:check", () => {
  it("asks for an intent id the engine accepts", () => {
    expect(INTENT_ID_PATTERN.test(TEST_ID)).toBe(true);
    expect(CHAT_PROMPT).toContain(`id "${TEST_ID}"`);
  });

  it("asks to replace a copy the migration may have made, and does not ask Jim to relay output", () => {
    expect(CHAT_PROMPT).toContain("replace true");
    const lines = [...describeFindings(findings(["mine"], ["gone"], [])), judge(findings([], [], [])).headline];
    expect(lines.join("\n")).not.toMatch(/Tell Claude Code/);
  });

  it("works when the test intent is in the new folder", () => {
    expect(judge(findings([TEST_ID], [], []))).toMatchObject({ worked: true, headline: expect.stringMatching(/^WORKED: avg_check_180\.json is in C:\\new/) });
  });

  it("fails when it is only in the Claude package, only in the real old folder, or nowhere, and says which", () => {
    expect(judge(findings([], [], [TEST_ID]))).toMatchObject({ worked: false, headline: expect.stringMatching(/^FAILED: .* only in C:\\package, inside Claude Desktop's package/) });
    expect(judge(findings([], [TEST_ID], []))).toMatchObject({ worked: false, headline: expect.stringMatching(/^FAILED: .* old folder C:\\real/) });
    expect(judge(findings([], [], []))).toMatchObject({ worked: false, headline: expect.stringMatching(/^FAILED: .* is nowhere/) });
  });

  it("does not count a copy that the migration made from an old folder", () => {
    const copied = `Copied by LrC-AVG.\n${TEST_ID}.json <- C:\\real\n`;
    expect(judge(findings([TEST_ID], [TEST_ID], [], copied)).worked).toBe(false);
    expect(judge(findings([TEST_ID], [], [], "Copied by LrC-AVG.\nother.json <- C:\\real\n")).worked).toBe(true);
    expect(judge(findings([TEST_ID], [], [], copied)).headline).toMatch(/^FAILED: .* was copied there from an old folder/);
  });

  it("works again after a re-save once the marker line of a deleted copy is taken out", () => {
    const marker = `Looked at the older folders.\nother.json <- C:\\real\n${TEST_ID}.json <- C:\\package\n`;
    expect(judge(findings([TEST_ID], [], [], marker)).worked).toBe(false);
    expect(withoutTestLine(marker)).toBe("Looked at the older folders.\nother.json <- C:\\real\n");
    expect(judge(findings([TEST_ID], [], [], withoutTestLine(marker))).worked).toBe(true);
    expect(withoutTestLine("Looked at the older folders.\n")).toBe("Looked at the older folders.\n");
  });

  it("lists every place, painted_hills_crimson_gold, what the new folder lacks and the marker", () => {
    const text = describeFindings({ ...findings(["mine"], ["a", PAINTED_HILLS], ["a"], "Copied.\na.json <- C:\\real\n"), old: [place("real", ["a", PAINTED_HILLS]), place("package", ["a"], false)] }).join("\n");
    expect(text).toContain("New folder (Documents): C:\\new\n    mine");
    expect(text).toContain("Old folder (real AppData): C:\\real\n    a, painted_hills_crimson_gold");
    expect(text).toContain("Old folder (Claude package): C:\\package\n    (the folder does not exist)");
    expect(text).toContain("painted_hills_crimson_gold.json: found in C:\\real");
    expect(text).toContain("In an old folder but not in the new one: a, painted_hills_crimson_gold.");
    expect(text).toContain("Migration marker:\n    Copied.\n    a.json <- C:\\real");
  });

  it("says so when nothing is missing, and when there is no marker", () => {
    const text = describeFindings(findings(["a"], ["a"], [])).join("\n");
    expect(text).toContain("painted_hills_crimson_gold.json: not in any of them");
    expect(text).toContain("Every intent of the old folders is in the new one");
    expect(text).toContain("Migration marker: none");
  });
});
