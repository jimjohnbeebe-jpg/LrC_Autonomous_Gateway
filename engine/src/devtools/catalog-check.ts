// `npm run catalog:check` (GitHub issue #218): issue #218's tools against Lightroom, through the Tools class as Claude
// calls them. The steps, the put-back and the verdict; the CLI (catalog-check-cli.ts) connects and asks Jim.
// Report: docs\reports\phase11\CATALOG-PARITY.md. Every step works on the one photo selected in Lightroom (in a
// throwaway or copied catalog) and on names that start with "AVG catalog check"; putBack() puts the photo's label,
// text fields and keywords back and deletes the two collections the check made. The test keywords stay in the
// catalog's Keyword List: no SDK call deletes a keyword [handle: plugin\LrC-AVG.lrplugin\KeywordEdit.lua header].

import type { Tools } from "../mcp/index.js";
import { addToCollection, createCollection, createSmartCollection, deleteCollection } from "../mcp/tools-collections.js";
import { listFolders } from "../mcp/tools-catalog.js";
import { exportMetadata } from "../mcp/tools-export-metadata.js";
import { removeKeywordSubtree, renameKeyword } from "../mcp/tools-keywords.js";
import { setColorLabel } from "../mcp/tools-metadata.js";
import { getAiMetadata, setAiMetadata } from "../mcp/tools-ai-metadata.js";

export const PREFIX = "AVG catalog check";
const ROOT = `${PREFIX} kw`;
/** The text fields written and put back (lr_set_iptc names). */
export const TEXT = { creator: "AVG check creator", copyright: "AVG check copyright", sublocation: "AVG Pike Place", city: "Seattle", state: "WA", country: "United States", iso_country_code: "USA" };

export type Taken = { label?: string; text?: Record<string, string>; keywords?: string[]; collections: Set<number>; ai?: { score: number | null; reason: string | null } };
export type CheckCtx = { tools: Tools; uuid: string; dir: string; taken: Taken };
export type Step = { step: string; ok: boolean; detail: unknown };
type CheckStep = { step: string; run: (c: CheckCtx) => Promise<{ ok: boolean; detail: unknown }> };

const json = (out: { json: Record<string, unknown> }): Record<string, unknown> => out.json;
const first = (out: { json: Record<string, unknown> }): Record<string, unknown> => ((out.json["photos"] as Array<Record<string, unknown>>)[0] ?? {});
const found = async (c: CheckCtx, args: Parameters<Tools["searchPhotos"]>[0]): Promise<{ count: number; has: boolean }> => {
  const out = json(await c.tools.searchPhotos({ ...args, limit: 500 }));
  return { count: out["count"] as number, has: (out["photos"] as Array<{ uuid: unknown }>).some((p) => p.uuid === c.uuid) };
};

async function readBefore(c: CheckCtx) {
  const p = first(await c.tools.getMetadata({ uuids: [c.uuid] }));
  c.taken.label = p["label"] as string;
  c.taken.text = Object.fromEntries(Object.keys(TEXT).map((k) => [k, String(p[k] ?? "")]));
  c.taken.keywords = p["keywords"] as string[];
  // copy_name only on a virtual copy; run 1's master photo had none, and the missing key went unrecorded.
  const missing = ["label", "creator", "sublocation", "rating", ...(p["virtual_copy"] === true ? ["copy_name"] : [])].filter((k) => !(k in p));
  return { ok: missing.length === 0, detail: { missing, label: p["label"], text: c.taken.text, keywords: p["keywords"], copy_name: p["copy_name"], stack: p["stack"], alt_text: p["alt_text"] ?? "(not read: Lightroom before 13.2?)" } };
}

async function label(c: CheckCtx) {
  const want = c.taken.label === "red" ? "green" : "red";
  const out = json(await c.tools.call(setColorLabel, { uuids: [c.uuid], label: want }));
  const search = await found(c, { color_label: want });
  return { ok: out["changed"] === 1 && search.has, detail: { written: out, search_by_label: search } };
}

async function filters(c: CheckCtx) {
  const counts: Record<string, unknown> = {};
  for (const [name, args] of Object.entries({
    flag_none: { flag: "none" },
    edited_true: { edited: true },
    edited_false: { edited: false },
    camera_none: { camera: "LrC-AVG no such camera" },
    lens_none: { lens: "LrC-AVG no such lens" },
    iso_1: { iso: 1 },
    focal_length_1: { focal_length: 1 },
    file_type_dng: { file_type: "DNG" },
    file_type_raw: { file_type: "RAW" },
  } as const)) {
    counts[name] = await found(c, args).catch((err: unknown) => ({ error: String((err as Error).message) }));
  }
  const edited = counts["edited_true"] as { has?: boolean };
  const unedited = counts["edited_false"] as { has?: boolean };
  const none = ["camera_none", "lens_none", "iso_1", "focal_length_1"].every((k) => (counts[k] as { count?: number }).count === 0);
  return { ok: none && edited.has !== unedited.has, detail: counts };
}

async function text(c: CheckCtx) {
  const out = await c.tools.setIptc({ uuids: [c.uuid], ...TEXT });
  const failed = json(out)["failed"] as unknown[];
  return { ok: failed.length === 0, detail: json(out) };
}

async function keywords(c: CheckCtx) {
  await c.tools.setKeywords({ uuids: [c.uuid], add: [`${ROOT}|Child`] });
  const renamed = json(await c.tools.call(renameKeyword, { path: `${ROOT}|Child`, new_name: "Child renamed" }));
  const caseOnly = json(await c.tools.call(renameKeyword, { path: `${ROOT}|Child renamed`, new_name: "child renamed" }));
  const removed = json(await c.tools.call(removeKeywordSubtree, { path: ROOT, uuids: [c.uuid] }));
  const after = first(await c.tools.getMetadata({ uuids: [c.uuid] }))["keywords"] as string[];
  const ok = renamed["after"] === `${ROOT}|Child renamed` && caseOnly["after"] === `${ROOT}|child renamed` && !after.some((k) => k.startsWith(ROOT));
  return { ok, detail: { renamed, case_only: caseOnly, removed, keywords_after: after } };
}

async function smart(c: CheckCtx) {
  const want = c.taken.label === "red" ? "green" : "red";
  const made = json(await c.tools.call(createSmartCollection, { name: `${PREFIX} smart`, color_label: want }));
  c.taken.collections.add(made["id"] as number);
  const members = await found(c, { collection: `${PREFIX} smart` });
  const deleted = json(await c.tools.call(deleteCollection, { collection_id: made["id"] as number, confirm: true }));
  if (deleted["deleted"] === true) c.taken.collections.delete(made["id"] as number);
  return { ok: members.has && deleted["deleted"] === true && (deleted["before"] as { smart?: boolean }).smart === true, detail: { made, members, deleted } };
}

async function regular(c: CheckCtx) {
  const made = json(await c.tools.call(createCollection, { name: PREFIX }));
  // A collection of that name already there (created: false) is someone's: never changed or deleted (PR #231 review).
  if (made["created"] !== true) return { ok: false, detail: { made, refused: `a collection named "${PREFIX}" already exists; remove or rename it in Lightroom, then run again` } };
  c.taken.collections.add(made["id"] as number);
  await c.tools.call(addToCollection, { collection_id: made["id"] as number, uuids: [c.uuid] });
  const deleted = json(await c.tools.call(deleteCollection, { collection_id: made["id"] as number, confirm: true }));
  if (deleted["deleted"] === true) c.taken.collections.delete(made["id"] as number);
  const members = (deleted["before"] as { member_uuids?: string[] }).member_uuids ?? [];
  return { ok: deleted["deleted"] === true && members.includes(c.uuid), detail: { made, deleted } };
}

async function folders(c: CheckCtx) {
  const out = json(await c.tools.call(listFolders, { limit: 5 }));
  return { ok: (out["count"] as number) > 0, detail: out };
}

async function exported(c: CheckCtx) {
  const out = json(await c.tools.call(exportMetadata, { uuids: [c.uuid], folder: c.dir }));
  return { ok: out["exported"] === 1 && typeof out["file"] === "string", detail: out };
}

/** Row 9: a score and reason in the plugin's private metadata, read back; the earlier values kept for the put-back. */
async function aiMetadata(c: CheckCtx) {
  const before = first(await c.tools.call(getAiMetadata, { uuids: [c.uuid] }));
  c.taken.ai = { score: (before["score"] as number | null) ?? null, reason: (before["reason"] as string | null) ?? null };
  const out = json(await c.tools.call(setAiMetadata, { uuids: [c.uuid], score: 42, reason: PREFIX }));
  const after = first(await c.tools.call(getAiMetadata, { uuids: [c.uuid] }));
  return { ok: after["score"] === 42 && after["reason"] === PREFIX, detail: { before, written: out, after } };
}

/** The steps in order; each runs whether the one before worked or not (a step that throws is a NO). */
export const STEPS: CheckStep[] = [
  { step: "lr_get_metadata reads label, the new text fields, rating and copy name", run: readBefore },
  { step: "lr_list_folders lists the catalog's folders", run: folders },
  { step: "lr_set_color_label writes a label and lr_search_photos finds it", run: label },
  { step: "lr_search_photos' new filters answer (no-such camera, lens, ISO 1, 1 mm find nothing; edited true/false split)", run: filters },
  { step: "lr_set_iptc writes creator, copyright and the location fields", run: text },
  { step: "lr_rename_keyword (and a case-only rename), lr_remove_keyword_subtree", run: keywords },
  { step: "lr_create_smart_collection, its members by name, lr_delete_collection", run: smart },
  { step: "lr_delete_collection by name gives back its member uuids", run: regular },
  { step: "lr_export_metadata writes a JSON file", run: exported },
  { step: "lr_set_ai_metadata keeps a score and reason, lr_get_ai_metadata reads them", run: aiMetadata },
];

export async function runSteps(c: CheckCtx, say: (l: string) => void): Promise<Step[]> {
  const out: Step[] = [];
  for (const s of STEPS) {
    say(`${s.step} ...`);
    const r = await s.run(c).catch((err: unknown) => ({ ok: false, detail: { error: (err as Error).message } }));
    out.push({ step: s.step, ...r });
  }
  return out;
}

/** The photo's label and text fields as read before, collections the check left; each a step of its own. */
export async function putBack(c: CheckCtx): Promise<Step[]> {
  const out: Step[] = [];
  const attempt = async (step: string, fn: () => Promise<boolean>): Promise<void> => {
    out.push({ step, ...(await fn().then((ok) => ({ ok, detail: null }), (err: unknown) => ({ ok: false, detail: (err as Error).message })))});
  };
  if (c.taken.label !== undefined) await attempt("label put back", async () => (json(await c.tools.call(setColorLabel, { uuids: [c.uuid], label: c.taken.label as "none" }))["failed"] as unknown[]).length === 0);
  const ai = c.taken.ai;
  if (ai !== undefined) await attempt("AI score and reason put back", async () => (json(await c.tools.call(setAiMetadata, { uuids: [c.uuid], ...ai }))["failed"] as unknown[]).length === 0);
  if (c.taken.text !== undefined) await attempt("text fields put back", async () => ((json(await c.tools.setIptc({ uuids: [c.uuid], ...c.taken.text })))["failed"] as unknown[]).length === 0);
  const now = (await c.tools.getMetadata({ uuids: [c.uuid] }).then(first, (): Record<string, unknown> => ({})))["keywords"] as string[] | undefined;
  if (now?.some((k) => k.startsWith(ROOT))) await attempt("test keywords taken off", async () => (json(await c.tools.call(removeKeywordSubtree, { path: ROOT, uuids: [c.uuid] }))["failed"] as unknown[]).length === 0);
  for (const id of [...c.taken.collections]) await attempt(`collection ${id} deleted`, async () => json(await c.tools.call(deleteCollection, { collection_id: id, confirm: true }))["deleted"] === true);
  await attempt("the photo reads as before", async () => {
    const p = first(await c.tools.getMetadata({ uuids: [c.uuid] }));
    return p["label"] === c.taken.label && Object.entries(c.taken.text ?? {}).every(([k, v]) => p[k] === v) && JSON.stringify(p["keywords"]) === JSON.stringify(c.taken.keywords);
  });
  return out;
}

export function verdict(steps: Step[], back: Step[], answers: string[]): { worked: boolean; putBack: boolean; lines: string[] } {
  const yes = (ok: boolean): string => (ok ? "YES" : "NO ");
  const lines = [...steps, ...back].map((s) => `${yes(s.ok)} ${s.step}`);
  for (const [i, a] of answers.entries()) lines.push(`${yes(a === "y")} Jim's answer ${i + 1}: ${a}`);
  const putBackOk = back.length > 0 && back.every((s) => s.ok);
  return { worked: steps.every((s) => s.ok) && putBackOk && answers.every((a) => a === "y"), putBack: putBackOk, lines };
}
