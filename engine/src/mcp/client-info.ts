// The MCP client's identity from its initialize request (issue #155 R1). clientInfo is untrusted and
// unbounded: the SDK stores it as sent and checks only that name and version are strings [handle:
// node_modules\@modelcontextprotocol\sdk\dist\esm\server\index.js:262,280 and types.js:315, SDK 1.32.0].

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
