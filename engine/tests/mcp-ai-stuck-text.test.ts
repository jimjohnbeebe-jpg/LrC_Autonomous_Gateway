// GitHub issue #181: what Claude and the user are told while Lightroom's AI mask is still computing (LIGHTROOM_STUCK,
// AI_UPDATE_PENDING): src/session/ai-revert.ts stuckError, ai-update.ts pendingError, the HUD's notes, lr_create_mask,
// lr_step, lr_end_session and lr_help. The clauses: Lightroom is still computing; the session unfreezes by itself; Abort in
// the Deck, and what it does; prefer geometric masks; no overclaim of timing.

import { describe, expect, it } from "vitest";
import { HELP_TEXT } from "../src/mcp/defs-help.js";
import { MASK_DEFS } from "../src/mcp/defs-masks.js";
import { SESSION_DEFS } from "../src/mcp/defs-session.js";
import type { AiJob } from "../src/session/ai-masks.js";
import { STUCK_NOTE, stuckError } from "../src/session/ai-revert.js";
import { pendingError } from "../src/session/ai-update.js";
import { ABORT_WAITS, abandonedNote, type Session } from "../src/session/index.js";
import { hudWordProblems } from "./helpers/hud-harness.js";

const description = (name: string): string => {
  const def = [...SESSION_DEFS, ...MASK_DEFS].find((d) => d.name === name);
  if (!def) throw new Error(`no tool ${name}`);
  return def.description;
};
const SNAPSHOT = "AVG pre-session 2026-10-18T14:34:05.123Z";
const stuckSession = { id: "441ee225", snapshot: { name: SNAPSHOT }, aiPending: { kind: "landscape_water", since: "2026-10-18T14:27:04Z", stuck: true } } as unknown as Session;
const job = { kind: "landscape_water" } as AiJob;

/** The clauses every text for the stuck case carries. */
const CLAUSES = [/still computing/, /unfreezes by itself/, /no restart/i, /press Abort in the Deck/, /prefer linear or radial masks to AI masks/];

describe("the errors while an AI mask has no result", () => {
  it("LIGHTROOM_STUCK says Lightroom is still computing, that the session frees itself, what Abort does, the snapshot, and the restart as the other way", () => {
    const e = stuckError(stuckSession, job, "no result within 5 minutes, Lightroom's update running");
    expect(e.code).toBe("LIGHTROOM_STUCK");
    for (const clause of CLAUSES) expect(e.message).toMatch(clause);
    expect(e.message).toContain("it puts the photo back as it was before the session if Lightroom has finished, and otherwise ends the edit as it is");
    expect(e.message).toContain(`names the snapshot "${SNAPSHOT}" that puts it back`);
    expect(e.message).toContain("Restarting Lightroom (File > Exit, then start it again) also frees it");
    expect(e.message).toContain('lr_end_session "abandon"');
    expect(e.message).not.toMatch(/seems stuck|in a few seconds|usually|minutes? at most/);
  });

  it("AI_UPDATE_PENDING after it says the same", () => {
    const e = pendingError(stuckSession);
    expect(e.code).toBe("AI_UPDATE_PENDING");
    for (const clause of CLAUSES) expect(e.message).toMatch(clause);
    expect(e.message).toContain(`"${SNAPSHOT}"`);
  });

  it("AI_MASK_FAILED keeps the restart: Jim's decision of 2026-10-11 stands for an update that ended with no result", () => {
    const e = stuckError(stuckSession, job, "x", true);
    expect(e.code).toBe("AI_MASK_FAILED");
    expect(e.message).toMatch(/save your work and restart Lightroom/);
  });
});

describe("the HUD's notes", () => {
  it("say the AI mask is still computing, the edit resumes, and what Abort does, within 120 bytes and without engine words", () => {
    expect(STUCK_NOTE).toMatch(/^Lightroom's AI mask is still computing\./);
    expect(STUCK_NOTE).toMatch(/resumes when it is done/);
    expect(STUCK_NOTE).toMatch(/Abort puts the photo back, or leaves it as is/);
    for (const note of [STUCK_NOTE, ABORT_WAITS]) {
      expect(Buffer.byteLength(note)).toBeLessThanOrEqual(120);
      expect(hudWordProblems(note)).toEqual([]);
    }
    expect(ABORT_WAITS).not.toMatch(/restart/i);
  });

  it("an Abort that leaves the photo as it is says so, with the snapshot to click when it fits, else where to find it", () => {
    const named = abandonedNote(stuckSession, true);
    expect(named).toBe(`Photo not put back (AI mask stuck). To undo: Develop > Snapshots > "${SNAPSHOT}".`);
    const long = { snapshot: { name: SNAPSHOT }, client: { name: "x", title: "W".repeat(32), version: "1" } } as unknown as Session;
    const plain = abandonedNote(long, false);
    expect(plain).toMatch(/not put back\. To undo, click its AVG snapshot in Develop > Snapshots\.$/);
    for (const note of [named, plain]) {
      expect(Buffer.byteLength(note)).toBeLessThanOrEqual(120);
      expect(hudWordProblems(note)).toEqual([]);
    }
  });
});

describe("the tool descriptions and lr_help", () => {
  it("lr_create_mask carries the clauses, points to lr_help, and says AI_MASK_FAILED is the one that needs the restart", () => {
    const text = description("lr_create_mask");
    for (const clause of CLAUSES) expect(text).toMatch(clause);
    expect(text).toContain("(lr_help, 9, says what it does)");
    expect(text).toContain("AI_MASK_FAILED: the user should save their work and restart Lightroom");
  });

  it("lr_help has its own point on it: the time on the HUD, what Abort does and does not do, the restart as the other way", () => {
    expect(HELP_TEXT).toContain("9. An AI mask Lightroom has not finished (LIGHTROOM_STUCK, AI_UPDATE_PENDING)");
    for (const clause of CLAUSES) expect(HELP_TEXT).toMatch(clause);
    expect(HELP_TEXT).toContain("the HUD shows the time waited (m:ss)");
    expect(HELP_TEXT).toContain("says the photo was NOT put back and names the snapshot that puts it back");
    expect(HELP_TEXT).toContain("A Lightroom restart also works");
    expect(HELP_TEXT).toContain("the user saves their work and restarts Lightroom");
  });

  it("lr_step names the ai_mask_failed note and lr_end_session says abandon does not put the photo back", () => {
    expect(description("lr_step")).toContain("an `ai_mask_failed` note");
    expect(description("lr_end_session")).toContain("is NOT put back (`photo_put_back` false)");
    expect(description("lr_end_session")).toContain('so try "revert" again first');
  });
});
