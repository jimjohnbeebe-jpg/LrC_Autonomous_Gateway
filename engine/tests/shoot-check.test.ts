// shoot-check.ts on fixture tool-log records (no Lightroom, no Claude Desktop): the records are shaped as the
// engine writes them, {ts, tool, ok, duration_ms, args, ...log} (mcp\tools-shared.ts run), with the write tools'
// per-photo `writes` (mcp\tools-catalog.ts written).

import { describe, expect, it } from "vitest";
import { evaluateShootChat, verdict, type Answers } from "../src/devtools/shoot-check.js";
import { written } from "../src/mcp/tools-catalog.js";

type Rec = Record<string, unknown>;
const A = "uuid-a";
const B = "uuid-b";
const rec = (tool: string, args: Rec, log: Rec = {}): Rec => ({ ts: "2026-10-29T10:00:00.000Z", tool, ok: true, duration_ms: 1, args, ...log });
const w = (uuid: string, before: unknown, after: unknown) => ({ uuid, before, after });
const yes: Answers = { numbers_readable: "y", proposal_first: "y", picks_sensible: "y", keywords_sensible: "y", caption_seen: "y", batch_ok: "y" };

/** A whole sitting: sheets and reads, cull, keywords, put-back, batch with two undos. */
function chain(): Rec[] {
  return [
    rec("lr_get_contact_sheet", { uuids: [A, B] }, { cells: [{ n: 1 }, { n: 2, fast_fallback: "thumbnail_failed" }] }),
    rec("lr_get_metadata", { uuids: [A, B] }),
    rec("lr_set_flag", { uuids: [A], flag: "pick" }, { writes: [w(A, "none", "pick")] }),
    rec("lr_set_flag", { uuids: [B], flag: "reject" }, { writes: [w(B, "none", "reject")] }),
    rec("lr_set_ai_metadata", { uuids: [A], reason: "sharp" }, { writes: [w(A, { score: null, reason: null }, { score: null, reason: "sharp" })] }),
    rec("lr_set_keywords", { uuids: [A], add: ["Place|Beach"] }, { writes: [w(A, ["Old"], ["Old", "Place|Beach"])] }),
    rec("lr_set_iptc", { uuids: [A], caption: "Waves" }, { writes: [w(A, { title: "", caption: "" }, { title: "", caption: "Waves" })] }),
    rec("lr_set_flag", { uuids: [A, B], flag: "none" }, { writes: [w(A, "pick", "none"), w(B, "reject", "none")] }),
    rec("lr_set_ai_metadata", { uuids: [A], reason: null }, { writes: [w(A, { score: null, reason: "sharp" }, { score: null, reason: null })] }),
    rec("lr_set_keywords", { uuids: [A], remove: ["Place|Beach"] }, { writes: [w(A, ["Place|Beach", "Old"], ["Old"])] }),
    rec("lr_set_iptc", { uuids: [A], caption: "" }, { writes: [w(A, { title: "", caption: "Waves" }, { title: "", caption: "" })] }),
    rec("lr_sync_series", { session_id: "s1", targets: "selected" }),
    rec("lr_apply_snapshot", { uuid: A }),
    rec("lr_apply_snapshot", { uuid: B }),
  ];
}

describe("shoot:check evaluation", () => {
  it("a complete cull, keyword, put-back and batch chain is WORKED, put back YES", () => {
    const e = evaluateShootChat(chain());
    expect(e.sheets).toEqual({ calls: 1, cells: 2, not_yet: 0, fallbacks: 1 });
    expect(e.writes.flag).toEqual({ calls: 3, photos: 2 });
    expect(e.unread_writes).toEqual([]);
    expect(e.put_back.every((p) => p.put_back)).toBe(true);
    expect(e.snapshots_applied).toBe(2);
    const v = verdict(e, yes);
    expect(v).toMatchObject({ worked: true, put_back: true });
  });

  it("a missing put-back is put back: NO and FAILED, naming the photo", () => {
    const records = chain().filter((r) => !(r["tool"] === "lr_set_iptc" && (r["args"] as Rec)["caption"] === ""));
    const e = evaluateShootChat(records);
    expect(e.put_back.filter((p) => !p.put_back)).toEqual([{ kind: "text", uuid: A, fields: ["caption"], before: { title: "", caption: "" }, after: { title: "", caption: "Waves" }, put_back: false }]);
    const v = verdict(e, yes);
    expect(v.worked).toBe(false);
    expect(v.put_back).toBe(false);
    expect(v.lines.join("\n")).toContain("text of uuid-a");
  });

  it("a write with no sheet or no lr_get_metadata of the photo before it is FAILED", () => {
    const records = chain().filter((r) => r["tool"] !== "lr_get_metadata");
    const e = evaluateShootChat(records);
    expect(e.unread_writes[0]).toBe("lr_set_flag wrote uuid-a with no lr_get_metadata of it before");
    expect(verdict(e, yes).worked).toBe(false);
    const late = [chain()[2] as Rec, ...chain()];
    expect(evaluateShootChat(late).unread_writes[0]).toBe("lr_set_flag wrote uuid-a with no lr_get_contact_sheet and no lr_get_metadata of it before");
  });

  it("a read-back that failed leaves the photo not put back; Jim's n is FAILED", () => {
    const records = [...chain(), rec("lr_set_flag", { uuids: [B], flag: "none" }, { writes: [{ uuid: B, before: "none" }] })];
    expect(evaluateShootChat(records).put_back.find((p) => p.uuid === B && p.kind === "flag")?.put_back).toBe(false);
    expect(verdict(evaluateShootChat(chain()), { ...yes, proposal_first: "n" }).worked).toBe(false);
  });

  it("a write stopped mid-call keeps its written photos and the maybe-written one unresolved", () => {
    const stopped = { ...rec("lr_set_flag", { uuids: [A, B], flag: "reject" }), ok: false, error: { code: "TIMEOUT", details: { written: [{ uuid: A, before: "none", after: "reject", changed: true }], failed: [], maybe_written: B, not_sent: [] } } };
    const e = evaluateShootChat([...chain(), stopped]);
    expect(e.failed_writes).toEqual([{ tool: "lr_set_flag", code: "TIMEOUT" }]);
    expect(e.put_back.filter((p) => p.kind === "flag" && !p.put_back).map((p) => p.uuid)).toEqual([A, B]);
    expect(verdict(e, yes).put_back).toBe(false);
  });

  it("a photo lr_get_metadata failed to read is not counted as read", () => {
    const records = chain().map((r) => (r["tool"] === "lr_get_metadata" ? { ...r, failed: 1, failed_uuids: [B] } : r));
    expect(evaluateShootChat(records).unread_writes).toEqual(["lr_set_flag wrote uuid-b with no lr_get_metadata of it before"]);
    const unnamed = chain().map((r) => (r["tool"] === "lr_get_metadata" ? { ...r, failed: 1 } : r));
    expect(evaluateShootChat(unnamed).unread_writes).toHaveLength(5); // flag of A and B, then A's AI, keywords and caption
  });

  it("no batch undo is FAILED", () => {
    const e = evaluateShootChat(chain().filter((r) => r["tool"] !== "lr_apply_snapshot"));
    expect(verdict(e, yes).worked).toBe(false);
  });

  it("the write tools log each photo's before and after", () => {
    const out = written({ photos: [{ uuid: A, filename: null, before: 0, after: 1, changed: true }], failed: [{ uuid: B, code: "READ_BACK_FAILED", message: "x", before: 0 }, { uuid: "c", code: "NOT_FOUND", message: "y" }] }, {});
    expect(out.log).toEqual({ changed: 1, failed: 2, writes: [{ uuid: A, before: 0, after: 1 }, { uuid: B, before: 0 }] });
  });
});
