import { describe, expect, it } from "vitest";
import { parseLog, summarize } from "../src/devtools/stall-check.js";

const LOG = [
  "2026-10-17 18:00:00.000 INFO  stall-diag: on (idle rebind on)",
  "2026-10-17 18:00:10.500 INFO  stall-diag: idle rebind",
  "2026-10-17 18:00:10.900 INFO  stall-diag: tend 420 ms",
  "2026-10-17 18:00:12.000 WARN  stall-diag: stall 4800 ms after tend",
  "2026-10-17 18:00:20.000 INFO  bridge: receive: closed",
  "2026-10-17 18:00:30.000 WARN  stall-diag: stall 1200 ms after idle",
  "2026-10-17 18:01:00.000 INFO  stall-diag: idle rebind off (flag file)",
  "2026-10-17 18:01:30.000 WARN  stall-diag: stall 1500 ms after idle",
].join("\r\n");

const t = (hms: string): number => new Date(`2026-10-17T${hms}`).getTime();

describe("stall:check summary (issue #174)", () => {
  it("reads the stall-diag lines only", () => {
    expect(parseLog(LOG).map((e) => e.kind)).toEqual(["on", "rebind", "tend", "stall", "stall", "off", "stall"]);
  });

  it("sums a phase by its window", () => {
    const events = parseLog(LOG);
    expect(summarize(events, t("18:00:00"), t("18:01:00"))).toEqual({
      seconds: 60, idle_rebinds: 1, stalls: 2, stall_max_ms: 4800, stall_total_ms: 6000, stalls_after_tend: 1, slow_tends: 1, tend_max_ms: 420,
    });
    expect(summarize(events, t("18:01:00"), t("18:02:00"))).toMatchObject({ idle_rebinds: 0, stalls: 1, stall_max_ms: 1500, slow_tends: 0, tend_max_ms: 0 });
  });
});
