// The Deck's copy thumbnails (Phase 7 row 3, E4; src\hud\thumbs.ts, deck.ts; spec docs\hud\
// lrc-avg-hud-spec-v2.md 3.6, 11.2 "hud-thumbs.test.ts"): asked for by the key the state lists, 480 px on
// the long edge, at most one per copy and pass, small, null for a key that is not current, and dropped
// when the edit ends.

import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { EngineMessage } from "../src/hud/index.js";
import { THUMB_EDGE, thumbKey } from "../src/hud/thumbs.js";
import { SimHudClient, deckRig } from "./helpers/deck-harness.js";
import { waitUntil } from "./helpers/fake-plugin.js";
import { ID, clean, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

type Thumb = Extract<EngineMessage, { type: "thumb" }>;

async function thumb(sim: SimHudClient, key: string): Promise<Thumb> {
  const before = sim.received.length;
  sim.send({ type: "get_thumb", key });
  await waitUntil(() => sim.received.slice(before).some((m) => m.type === "thumb" && m.key === key));
  return sim.received.slice(before).find((m) => m.type === "thumb" && m.key === key) as Thumb;
}

describe("copy thumbnails", () => {
  it("names a render by letter, pass and the first 12 hex characters of its hash", () => {
    expect(thumbKey("B", 2, "0123456789abcdef0123")).toBe("B:2:0123456789ab");
  });

  it("answers a listed key with a small 480 px JPEG, makes it once, refuses a stale key, and drops all at the end", async () => {
    clean();
    const rig = await deckRig();
    const sim = await SimHudClient.connect(rig.endpoint);
    await sim.welcomed();
    await rig.manager.begin({ intent_id: "test_variants", mode: "variants" });
    const first = await sim.at("awaiting_claude", (s) => (s.copies ?? []).every((c) => c.thumb));
    const keys = (first.copies ?? []).map((c) => c.thumb as string);
    expect(keys.length).toBe(3);

    const a = await thumb(sim, keys[0] as string);
    const jpeg = Buffer.from(a.jpeg_b64 as string, "base64");
    const meta = await sharp(jpeg).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(THUMB_EDGE); // the sim renders at the session's 1600 px
    expect(jpeg.length).toBeLessThanOrEqual(80 * 1024);
    await thumb(sim, keys[0] as string);
    expect(rig.deck.thumbs.count).toBe(1); // asked twice, made once

    expect((await thumb(sim, "A:9:000000000000")).jpeg_b64).toBeNull();

    // A new pass of A replaces its thumbnail.
    await rig.manager.step({ session_id: ID, target: "A", settings: { exposure: 0.1 }, rationale: "test" });
    const next = await sim.at("awaiting_claude", (s) => s.copies?.[0]?.pass === 1);
    const newKey = next.copies?.[0]?.thumb as string;
    expect(newKey).not.toBe(keys[0]);
    expect((await thumb(sim, keys[0] as string)).jpeg_b64).toBeNull();
    expect((await thumb(sim, newKey)).jpeg_b64).toEqual(expect.any(String));
    expect(rig.deck.thumbs.size()).toBe(1);

    await rig.manager.end({ session_id: ID, outcome: "revert" });
    await sim.at("ended");
    expect(rig.deck.thumbs.size()).toBe(0);
    expect((await thumb(sim, newKey)).jpeg_b64).toBeNull();
  });
});
