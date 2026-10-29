// `npm run shoot:check` (issues #111, #112, #110): the pure parts of the Claude Desktop cull / keyword / batch chat
// check. The CLI (shoot-check-cli.ts) reads the chat's records from the tool log Claude Desktop's engine writes
// (phase2-collect.ts collectChatLogs, as phase4-chat.ts does), so it never starts an engine of its own and never
// competes with Claude Desktop's for Lightroom (issue #211, ENGINE_BUSY). From the records this file counts the
// contact sheets, follows every catalog write photo by photo (the log's `writes`, mcp\tools-catalog.ts written),
// and says whether each photo ended where it started (put back) and whether any write came before the chat had
// looked at the photo (an lr_get_contact_sheet and an lr_get_metadata naming it). Jim's y/n answers cover what the
// log cannot show: the proposal turn, the sheets' numbers, the judgement. Report: docs\reports\phase11\SHOOT-CHECK.md.

import type { Answer } from "./phase1-check.js";

type Rec = Record<string, unknown>;

/** The catalog writes the cull and keyword prompts make, by what they write. */
export const WRITE_KINDS = { lr_set_flag: "flag", lr_set_keywords: "keywords", lr_set_iptc: "text", lr_set_ai_metadata: "ai" } as const;
export type WriteKind = (typeof WRITE_KINDS)[keyof typeof WRITE_KINDS];
/** Kinds whose value is an object of fields: only the fields a call named are compared. */
const FIELDED: ReadonlySet<WriteKind> = new Set(["text", "ai"]);
export const SHEET_TOOL = "lr_get_contact_sheet";

export type PhotoPutBack = { kind: WriteKind; uuid: string; fields: string[] | null; before: unknown; after: unknown; put_back: boolean };
export type ShootChat = {
  sheets: { calls: number; cells: number; not_yet: number; fallbacks: number | null };
  writes: Record<WriteKind, { calls: number; photos: number }>;
  /** Write calls that failed, with their error code. */
  failed_writes: Array<{ tool: string; code: string }>;
  /** One line per photo a write touched first with no sheet or no lr_get_metadata of it before. */
  unread_writes: string[];
  put_back: PhotoPutBack[];
  sync_series: number;
  /** lr_apply_snapshot calls after the first lr_sync_series (the batch's undo of single photos). */
  snapshots_applied: number;
};

const args = (r: Rec): Rec => (r["args"] && typeof r["args"] === "object" ? (r["args"] as Rec) : {});
const uuidsOf = (r: Rec): string[] => {
  const u = args(r)["uuids"];
  return Array.isArray(u) ? u.filter((x): x is string => typeof x === "string") : [];
};
const isOk = (r: Rec, tool: string): boolean => r["tool"] === tool && r["ok"] === true;
const countOf = (v: unknown): number => (Array.isArray(v) ? v.length : typeof v === "number" ? v : 0);

/** A value as compared: none, null and "" are the same; a list in any order. */
function norm(v: unknown): string {
  if (v === undefined || v === null || v === "") return "";
  if (Array.isArray(v)) return JSON.stringify(v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).sort());
  return JSON.stringify(v);
}
const field = (v: unknown, f: string): unknown => (v && typeof v === "object" ? (v as Rec)[f] : undefined);

type Track = { kind: WriteKind; uuid: string; first: unknown; last: unknown; known: boolean; fields: Set<string> };

/** The photos an lr_get_metadata call read: its uuids less the logged `failed_uuids`; none when it failed some and names none. */
function metadataRead(r: Rec): string[] {
  const failed = Array.isArray(r["failed_uuids"]) ? new Set(r["failed_uuids"] as unknown[]) : null;
  if (!failed) return countOf(r["failed"]) > 0 ? [] : uuidsOf(r);
  return uuidsOf(r).filter((u) => !failed.has(u));
}

/**
 * A write call's per-photo entries. A finished call logs `writes`. A call stopped because Lightroom no longer answered
 * (library\write.ts stopped) logs, in its error's details, the photos written before (`written`), the failures, and
 * the photo Lightroom may still have written (`maybe_written`): that one has a `before` of unknown value and no `after`,
 * so it never counts as put back by this call (Greptile, PR #268).
 */
function writesOf(r: Rec): Rec[] {
  if (r["ok"] === true) return Array.isArray(r["writes"]) ? (r["writes"] as Rec[]) : [];
  const d = field(r["error"], "details");
  const list = (k: string): Rec[] => (Array.isArray(field(d, k)) ? (field(d, k) as Rec[]) : []);
  const maybe = field(d, "maybe_written");
  return [
    ...list("written").map((p) => ({ uuid: p["uuid"], before: p["before"], after: p["after"] })),
    ...list("failed").filter((f) => "before" in f).map((f) => ({ uuid: f["uuid"], before: f["before"], ...("after" in f ? { after: f["after"] } : {}) })),
    ...(typeof maybe === "string" ? [{ uuid: maybe }] : []),
  ];
}

function sheets(records: readonly Rec[]): ShootChat["sheets"] {
  const calls = records.filter((r) => isOk(r, SHEET_TOOL));
  const fallbacksOf = (r: Rec): number | null =>
    Array.isArray(r["cells"]) ? (r["cells"] as Rec[]).filter((c) => c && c["fast_fallback"]).length : typeof r["fallbacks"] === "number" ? r["fallbacks"] : null;
  const fb = calls.map(fallbacksOf);
  return {
    calls: calls.length,
    cells: calls.reduce((n, r) => n + uuidsOf(r).length - countOf(r["not_yet"]), 0),
    not_yet: calls.reduce((n, r) => n + countOf(r["not_yet"]), 0),
    fallbacks: fb.length > 0 && fb.every((x) => x !== null) ? fb.reduce((n: number, x) => n + (x ?? 0), 0) : null,
  };
}

/** What the chat's tool log shows of the cull, keyword and batch chats. */
export function evaluateShootChat(records: readonly Rec[]): ShootChat {
  const tracks = new Map<string, Track>();
  const writes = Object.fromEntries(Object.values(WRITE_KINDS).map((k) => [k, { calls: 0, photos: 0 }])) as ShootChat["writes"];
  const failed_writes: ShootChat["failed_writes"] = [];
  const unread_writes: string[] = [];
  const seen = { sheet: new Set<string>(), metadata: new Set<string>() };
  let syncAt = -1;
  let snapshots_applied = 0;
  for (const [i, r] of records.entries()) {
    if (isOk(r, SHEET_TOOL)) for (const u of uuidsOf(r)) seen.sheet.add(u);
    if (isOk(r, "lr_get_metadata")) for (const u of metadataRead(r)) seen.metadata.add(u);
    if (isOk(r, "lr_sync_series") && syncAt < 0) syncAt = i;
    if (isOk(r, "lr_apply_snapshot") && syncAt >= 0) snapshots_applied++;
    const kind = WRITE_KINDS[r["tool"] as keyof typeof WRITE_KINDS] as WriteKind | undefined;
    if (!kind || (r["ok"] !== true && r["ok"] !== false)) continue;
    if (r["ok"] === true) writes[kind].calls++;
    else failed_writes.push({ tool: String(r["tool"]), code: String(field(r["error"], "code") ?? "unknown") });
    const named = FIELDED.has(kind) ? Object.keys(args(r)).filter((k) => k !== "uuids") : [];
    for (const w of writesOf(r)) {
      const uuid = String(w["uuid"]);
      const key = `${kind}:${uuid}`;
      const t = tracks.get(key);
      if (!t) {
        const missing = [...(seen.sheet.has(uuid) ? [] : [SHEET_TOOL]), ...(seen.metadata.has(uuid) ? [] : ["lr_get_metadata"])];
        if (missing.length > 0) unread_writes.push(`${String(r["tool"])} wrote ${uuid} with no ${missing.join(" and no ")} of it before`);
        tracks.set(key, { kind, uuid, first: w["before"], last: w["after"], known: "after" in w, fields: new Set(named) });
      } else {
        Object.assign(t, { last: w["after"], known: "after" in w });
        for (const f of named) t.fields.add(f);
      }
    }
  }
  const put_back = [...tracks.values()].map((t): PhotoPutBack => {
    const fields = FIELDED.has(t.kind) ? [...t.fields].sort() : null;
    const same = fields ? fields.every((f) => norm(field(t.first, f)) === norm(field(t.last, f))) : norm(t.first) === norm(t.last);
    return { kind: t.kind, uuid: t.uuid, fields, before: t.first, after: t.known ? t.last : null, put_back: t.known && same };
  });
  for (const k of Object.values(WRITE_KINDS)) writes[k].photos = put_back.filter((p) => p.kind === k).length;
  return { sheets: sheets(records), writes, failed_writes, unread_writes, put_back, sync_series: records.filter((r) => isOk(r, "lr_sync_series")).length, snapshots_applied };
}

/** Jim's answers in the PowerShell window, in the order the CLI asks them. */
export const QUESTIONS = {
  numbers_readable: "Could you read the numbers on the contact sheets, and did each number match its photo?",
  proposal_first: "Before each change (flags, keywords, captions, the batch), did Claude show its table and wait for your yes?",
  picks_sensible: "Were the picks and rejects sensible (sharp, eyes open, one pick per burst)?",
  keywords_sensible: "Were the keywords, titles and captions sensible for the photos?",
  caption_seen: "Before the put-back, did Library's Metadata panel show the caption Claude wrote?",
  batch_ok: "Did the batch photos take the hero's look, and did the two you asked Claude to undo go back?",
} as const;
export type Answers = Record<keyof typeof QUESTIONS, Answer>;

/** The headline, put back, and one line per condition (the reasons for a FAILED). */
export function verdict(e: ShootChat, a: Answers): { worked: boolean; put_back: boolean; lines: string[] } {
  const away = e.put_back.filter((p) => !p.put_back);
  const put_back = away.length === 0;
  const checks: Array<[boolean, string]> = [
    [e.sheets.calls > 0, `contact sheets: ${e.sheets.calls} (${e.sheets.cells} cells, ${e.sheets.not_yet} left for a later call, fallbacks ${e.sheets.fallbacks ?? "not in the log"})`],
    [e.writes.flag.photos > 0, `cull: lr_set_flag ${e.writes.flag.calls} call(s) on ${e.writes.flag.photos} photo(s); lr_set_ai_metadata on ${e.writes.ai.photos}`],
    [e.writes.keywords.photos > 0 && e.writes.text.photos > 0, `keywords: lr_set_keywords on ${e.writes.keywords.photos} photo(s), lr_set_iptc on ${e.writes.text.photos}`],
    [e.unread_writes.length === 0, `every photo looked at (sheet + lr_get_metadata) before its first write${e.unread_writes.length > 0 ? `: NO, ${e.unread_writes.slice(0, 5).join("; ")}` : ""}`],
    [put_back, `every write put back: ${put_back ? "YES" : `NO, ${away.slice(0, 5).map((p) => `${p.kind} of ${p.uuid}`).join(", ")}${away.length > 5 ? ` and ${away.length - 5} more` : ""}`}`],
    [e.failed_writes.length === 0, `failed write calls: ${e.failed_writes.length === 0 ? "none" : e.failed_writes.map((f) => `${f.tool} ${f.code}`).join(", ")}`],
    [e.sync_series > 0 && e.snapshots_applied >= 2, `batch: lr_sync_series ${e.sync_series} call(s), lr_apply_snapshot after it ${e.snapshots_applied} (2 needed)`],
    ...(Object.keys(QUESTIONS) as Array<keyof typeof QUESTIONS>).map((k): [boolean, string] => [a[k] === "y", `Jim, ${k}: ${a[k]}`]),
  ];
  return { worked: checks.every(([ok]) => ok), put_back, lines: checks.map(([ok, line]) => `${ok ? "OK  " : "NO  "} ${line}`) };
}
