// Spike S10, step 2: the write battery on one photo behind a snapshot (s10-config.ts has the plan).
// Order: the range probe and the keys beyond the raw pin (s10-probe.ts), the Custom white balance,
// the lens switches, then the profile pairs last, since a Look can drop keys (a monochrome profile
// drops 18 [handle: docs\reports\phase0\S5.md "Numbers"]). A failed write is recorded and the battery
// goes on; the snapshot is applied in every case and every key compared with the start: PUT BACK
// YES/NO per photo. A snapshot that cannot be made writes nothing to that photo.

import { yn, type Json } from "./phase3-config.js";
import { describeError, differingKeys } from "./phase1-check.js";
import { errorBody } from "./phase4-config.js";
import { lensWrites, profileWrites, whiteBalanceWrite, type Recorded } from "./s10-profiles.js";
import { extraKeysProbe, extraLine, rangeLine, rangeProbe } from "./s10-probe.js";
import { WRITE_TIMEOUT_MS, label, snapshotName, type Ctx, type Photo } from "./s10-config.js";

const taken = (w: Json | undefined): string => (w === undefined ? "not run" : w["taken"] === true ? "YES" : w["taken"] === false ? "NO" : w["error"] !== undefined ? "write failed" : "unknown");

export async function writeBattery(ctx: Ctx, photo: Photo, recorded: Recorded): Promise<Json> {
  const { client, say } = ctx.deps;
  const out: Json = { filename: photo.filename, copy_name: photo.copy_name, uuid: photo.uuid, file_format: photo.file_format, pipeline: photo.pipeline, process_version: photo.process_version, snapshot: null, put_back: null };
  say(`${label(photo)} (${photo.pipeline}, PV ${photo.process_version ?? "?"}):`);
  const name = snapshotName(ctx.deps.stamp);
  let snapshot: string;
  try {
    const res = await client.request("create_snapshot", { photo_uuid: photo.uuid, name }, { timeoutMs: ctx.deps.writeTimeoutMs ?? WRITE_TIMEOUT_MS });
    snapshot = res.snapshot_id;
    out["snapshot"] = { name, id: snapshot };
  } catch (err) {
    out["snapshot"] = { name, error: errorBody(err) };
    ctx.fail(`${label(photo)}: the snapshot: ${describeError(err)}. Nothing was written to it.`);
    return out;
  }
  try {
    out["range"] = await rangeProbe(ctx, photo);
    say(`  ${rangeLine(out["range"] as Json)}`);
    out["extra_keys"] = await extraKeysProbe(ctx, photo);
    say(`  ${extraLine(out["extra_keys"] as Json)}`);
    const wb = await whiteBalanceWrite(ctx, photo);
    out["white_balance"] = wb;
    say(`  white balance: keys ${((wb["keys"] as string[]) ?? []).join(", ") || "none"}; Custom taken ${wb["custom_taken"] === undefined ? (wb["error"] !== undefined ? "write failed" : "not run") : yn(wb["custom_taken"] === true)}; values taken ${wb["values_taken"] === undefined ? "-" : yn(wb["values_taken"] === true)}`);
    const lens = await lensWrites(ctx, photo);
    out["lens"] = lens;
    say(`  lens: ${(lens["steps"] as Json[]).map((s) => `${String(s["label"])} ${taken(s)}`).join(", ")}`);
    const profiles = await profileWrites(ctx, photo, recorded);
    out["profiles"] = profiles;
    say(`  profiles: ${(profiles["pairs"] as Json[]).map((p) => `${String(p["label"])} ${taken(p)}`).join("; ")}`);
  } catch (err) {
    out["stopped"] = describeError(err);
    ctx.fail(`${label(photo)}: the writes stopped: ${describeError(err)}`);
  }
  await putBack(ctx, photo, snapshot, out);
  return out;
}

/** The snapshot applied; every key compared with the start. */
async function putBack(ctx: Ctx, photo: Photo, snapshot: string, out: Json): Promise<void> {
  const { client, map, say } = ctx.deps;
  const result: Json = { ok: false };
  out["put_back"] = result;
  try {
    await client.request("apply_snapshot", { photo_uuid: photo.uuid, snapshot_id: snapshot }, { timeoutMs: ctx.deps.writeTimeoutMs ?? WRITE_TIMEOUT_MS });
    const now = (await client.request("get_settings", { photo_uuid: photo.uuid })).settings;
    const differing = differingKeys(map, photo.start, now);
    Object.assign(result, { ok: differing.length === 0, differing, compared: Object.keys(photo.start).length });
    if (differing.length > 0) ctx.fail(`${label(photo)} is not as before the check: ${differing.join(", ")} differ. Tell Claude Code.`);
  } catch (err) {
    result["error"] = errorBody(err);
    ctx.fail(`putting ${label(photo)} back: ${describeError(err)}. Tell Claude Code.`);
  }
  say(`  PUT BACK: ${yn(result["ok"] === true)}`);
}
