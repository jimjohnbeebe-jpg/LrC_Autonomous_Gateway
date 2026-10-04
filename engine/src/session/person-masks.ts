// One person's mask in a mask pass (ai-masks.ts; GitHub issue #59, PR C step 2c): by instance
// (params\mask-person.ts). The pass has written the probe, Entire Person of instance 0 at Claude's point;
// it computes; the box of InstanceBounds that holds the point names the person (several: the nearest
// centre; none: MASK_NOTHING_FOUND, listing the boxes). When the wanted mask is Entire Person of instance
// 0, the probe is it. Otherwise the probe's component is replaced, in the table as it is now, by the wanted
// kind with that instance ("… mask person"), which computes in turn. After each computes, its kind and
// instance are checked: an engine-written entry without InstanceIDs came back as another kind, its point
// moved to another person [handle: docs\reports\phase6\masks-capture\capture4-check.json step
// `row6_person_entire`]. One pass per tool call, as for every mask. [handle: tests\session-person-masks.test.ts,
// against the Lightroom sim; in Lightroom [unverified] until capture 5.]

import { ToolError } from "../mcp/errors.js";
import { AI_KINDS, boundsOf, firstComponent, instanceOf, pickInstance, readTable, withInstance, type Box, type SdkSettings } from "../params/index.js";
import type { AiJob, AiResult } from "./ai-masks.js";
import { historyName, readSdk, writeTable } from "./io.js";
import type { Session, SessionContext } from "./types.js";

type Failed = { why: string; fallback: boolean };
/** The table route of ai-masks.ts, and its take-out of this pass's attempt. */
export type PersonOps = { table: (job: AiJob) => Promise<AiResult | Failed>; takeOut: (job: AiJob) => Promise<string | null> };

const boxText = (b: Box, n: number): string => `person ${n}: left ${b.left.toFixed(3)}, top ${b.top.toFixed(3)}, right ${b.right.toFixed(3)}, bottom ${b.bottom.toFixed(3)}`;

/** Why the computed entry is not the kind and instance written, or null when it is. */
function drifted(sdk: SdkSettings, job: AiJob, kind: AiJob["kind"], n: number): string | null {
  const m = firstComponent(readTable(sdk), job.id) ?? {};
  const want = AI_KINDS[kind].fields;
  const same = Object.entries(want).every(([k, v]) => m[k] === v) && instanceOf(m) === n;
  return same ? null : `once computed, Lightroom had changed the person mask (MaskSubType ${String(m["MaskSubType"])}, category ${String(m["MaskSubCategoryID"])}, instance ${String(instanceOf(m))}), not ${kind} of person ${n}`;
}

export async function byPerson(ctx: SessionContext, s: Session, job: AiJob, ops: PersonOps): Promise<AiResult | Failed> {
  const point = job.point;
  if (!point) return { why: "one person's mask needs its point", fallback: false };
  const probe = await ops.table(job); // throws MASK_NOTHING_FOUND (no person in the photo) or LIGHTROOM_DIALOG
  if (!("route" in probe)) return probe;
  const probeDrift = drifted(probe.sdk, job, "person_entire", 0);
  if (probeDrift) return { why: probeDrift, fallback: false };
  const people = boundsOf(firstComponent(readTable(probe.sdk), job.id));
  if (people.length === 0) return { why: "Lightroom computed the person mask but gave no people boxes (InstanceBounds)", fallback: false };
  const n = pickInstance(people, point);
  if (n === null) {
    const left = await ops.takeOut(job);
    throw new ToolError(
      "MASK_NOTHING_FOUND",
      `No person at the point (${point[0]}, ${point[1]}): Lightroom found ${people.length === 1 ? "1 person" : `${people.length} people`} (${people.map(boxText).join("; ")}, in 0-1 of the photo), so the mask was taken out again${left ? ` (${left})` : ""}; the pass is not used. Give a point inside the box of the person meant.`,
      true,
      { session_id: s.id, kind: job.kind, point: { x: point[0], y: point[1] }, people, history_names: job.historyNames, ...(left ? { left } : {}) },
    );
  }
  if (job.kind === "person_entire" && n === 0) return { ...probe, people, instance: 0 };
  const now = readTable((await readSdk(ctx, s, job.t)).sdk);
  const i = now.findIndex((e) => e["CorrectionID"] === job.id);
  if (i < 0) return { why: "the person mask's entry is no longer in the table (removed in Lightroom?)", fallback: false };
  now[i] = withInstance(now[i] as (typeof now)[number], job.kind, n, point);
  const name = historyName(s, job.t, job.n, "mask person");
  await writeTable(ctx, s, job.t, now, name, false);
  job.historyNames.push(name);
  const real = await ops.table(job);
  if (!("route" in real)) return real;
  const drift = drifted(real.sdk, job, job.kind, n);
  if (drift) return { why: drift, fallback: false };
  return { ...real, people, instance: n };
}
