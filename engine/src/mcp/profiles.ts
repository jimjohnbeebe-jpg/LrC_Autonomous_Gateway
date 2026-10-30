// Tool profiles (issue #165, epic #207 decision D6 [stated: Jim, 2026-10-28, "Go with recommendations"]): which
// of the registered tools the server lists and accepts. LRC_AVG_TOOLS in the client's entry for this server picks
// one; unset, the default is "full", so a chat that had every tool keeps them (whether to make "edit" the default
// is Jim's call). "full" is every registered tool (server.ts TOOL_DEFS), so a tool added later is in it with no
// list to keep; "edit" is the named list below, and a test fails when a name in it is not registered.

import type { ToolDef } from "./defs-shared.js";

export const PROFILE_ENV = "LRC_AVG_TOOLS";
export const PROFILES = ["full", "edit"] as const;
export type ProfileName = (typeof PROFILES)[number];
export const DEFAULT_PROFILE: ProfileName = "full";

/**
 * The edit profile: what a chat needs to edit the selected photo. lr_help (the server's instructions point to it),
 * the photo's context and a preview, the intents list for lr_begin_session, the session loop (begin, step, end),
 * lr_approve_pass and lr_select_variant (an approve_each_pass or Variants session answered in chat needs them) and
 * the four mask tools with lr_set_regions, which names the areas a mask pass is measured on (the mask tools tell the
 * AI to call it first; issue #219 item 4: "the AVG loop + context + masks").
 */
export const EDIT_TOOLS = [
  "lr_help",
  "lr_get_active_photo_context",
  "lr_get_preview",
  "lr_list_intents",
  "lr_begin_session",
  "lr_step",
  "lr_set_regions",
  "lr_approve_pass",
  "lr_select_variant",
  "lr_end_session",
  "lr_list_masks",
  "lr_create_mask",
  "lr_edit_mask",
  "lr_delete_mask",
  "lr_crop",
] as const;

/** The profile LRC_AVG_TOOLS names (any letter case); an unknown value gives the default and is returned as `ignored`. */
export function toolProfile(env: NodeJS.ProcessEnv = process.env): { name: ProfileName; ignored?: string } {
  const raw = env[PROFILE_ENV]?.trim().toLowerCase();
  if (!raw) return { name: DEFAULT_PROFILE };
  const known = PROFILES.find((p) => p === raw);
  return known ? { name: known } : { name: DEFAULT_PROFILE, ignored: raw };
}

/** The tools of a profile, in the registry's order. */
export function profileDefs(all: ToolDef[], name: ProfileName): ToolDef[] {
  if (name === "full") return all;
  const edit = new Set<string>(EDIT_TOOLS);
  return all.filter((d) => edit.has(d.name));
}

/** What lr_help reports about the profile in force. */
export function describeProfile(env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  const { name, ignored } = toolProfile(env);
  return {
    name,
    tools: name === "full" ? "every tool" : [...EDIT_TOOLS],
    ...(ignored !== undefined ? { ignored: `${PROFILE_ENV}="${ignored}" is not a profile (${PROFILES.join(", ")})` } : {}),
    switch: `${PROFILE_ENV}=${PROFILES.join(" or ")} in this server's env in the AI app's config, then restart the app`,
  };
}
