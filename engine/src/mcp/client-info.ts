// The MCP client's identity from its initialize request (issue #155 R1). clientInfo is untrusted and
// unbounded: the SDK stores it as sent and checks only that name and version are strings [handle:
// node_modules\@modelcontextprotocol\server\dist\mcp-oHn3ureC.mjs:1169, 1223-1225 and src-DdvbAHrR.mjs:770-776, 825,
// SDK 2.4.0]. getClientVersion() is @deprecated there (the 2026-07-28 revision carries the identity per request)
// but keeps returning the initialize value on 2025-era connections, which the plain upgrade serves [handle:
// node_modules\@modelcontextprotocol\server\dist\mcp-BCJHyo7l.d.mts:3079-3085].

import { z } from "zod";
import type { ClientIdentity } from "../log/index.js";
import { cleanText } from "../session/index.js";

const rawSchema = z.object({ name: z.string(), title: z.string().optional(), version: z.string().optional() });

const clean = (s: string): string => cleanText(s, 64);

/** The cleaned identity (each string without control characters or "%", at most 64 characters); null without a usable name. Never throws. */
export function clientIdentity(raw: unknown): ClientIdentity | null {
  let parsed;
  try {
    parsed = rawSchema.safeParse(raw);
  } catch {
    return null; // safeParse rethrows what a getter throws (the test's hostile object)
  }
  if (!parsed.success) return null;
  const name = clean(parsed.data.name);
  if (!name) return null;
  const title = clean(parsed.data.title ?? "");
  return { name, ...(title ? { title } : {}), version: clean(parsed.data.version ?? "") };
}
