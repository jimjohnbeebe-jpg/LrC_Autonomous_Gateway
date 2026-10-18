import { describe, expect, it } from "vitest";
import { parseLog, suggest, summarize } from "../src/devtools/stall-check.js";

const LOG = [
  "2026-10-17 18:00:00.000 INFO  bridge: starting generation 1 (receive 8765, send 8766)",
  "2026-10-17 18:00:00.100 INFO  stall-diag: on",
  "2026-10-17 18:00:20.500 INFO  stall-diag: startup rebind",
  "2026-10-17 18:00:30.900 INFO  stall-diag: tend 10420 ms",
  "2026-10-17 18:00:32.000 WARN  stall-diag: stall 4800 ms after tend",
  "2026-10-17 18:00:40.000 INFO  bridge: receive: closed",
  "2026-10-17 18:00:50.000 WARN  stall-diag: stall 1200 ms after idle",
  "2026-10-17 18:01:30.000 INFO  bridge: stopped (plugin disabled)",
  "2026-10-17 18:01:31.000 INFO  bridge: sockets closed (task ended)",
].join("\r\n");

const t = (hms: string): number => new Date(`2026-10-17T${hms}`).getTime();

describe("stall:check summary (issue #174)", () => {
  it("reads the bridge and stall-diag lines", () => {
    expect(parseLog(LOG).map((e) => e.kind)).toEqual(["start", "on", "rebind", "tend", "stall", "other", "stall", "stopped", "other"]);
  });

  it("sums a phase by its window", () => {
    const events = parseLog(LOG);
    expect(summarize(events, t("18:00:00"), t("18:01:00"))).toEqual({
      seconds: 60, rebinds: 1, stalls: 2, stall_max_ms: 4800, stall_total_ms: 6000, stalls_after_tend: 1, slow_tends: 1, tend_max_ms: 10420, bridge_lines: 7,
    });
    expect(summarize(events, t("18:01:45"), t("18:02:15"))).toMatchObject({ bridge_lines: 0, stalls: 0 });
  });

  it("suggests from the answers and the stop", () => {
    expect(suggest(true, true, true, true)).toMatch(/^Lightroom stutters without LrC-AVG/);
    expect(suggest(false, true, true, true)).toBe("the fixed plugin still stutters; Disable stops the bridge");
    expect(suggest(false, false, false, false)).toBe("the fix holds: no stutter with the plugin off or on; Disable did NOT stop the bridge");
  });
});
