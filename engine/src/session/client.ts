// The name the user sees for the AI that runs an edit (issue #155 R1/R2): the MCP client's title, else
// a known name, else its raw name, else "the AI". The map only names; no client gets its own behaviour
// (vault ISSUE155_PLAN.md decision D1).

import type { ClientIdentity } from "../log/index.js";

export const UNNAMED = "the AI";

export const KNOWN_CLIENTS: Record<string, string> = {
  // [unverified] until clients:probe / clients:check T2 records these clientInfo names.
  "claude-code": "Claude Code",
  opencode: "OpenCode",
  "claude-ai": "Claude",
  // [inference: the string appears in codex.exe]
  "codex-mcp-client": "Codex",
  "hermes-agent": "Hermes",
  // [inference: the MCP Python SDK's DEFAULT_CLIENT_INFO, %LOCALAPPDATA%\hermes\hermes-agent\venv\Lib\
  // site-packages\mcp\client\session.py:66, which Hermes 0.21.5 sends because tools/mcp_tool_transport.py:
  // 169-179 passes no client_info]: the name says nothing about the client.
  mcp: UNNAMED,
};

/** Without control characters and "%" (special in the plugin's Lua patterns and string.format [inference]), trimmed, at most `max` characters. */
export const cleanText = (s: string, max: number): string => s.replace(/[\u0000-\u001f\u007f-\u009f%]/g, "").trim().slice(0, max).trim();

/** The display name, at most 32 characters. */
export function displayName(client?: ClientIdentity | null): string {
  const raw = client?.title || (client && KNOWN_CLIENTS[client.name]) || client?.name || UNNAMED;
  return cleanText(raw, 32) || UNNAMED;
}

/** displayName with its first letter upper-cased, to start a sentence ("The AI"). */
export function sentenceName(client?: ClientIdentity | null): string {
  const name = displayName(client);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** The model the AI named, at most 80 characters; null when none. */
export function displayModel(model?: string | null): string | null {
  return cleanText(model ?? "", 80) || null;
}
