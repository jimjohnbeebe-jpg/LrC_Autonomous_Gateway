// tone_mode "auto" (PHASE10_PLAN "Third re-plan", R3, T2): Lightroom's Auto Tone on a session photo at pass 0, before the
// look's other values are written (pass0.ts). It sends the bridge command lr_apply_auto sends (plugin DevelopTools.lua
// applyAuto), tone only: white balance stays the look's or the photo's. lr_apply_auto itself stays refused while a session
// is open (mcp\tools-develop.ts developTool, SessionManager.whenIdle); this is the one way Auto runs inside a session.
// LrDevelopController takes no History name, so the Auto step carries Lightroom's own name, not "AVG <id> pass 0/N"
// [handle: plugin\LrC-AVG.lrplugin\DevelopTools.lua:13-15]. The command takes a snapshot first (its snapshot_name is
// required); the pre-session snapshot, taken before pass 0, already puts the photo back (lr_end_session revert, the
// Deck's Put back and Abort apply it: end.ts, put-back.ts), so the command's snapshot is deleted again.

import { pluginVersionAtLeast } from "../bridge/index.js";
import { ToolError } from "../mcp/errors.js";
import { differingSettings, type FromSdkResult } from "../params/index.js";
import { bridge, checkAbort, historyName } from "./io.js";
import { WRITE_TIMEOUT_MS, type Session, type SessionContext, type Target } from "./types.js";

/** The plugin with the apply_auto command (mcp\tools-develop.ts DEVELOP_PLUGIN, issue #214). */
export const AUTO_PLUGIN = "1.5.0";

/** What Auto Tone did: the plugin's status, and the sliders it changed. */
export type AutoTone = { status: string; reason?: string; changed: Record<string, { before: unknown; after: unknown }> };

/** tone_mode "auto" with a plugin older than AUTO_PLUGIN is refused before the snapshot: nothing is written. */
export function checkAutoPlugin(ctx: SessionContext, toneMode: Session["toneMode"]): void {
  if (toneMode !== "auto") return;
  const version = ctx.deps.client.hello()?.plugin_version;
  if (pluginVersionAtLeast(version, AUTO_PLUGIN)) return;
  throw new ToolError(
    "PLUGIN_TOO_OLD",
    `tone_mode "auto" needs the LrC-AVG plugin ${AUTO_PLUGIN} or later (it runs Lightroom's Auto Tone); Lightroom runs ${String(version ?? "an unknown version")}. Nothing was written. Restart Lightroom so it loads the current plugin, or begin with another tone_mode.`,
    false,
  );
}

/** Auto Tone on `t`, whose settings are `view`; returns what it did and the photo's settings after it. */
export async function autoTone(ctx: SessionContext, s: Session, t: Target, view: FromSdkResult): Promise<{ auto: AutoTone; view: FromSdkResult }> {
  checkAbort(s);
  ctx.deps.hud?.stage(s, "applying");
  const { client, map } = ctx.deps;
  const r = await bridge(s, t, () =>
    client.request("apply_auto", { photo_uuid: t.uuid, tone: true, white_balance: false, snapshot_name: historyName(s, t, 0, "auto") }, { timeoutMs: WRITE_TIMEOUT_MS }),
  );
  if (r.snapshot) await client.request("delete_snapshot", { photo_uuid: t.uuid, snapshot_id: r.snapshot.id }, { timeoutMs: WRITE_TIMEOUT_MS }).catch(() => undefined);
  const after = map.fromSdk(r.read_back);
  const changed = Object.fromEntries(differingSettings(view.settings, after.settings).map((k) => [k, { before: view.settings[k] ?? null, after: after.settings[k] ?? null }]));
  return { auto: { status: r.status, ...(r.reason ? { reason: r.reason } : {}), changed }, view: after };
}

/** Whether Auto took the tones: then pass 0 skips the look's tonal values; when it failed, they are written as in tone_mode "set". */
export const autoOwnsTones = (a: AutoTone): boolean => a.status === "applied" || a.status === "unchanged";
