// MCP prompts (issue #166, #219): prompts/list and prompts/get. The standard request template, the
// lr_help text, and the shoot prompts (prompts-shoot.ts: cull, keyword, batch). The shape follows
// upstream's one skill prompt [upstream claim: Automaat/lightroom-mcp 1040453, server/src/skill-prompt.ts,
// create-server.ts:19-20]. Whether a given client shows prompts to its user is [unverified].

import { ProtocolError, ProtocolErrorCode } from "@modelcontextprotocol/server";
import { HELP_TEXT } from "./defs-help.js";
import { SHOOT_PROMPTS, shootPromptText } from "./prompts-shoot.js";

export const REQUEST_PROMPT = "lrc-avg-edit";
export const HELP_PROMPT = "lrc-avg-help";

export const PROMPTS = [
  {
    name: REQUEST_PROMPT,
    title: "Edit the selected photo",
    description: "Ask LrC-AVG to edit the photo selected in Lightroom Classic, in your own words.",
    arguments: [{ name: "request", description: "What you want the photo to look like.", required: false }],
  },
  { name: HELP_PROMPT, title: "How LrC-AVG works", description: "The lr_help text: sessions, passes, previews, metrics, masks, logs and errors." },
  ...SHOOT_PROMPTS,
];

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

/** The prompts/get answer for `name`; an unknown name is a protocol error (invalid params), as upstream answers. */
export function getPrompt(name: string, args: Record<string, string> | undefined): { description: string; messages: Array<{ role: "user"; content: { type: "text"; text: string } }> } {
  const def = PROMPTS.find((p) => p.name === name);
  if (!def) throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Unknown prompt: ${name}`);
  const text = name === REQUEST_PROMPT ? requestTemplate(args?.["request"]) : name === HELP_PROMPT ? HELP_TEXT : (shootPromptText(name, args?.["request"]) ?? "");
  return { description: def.description, messages: [{ role: "user", content: { type: "text", text } }] };
}
