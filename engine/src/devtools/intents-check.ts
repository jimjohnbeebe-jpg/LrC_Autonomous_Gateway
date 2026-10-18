// The parts of `npm run intents:check` (issue #180) that need no disk: what the check asks Claude Desktop
// to save, and how the three places an intent can now be are judged and described.

export const TEST_ID = "avg_check_180";
export const PAINTED_HILLS = "painted_hills_crimson_gold";

/** What Jim says to Claude Desktop; the engine on this branch must be the one it runs (the report's steps). `replace true` lets a second save pass over a copy the migration made. */
export const CHAT_PROMPT =
  `Use lr_save_intent to save this intent. I approve it: schema_version 2, id "${TEST_ID}", label "LrC-AVG check 180", category "test", ` +
  `brief "Temporary intent for the issue 180 folder check", priors {}, replace true. Then show me the intents_folder part of the result: path, real_path, from and virtualized.`;

/** One folder and the intents in it (file names without .json); `kind` says which of the three places it is. */
export type Place = { kind: "new" | "real" | "package"; dir: string; exists: boolean; ids: string[] };
export type Findings = { target: Place; old: Place[]; marker: string | null };
export type Verdict = { worked: boolean; headline: string };

const holds = (p: Place, id: string): boolean => p.ids.includes(id);
const COPIED = `${TEST_ID}.json <- `;

/** The marker without the line that names the test intent, for after the check deleted the file: a later save must not be judged by a copy that is gone. */
export function withoutTestLine(marker: string): string {
  return marker
    .split("\n")
    .filter((line) => !line.startsWith(COPIED))
    .join("\n");
}

/** WORKED when the test intent is in the new folder and was not copied there from an old one (the marker says); else FAILED, saying where it is instead. */
export function judge(f: Findings): Verdict {
  if (holds(f.target, TEST_ID) && !f.marker?.includes(COPIED)) return { worked: true, headline: `WORKED: ${TEST_ID}.json is in ${f.target.dir}, the intents folder in Documents.` };
  const packaged = f.old.find((p) => p.kind === "package" && holds(p, TEST_ID));
  if (packaged) return { worked: false, headline: `FAILED: ${TEST_ID}.json is only in ${packaged.dir}, inside Claude Desktop's package: the engine is still virtualized, or it is not this branch's engine.` };
  const real = f.old.find((p) => p.kind === "real" && holds(p, TEST_ID));
  if (real) return { worked: false, headline: `FAILED: ${TEST_ID}.json is in the old folder ${real.dir}, not in ${f.target.dir}: the engine Claude Desktop runs is not this branch's.` };
  if (holds(f.target, TEST_ID)) return { worked: false, headline: `FAILED: ${TEST_ID}.json in ${f.target.dir} was copied there from an old folder (the marker says), so another engine than this branch's saved it. Ask Claude Desktop to save it again, as the steps say, then run this again.` };
  return { worked: false, headline: `FAILED: ${TEST_ID}.json is nowhere. Ask Claude Desktop to save it first, as the steps say, then run this again.` };
}

const KIND_LABEL: Record<Place["kind"], string> = { new: "New folder (Documents)", real: "Old folder (real AppData)", package: "Old folder (Claude package)" };

function describePlace(p: Place): string {
  const ids = !p.exists ? "(the folder does not exist)" : p.ids.length > 0 ? p.ids.join(", ") : "(no intents)";
  return `${KIND_LABEL[p.kind]}: ${p.dir}\n    ${ids}`;
}

/** The lines the check prints before its headline: each place, painted_hills_crimson_gold, what the migration has not brought over, and the marker. */
export function describeFindings(f: Findings): string[] {
  const places = [f.target, ...f.old];
  const hills = places.filter((p) => holds(p, PAINTED_HILLS));
  const missing = [...new Set(f.old.flatMap((p) => p.ids))].filter((id) => !holds(f.target, id)).sort();
  return [
    ...places.map(describePlace),
    `${PAINTED_HILLS}.json: ${hills.length > 0 ? `found in ${hills.map((p) => p.dir).join("; ")}` : "not in any of them"}`,
    missing.length > 0
      ? `In an old folder but not in the new one: ${missing.join(", ")}. The engine copies them once, when it first serves an intent tool call from the default folder (the marker); what is deleted from the new folder later is not brought back.`
      : "Every intent of the old folders is in the new one (or there are none).",
    f.marker === null ? "Migration marker: none (nothing was copied, or the engine has not run on this branch yet)" : `Migration marker:\n${f.marker.trimEnd().replace(/^/gm, "    ")}`,
  ];
}
