// MCP prompts (issue #166, #219): prompts/list and prompts/get. The standard request template, the
// lr_help text, the shoot prompts (prompts-shoot.ts: cull, keyword, batch), and one prompt per intent ("look-<id>",
// PHASE10_PLAN "Third re-plan", rows 9+10), built from the intent library on each call, so a look saved in the chat is
// listed at the next prompts/list; no listChanged notification is sent. The shape follows
// upstream's one skill prompt [upstream claim: Automaat/lightroom-mcp 1040453, server/src/skill-prompt.ts,
// create-server.ts:19-20]. Whether a given client shows prompts to its user is [unverified].

import { ProtocolError, ProtocolErrorCode } from "@modelcontextprotocol/server";
import type { IntentSummary } from "../intents/index.js";
import { HELP_TEXT } from "./defs-help.js";
import { SHOOT_PROMPTS, shootPromptText } from "./prompts-shoot.js";

export const REQUEST_PROMPT = "lrc-avg-edit";
export const HELP_PROMPT = "lrc-avg-help";
/** A look's prompt is "look-<intent id>" (ids are lower case letters, digits and _, so no other prompt name fits). */
export const LOOK_PROMPT_PREFIX = "look-";

const REQUEST_ARG = { name: "request", description: "What you want the photo to look like.", required: false };

export const PROMPTS = [
  {
    name: REQUEST_PROMPT,
    title: "Edit the selected photo",
    description: "Ask LrC-AVG to edit the photo selected in Lightroom Classic, in your own words.",
    arguments: [REQUEST_ARG],
  },
  { name: HELP_PROMPT, title: "How LrC-AVG works", description: "The lr_help text: sessions, passes, previews, metrics, masks, logs and errors." },
  ...SHOOT_PROMPTS,
];

/** prompts/list: the fixed prompts, then one per intent. */
export function listPrompts(looks: readonly IntentSummary[]) {
  const lookArg = { ...REQUEST_ARG, description: "Anything you want besides the look, in your own words." };
  return [...PROMPTS, ...looks.map((l) => ({ name: `${LOOK_PROMPT_PREFIX}${l.id}`, title: l.label, description: l.label, arguments: [lookArg] }))];
}

/** The request template, with the user's words in it (or a placeholder when none were given). */
export function requestTemplate(request: string | undefined): string {
  const wish = request?.trim() || "(describe the look you want)";
  return [
    "Edit the photo that is selected in Lightroom Classic with the LrC-AVG tools.",
    "",
    `My request: ${wish}`,
    "",
    "Call lr_help once, then lr_get_active_photo_context to see the photo. My request comes first; use an intent only when one fits it.",
    "Start with lr_begin_session, refine with lr_step (look at each preview and its metrics), and finish with lr_end_session.",
    "Tell me what you changed and why when you are done.",
  ].join("\n");
}

/** A look's request: edit the selected photo with that intent, the user's words first. */
export function lookTemplate(look: IntentSummary, request: string | undefined): string {
  const wish = request?.trim() || "(nothing more: the look, adapted to this photo)";
  return [
    `Edit the photo that is selected in Lightroom Classic with the LrC-AVG look "${look.label}".`,
    "",
    `My request: ${wish}`,
    "",
    `Call lr_help once, then lr_get_active_photo_context to see the photo. Start with lr_begin_session with intent_id "${look.id}" and my request in notes; my request comes first.`,
    "Refine with lr_step (look at each preview and its metrics), and finish with lr_end_session.",
    "Tell me what you changed and why when you are done.",
  ].join("\n");
}

type Got = { description: string; messages: Array<{ role: "user"; content: { type: "text"; text: string } }> };
const answer = (description: string, text: string): Got => ({ description, messages: [{ role: "user", content: { type: "text", text } }] });

/** The prompts/get answer for `name`; an unknown name is a protocol error (invalid params), as upstream answers. */
export function getPrompt(name: string, args: Record<string, string> | undefined, looks: readonly IntentSummary[] = []): Got {
  const look = name.startsWith(LOOK_PROMPT_PREFIX) ? looks.find((l) => `${LOOK_PROMPT_PREFIX}${l.id}` === name) : undefined;
  if (look) return answer(look.label, lookTemplate(look, args?.["request"]));
  const def = PROMPTS.find((p) => p.name === name);
  if (!def) throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Unknown prompt: ${name}`);
  const text = name === REQUEST_PROMPT ? requestTemplate(args?.["request"]) : name === HELP_PROMPT ? HELP_TEXT : (shootPromptText(name, args?.["request"]) ?? "");
  return answer(def.description, text);
}
