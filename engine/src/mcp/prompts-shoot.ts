// The shoot prompts (issues #111, #112, #110): cull, keyword and batch-edit a set of photos by chaining
// the catalog tools, looking through the shoot with lr_get_contact_sheet. Every catalog write waits for
// the user's yes to a proposal table first, in the chat, not through an engine dry run (decision D2 of
// the 2026-10-29 plan [stated: Jim, 2026-10-29, "Go on all."]). The edit profile lacks these tools
// (profiles.ts EDIT_TOOLS), so each prompt says the full profile is needed. The batch prompt's "no cached
// preview right after the sync": every fast request fell back to the export for 23.8 s after a write
// [handle: docs\reports\phase11\METRICS-PARITY.md, Numbers, "Fast preview caught up after the write"].

import { NO_STACK_WRITE } from "../library/index.js";

export const CULL_PROMPT = "lrc-avg-cull";
export const KEYWORD_PROMPT = "lrc-avg-keyword";
export const BATCH_PROMPT = "lrc-avg-batch";

const requestArg = (description: string) => [{ name: "request", description, required: false }];

export const SHOOT_PROMPTS = [
  {
    name: CULL_PROMPT,
    title: "Cull the selected photos",
    description: "Look through the photos selected in Lightroom Classic, propose picks and rejects, and flag them after your yes.",
    arguments: requestArg("What to keep (e.g. one pick per burst, sharp eyes)."),
  },
  {
    name: KEYWORD_PROMPT,
    title: "Keyword the selected photos",
    description: "Propose keywords and a title, caption and headline for the selected photos, and write them after your yes.",
    arguments: requestArg("What the keywords should cover (people, places, events, ...)."),
  },
  {
    name: BATCH_PROMPT,
    title: "Copy an edit onto the selected photos",
    description: "Copy an accepted session's edit onto the selected photos, matching exposure per photo, then review them on contact sheets.",
    arguments: requestArg("Which session to copy, or anything else about the batch."),
  },
];

const PROFILE_NOTE =
  "These steps need LrC-AVG's full tool profile. If a tool named here is missing, the server runs with LRC_AVG_TOOLS=edit: ask me to remove that setting from the client's lrc-avg entry and restart the client.";
const SHEETS =
  "Look through the photos with lr_get_contact_sheet, 16 uuids at a time in capture order; when a result has `not_yet`, call again with those uuids before the next 16. " +
  "The number on a cell is the `n` of its entry in `cells` (a photo that failed is in `failed` and leaves a gap in the numbers); take the uuid from that entry. For a doubtful frame, call lr_get_preview with its uuid and a region.";
const WAIT = "Write nothing until I answer yes to the table. Group the writes by value, at most 100 uuids a call.";

const wish = (request: string | undefined, placeholder: string): string => `My request: ${request?.trim() || placeholder}`;

/** The prompt's text with the user's words in it; undefined for a name that is not a shoot prompt. */
export function shootPromptText(name: string, request: string | undefined): string | undefined {
  if (name === CULL_PROMPT) {
    return [
      "Cull the photos selected in Lightroom Classic with the LrC-AVG tools.",
      wish(request, "(keep the best frames)"),
      PROFILE_NOTE,
      "1. lr_get_selected_photos with limit 500 for the uuids and capture times.",
      `2. ${SHEETS}`,
      "3. Judge focus, eyes, exposure and bursts from the images and each cell's metrics; keep one pick per burst unless I said otherwise.",
      "4. lr_get_metadata on the photos for their current flags.",
      `5. Show a table (photo, current flag, proposed flag, why) and the counts ("N photos: K picks, R rejects"). ${WAIT}`,
      "6. lr_set_flag per flag value, then lr_set_ai_metadata with the reason for each photo.",
      `7. Report each photo's \`before\` and how to put it back: lr_set_flag with the before values. ${NO_STACK_WRITE}`,
    ].join("\n");
  }
  if (name === KEYWORD_PROMPT) {
    return [
      "Keyword the photos selected in Lightroom Classic with the LrC-AVG tools.",
      wish(request, "(keywords for what is in each photo)"),
      PROFILE_NOTE,
      "1. lr_list_keywords first, and reuse the paths that exist (parent|child) before making new ones.",
      "2. lr_get_selected_photos with limit 500 for the uuids.",
      `3. ${SHEETS}`,
      "4. Propose keyword paths for each photo, and a title, caption and headline where they help.",
      "5. lr_get_metadata on the photos for their keywords and text fields now.",
      `6. Show a table (photo, keywords to add, title, caption, headline, current values). ${WAIT}`,
      "7. lr_set_keywords once per keyword with all its uuids, then lr_set_iptc per photo (or per group with the same text).",
      "8. lr_get_metadata again to read the result back, and tell me how to put it back: lr_set_keywords remove with the added paths, and lr_set_iptc with the before values.",
    ].join("\n");
  }
  if (name === BATCH_PROMPT) {
    return [
      "Copy an edit onto the photos selected in Lightroom Classic with the LrC-AVG tools.",
      wish(request, "(copy my last accepted session)"),
      PROFILE_NOTE,
      "1. The edit to copy is a session that ended with accept (lr_end_session gives its session_id); if I named none, ask me which.",
      "2. lr_get_selected_photos with limit 500; keep the returned uuids, tell me which photos will change and wait for my yes.",
      "3. lr_sync_series with source {session_id}, targets {uuids: the uuids I approved in step 2} (not the selection, which may have changed since) and adaptive_exposure true; while a result has `not_yet`, follow its `next`.",
      `4. ${SHEETS} Right after the sync, Lightroom often has no cached preview yet, so cells come back as the exact export (fast_fallback).`,
      "5. Show a table per photo: exposure offset, not_transferable, snapshot, and anything that looks wrong on the sheet.",
      '6. To undo a photo: lr_list_snapshots with its uuid, then lr_apply_snapshot with the "AVG pre-sync <id>" snapshot and confirm true, after my yes.',
    ].join("\n");
  }
  return undefined;
}
