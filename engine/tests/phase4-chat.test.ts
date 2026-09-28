// The Phase 4 chat's tool-log reader (src/devtools/phase4-chat.ts evaluateVariantsChat,
// chatSessionOk), on records shaped as the engine writes them: lr_begin_session's log record carries
// mode, target, variants and log_path (session\variants.ts runVariants), lr_step's target
// (session\step.ts), lr_select_variant's picked (session\pick.ts); a failed begin's error names
// its copies (session\copies.ts makeCopies).

import { describe, expect, it } from "vitest";
import { chatCopies, chatSessionOk, evaluateVariantsChat } from "../src/devtools/phase4-chat.js";

const begin = {
  ts: "t",
  tool: "lr_begin_session",
  ok: true,
  session_id: "s1",
  intent_id: "landscape_golden_hour",
  mode: "variants",
  target: { uuid: "M", filename: "20260907-_OZ80099.NEF" },
  log_path: "C:\\logs\\s1.json",
  variants: [
    { id: "A", uuid: "a" },
    { id: "B", uuid: "b" },
    { id: "C", uuid: "c" },
  ],
};
const step = (target?: string, session_id = "s1") => ({ ts: "t", tool: "lr_step", ok: true, session_id, ...(target ? { target } : {}) });

describe("devtools: Phase 4 chat, the tool log", () => {
  it("reads a Variants session: the copies, the passes before the pick, the pick, the passes after it, the end", () => {
    const records = [
      { ts: "t", tool: "lr_list_intents", ok: true },
      begin,
      step("A"),
      step("B"),
      { ts: "t", tool: "lr_step", ok: false, error: { code: "AWAITING_PICK" } },
      step("C"),
      { ts: "t", tool: "lr_select_variant", ok: true, session_id: "s1", picked: "B", uuid: "b" },
      step(),
      step(),
      { ts: "t", tool: "lr_end_session", ok: true, session_id: "s1", outcome: "accept" },
    ];
    const e = evaluateVariantsChat(records);
    expect(e).toMatchObject({ session_begun: true, mode: "variants", target_filename: "20260907-_OZ80099.NEF", refined_before_pick: ["A", "B", "C"], picked: "B", steps_after_pick: 2, session_ended: "accept", log_path: "C:\\logs\\s1.json" });
    expect(e.copies).toEqual(begin.variants);
    expect(e.tool_calls[4]).toMatchObject({ ok: false, error_code: "AWAITING_PICK" });
    expect(chatSessionOk(e)).toBe(true);
  });

  it("does not count a Converge session, passes of another session, or a chat that ended without a pass after the pick", () => {
    const converge = { ...begin, session_id: "s0", mode: "converge", variants: undefined };
    const records = [converge, step(undefined, "s0"), begin, step("A"), { ts: "t", tool: "lr_select_variant", ok: true, session_id: "s1", picked: "A" }, step(undefined, "s0"), { ts: "t", tool: "lr_end_session", ok: true, session_id: "s1", outcome: "accept" }];
    const e = evaluateVariantsChat(records);
    expect(e).toMatchObject({ session_id: "s1", picked: "A", steps_after_pick: 0, refined_before_pick: ["A"] });
    expect(chatSessionOk(e)).toBe(false);
  });

  it("names the copies of every Variants begin: each successful one's, a failed one's, and on no answer those asked for (Greptile, PR #37)", () => {
    const failed = { ts: "t", tool: "lr_begin_session", ok: false, error: { code: "VARIANTS_INCOMPLETE", details: { copies: [{ uuid: "x", copy_name: "AVG landscape_golden_hour A", identity_ok: true }, { identity_ok: false }] } } };
    const timedOut = { ts: "t", tool: "lr_begin_session", ok: false, error: { code: "BRIDGE_TIMEOUT", details: { names: ["AVG landscape_golden_hour A", "AVG landscape_golden_hour B"] } } };
    const second = { ...begin, session_id: "s2", variants: [{ id: "A", uuid: "a2" }] };
    const { known, unconfirmed } = chatCopies([failed, begin, timedOut, second]);
    expect(known.map((c) => c.uuid)).toEqual(["a", "b", "c", "a2", "x"]);
    expect(known[0]).toEqual({ uuid: "a", copy_name: "AVG landscape_golden_hour A" });
    expect(unconfirmed).toEqual(["AVG … (its name could not be read)", "AVG landscape_golden_hour A", "AVG landscape_golden_hour B"]);
  });

  it("judges the session that ended with accept when Claude began more than one", () => {
    const first = { ...begin, session_id: "s0" };
    const records = [first, { ts: "t", tool: "lr_end_session", ok: true, session_id: "s0", outcome: "revert" }, begin, step("A"), step("B"), step("C"), { ts: "t", tool: "lr_select_variant", ok: true, session_id: "s1", picked: "A" }, step(), { ts: "t", tool: "lr_end_session", ok: true, session_id: "s1", outcome: "accept" }];
    const e = evaluateVariantsChat(records);
    expect(e).toMatchObject({ session_id: "s1", session_ended: "accept", picked: "A" });
    expect(chatSessionOk(e)).toBe(true);
  });

  it("fails a session picked before every copy had its refined pass (the way to awaiting_pick)", () => {
    const records = [begin, step("B"), { ts: "t", tool: "lr_select_variant", ok: true, session_id: "s1", picked: "B" }, step(), { ts: "t", tool: "lr_end_session", ok: true, session_id: "s1", outcome: "accept" }];
    const e = evaluateVariantsChat(records);
    expect(e).toMatchObject({ refined_before_pick: ["B"], picked: "B", steps_after_pick: 1 });
    expect(chatSessionOk(e)).toBe(false);
  });

  it("fails a session on another photo, and reads an empty log as no session", () => {
    const other = { ...begin, target: { uuid: "X", filename: "20260907-_OZ80093.NEF" } };
    const records = [other, { ts: "t", tool: "lr_select_variant", ok: true, session_id: "s1", picked: "C" }, step(), { ts: "t", tool: "lr_end_session", ok: true, session_id: "s1", outcome: "accept" }];
    expect(chatSessionOk(evaluateVariantsChat(records))).toBe(false);
    expect(evaluateVariantsChat([])).toMatchObject({ session_begun: false, picked: null, steps_after_pick: 0, session_ended: null, copies: [] });
  });
});
