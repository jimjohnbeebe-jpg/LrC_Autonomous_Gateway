// GitHub issue #181: what Claude and the user are told while Lightroom's AI mask is still computing (LIGHTROOM_STUCK,
// AI_UPDATE_PENDING): src/session/ai-revert.ts stuckError, ai-update.ts pendingError, the HUD's notes, lr_create_mask,
// lr_step, lr_end_session and lr_help. The clauses: Lightroom is still computing; the session goes on when Lightroom's result shows (D16: nothing else frees it); Abort in
// the Deck, and what it does; prefer geometric masks; no overclaim of timing.

import { describe, expect, it } from "vitest";
import { HELP_TEXT } from "../src/mcp/defs-help.js";
import { MASK_DEFS } from "../src/mcp/defs-masks.js";
import { SESSION_DEFS } from "../src/mcp/defs-session.js";
import type { AiJob } from "../src/session/ai-masks.js";
import { STUCK_NOTE, stuckError } from "../src/session/ai-revert.js";
import { pendingError } from "../src/session/ai-update.js";
import { ABORT_AI, abandonedNote, type Session } from "../src/session/index.js";
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
const CLAUSES = [/still computing/, /result shows/, /press Abort in the Deck/, /prefer linear or radial masks to AI masks/, /does not notify/, /not the same AI mask again/];

describe("the errors while an AI mask has no result", () => {
  it("LIGHTROOM_STUCK says Lightroom is still computing, that the session goes on when the result shows, what Abort does, the snapshot, and the restart as the other way", () => {
    const e = stuckError(stuckSession, job, "no result within 5 minutes, Lightroom's update running");
    expect(e.code).toBe("LIGHTROOM_STUCK");
    for (const clause of CLAUSES) expect(e.message).toMatch(clause);
    expect(e.message).toContain("it puts the photo back as it was before the session if Lightroom's result has shown, and otherwise ends the edit as it is, the photo NOT put back,");
    expect(e.message).toContain(`names the snapshot "${SNAPSHOT}" that puts it back`);
    expect(e.message).toContain("Restarting Lightroom (File > Exit, then start it again) also ends the wait");
    expect(e.message).toContain('lr_end_session "abandon"');
    expect(e.message).not.toMatch(/seems stuck|in a few seconds|usually|minutes? at most|unfreez|frees? itself|no restart/i);
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
  it("say the AI mask is still computing, that the user asks the AI to go on (nothing polls), and the other ways out, within 120 bytes and without engine words", () => {
    expect(STUCK_NOTE).toMatch(/^Lightroom's AI mask is still computing\./);
    expect(STUCK_NOTE).toMatch(/When done, ask the AI to go on/);
    expect(STUCK_NOTE).toMatch(/Abort leaves it as is; a restart puts it back/);
    expect(STUCK_NOTE).not.toMatch(/resumes/);
    for (const note of [STUCK_NOTE, ABORT_AI]) {
      expect(Buffer.byteLength(note)).toBeLessThanOrEqual(120);
      expect(hudWordProblems(note)).toEqual([]);
    }
    expect(ABORT_AI).not.toMatch(/must wait|restart/i);
  });

  it("an Abort that leaves the photo as it is says so, with the snapshot to click when it fits, else where to find it", () => {
    const named = abandonedNote(stuckSession, true);
    expect(named).toBe(`Photo not put back (AI mask unfinished). To undo: Develop > Snapshots > "${SNAPSHOT}".`);
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
    expect(text).toContain("the call waits up to 5 minutes; the Deck's Abort ends the wait: SESSION_ENDED"); // issue #181, decision 2
    expect(text).toContain("AI_MASK_FAILED: the user should save their work and restart Lightroom");
  });

  it("lr_help has its own point on it: the time on the HUD, what Abort does and does not do, the restart as the other way", () => {
    expect(HELP_TEXT).toContain("9. An AI mask Lightroom has not finished (LIGHTROOM_STUCK, AI_UPDATE_PENDING)");
    for (const clause of CLAUSES) expect(HELP_TEXT).toMatch(clause);
    expect(HELP_TEXT).toContain("the HUD shows the time waited (m:ss)");
    expect(HELP_TEXT).toContain("These errors say recoverable false, but they end when Lightroom's result shows: the session then goes on; nothing else frees it");
    expect(HELP_TEXT).toContain("says the photo was NOT put back and names the snapshot that puts it back");
    expect(HELP_TEXT).toContain("Abort also works during lr_create_mask's wait (up to 5 minutes): the wait ends within a few seconds and the call fails with SESSION_ENDED");
    expect(HELP_TEXT).toContain("A Lightroom restart also works");
    expect(HELP_TEXT).toContain("the user saves their work and restarts Lightroom");
  });

  it("no description names an ai_mask_failed note or a session that frees itself, and lr_end_session says abandon does not put the photo back", () => {
    for (const text of [description("lr_step"), description("lr_create_mask"), description("lr_end_session"), HELP_TEXT]) expect(text).not.toMatch(/ai_mask_failed|[Uu]nfreez|frees? itself|by themselves|[Nn]o restart/);
    expect(description("lr_end_session")).toContain("is NOT put back (`photo_put_back` false)");
    expect(description("lr_end_session")).toContain('so try "revert" again first');
  });
});
