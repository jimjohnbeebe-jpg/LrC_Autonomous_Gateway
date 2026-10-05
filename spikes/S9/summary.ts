// Spike S9: each gate's number against its target (spec D2 table, section 9). The result is a
// SUGGESTION: the verdict is Jim's (rule 02, report format "Verdict").
import { median, pct, type Results } from "./harness.ts";

type Gate = { gate: string; value: unknown; target: string; suggested: "pass" | "fail" | "not run" | "reported" };
type Row = Record<string, unknown>;

const rows = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);
const nums = (xs: unknown[]): number[] => xs.filter((x): x is number => typeof x === "number");
const MB = 1024 * 1024;
/** An S9-8 episode: in place within 100 ms of the change ending, and (S9b) visible out of place at most 100 ms. */
const followOk = (x: Row): boolean => typeof x.ms === "number" && x.ms <= 100 && (typeof x.detached_ms !== "number" || x.detached_ms <= 100);

function gate(name: string, value: unknown, target: string, ok: boolean | null): Gate {
  return { gate: name, value, target, suggested: ok === null ? "not run" : ok ? "pass" : "fail" };
}

/** Times: every sample must exist (a null is a miss) and the statistic must meet the target. */
function timed(name: string, samples: unknown[], stat: "median" | "p95", limit: number): Gate {
  const xs = nums(samples);
  const v = stat === "median" ? median(xs) : pct(xs, 95);
  const misses = samples.length - xs.length;
  const target = `${stat} <= ${limit} ms, no misses`;
  if (!samples.length) return gate(name, null, target, null);
  return gate(name, { [stat]: v, n: samples.length, misses, max: xs.length ? Math.max(...xs) : null }, target, misses === 0 && v !== null && v <= limit);
}

export function summarize(r: Results): { gates: Gate[]; headline: string } {
  const s1 = (r.s9_1 ?? {}) as Row;
  const shows = rows((r.s9_2 as Row | undefined)?.shows);
  const s3 = (r.s9_3 ?? {}) as Row;
  const hidden = r.s9_4_5_hidden as Row | undefined;
  const pulsing = r.s9_5_visible as Row | undefined;
  const jim6 = rows(r.s9_6_jim);
  const s7 = r.s9_7 as Row | undefined;
  const s8 = r.s9_8 as Row | undefined;
  const s9 = r.s9_9 as Row | undefined;
  const s10 = r.s9_10 as Row | undefined;
  const s11 = r.s9_11 as Row | undefined;
  const switches = rows(s7?.switches);
  const episodes = rows(s8?.episodes);
  // A sample counts only in the window state it was meant to measure (a failed hide or show is a miss),
  // and a CPU/memory sample only when every process of the tree was read for the whole window.
  const s3ms = Array.isArray(s3.ms) ? (s3.visible_at_start === true ? s3.ms : s3.ms.map(() => null)) : [];
  const hiddenOk = hidden?.hidden === true && hidden.still_hidden === true && hidden.complete === true;
  const pulsingOk = pulsing?.shown === true && pulsing.still_visible === true && pulsing.complete === true;
  const kinds = (k: string): number => switches.filter((x) => x.to === k).length;
  const gates: Gate[] = [
    timed("S9-1 cold start", rows(s1.runs).map((x) => x.ms), "median", 1500),
    timed("S9-2 warm show", shows.map((x) => (x.hidden_before === true ? x.ms : null)), "p95", 150),
    timed("S9-3 update to paint", s3ms, "p95", 100),
    gate("S9-4 idle memory (hidden, 60 s)", hidden ? { tree_mib: Number(hidden.private_bytes_tree) / MB, host_mib: Number(hidden.private_bytes_host) / MB, measured_hidden_and_complete: hiddenOk } : null,
      "<= 150 MiB private bytes, process tree, hidden and every process read", hidden ? hiddenOk && Number(hidden.private_bytes_tree) <= 150 * MB : null),
    gate("S9-5 CPU", { hidden_pct: hidden?.cpu_pct_one_core ?? null, visible_pct: pulsing?.cpu_pct_one_core ?? null, hidden_ok: hiddenOk, visible_ok: pulsingOk },
      "hidden <= 0.5 %, visible and pulsing <= 2 % of one core, each in its state with every process read", hidden && pulsing ? hiddenOk && pulsingOk && Number(hidden.cpu_pct_one_core) <= 0.5 && Number(pulsing.cpu_pct_one_core) <= 2 : null),
    gate("S9-6 show without activation", { programmatic_unchanged: shows.filter((x) => x.fg_unchanged).length, programmatic: shows.length, jim_yes: jim6.filter((x) => x.jim_backslash_reached_lightroom).length, jim: jim6.length },
      "20 of 20 programmatic shows, Jim 3 of 3", shows.length && jim6.length ? shows.length === 20 && shows.every((x) => x.fg_unchanged) && jim6.length === 3 && jim6.every((x) => x.jim_backslash_reached_lightroom) : null),
    gate("S9-7 topmost policy", { switches: switches.length, to_lightroom: kinds("lightroom"), to_claude: kinds("claude"), correct_within_250: switches.filter((x) => x.correct && Number(x.ms) <= 250).length, jim_over_lightroom: s7?.jim_over_lightroom ?? null, jim_under_claude: s7?.jim_under_claude ?? null },
      "10 alternating switches (5 each way), each correct within 250 ms; Jim y, y", s7 ? switches.length >= 10 && kinds("lightroom") >= 5 && kinds("claude") >= 5 && switches.every((x) => x.correct && Number(x.ms) <= 250) && s7.jim_over_lightroom === true && s7.jim_under_claude === true : null),
    gate("S9-8 follows Lightroom", { episodes: episodes.length, in_place_within_100: episodes.filter(followOk).length, max_detached_ms: Math.max(0, ...nums(episodes.map((x) => x.detached_ms))), move_events: s8?.move_events ?? null, jim: [s8?.jim_moved, s8?.jim_drag_hidden, s8?.jim_minimised, s8?.jim_screen_modes] },
      "every episode in place <= 100 ms after the change ends and visible out of place <= 100 ms; hidden while minimised; Jim y to each (S9b adds the drag question)",
      s8 ? episodes.length > 0 && episodes.every(followOk) && s8.jim_moved === true && s8.jim_minimised === true && s8.jim_screen_modes === true && (!("jim_drag_hidden" in s8) || s8.jim_drag_hidden === true) : null),
    gate("S9-9 survives the launcher", s9 ?? null, "running, not-connected state with the undo line (Jim y)", s9 ? s9.hud_running_5s_after === true && s9.jim_not_connected_with_undo === true : null),
    gate("S9-10 exits after Lightroom", s10 ?? null, "process tree gone <= 5000 ms after Lightroom exits", s10 ? typeof s10.tree_ms === "number" && s10.tree_ms <= 5000 : null),
    gate("S9-11 Lightroom responsive", s11?.jim_no_difference ?? null, "Jim y", s11 ? s11.jim_no_difference === true : null),
    { gate: "S9-12 size on disk / download", value: r.s9_12 ?? null, target: "reported (no gate)", suggested: "reported" },
  ];
  const failed = gates.filter((g) => g.suggested === "fail").map((g) => g.gate.split(" ")[0]);
  // The S9b re-run (`--s9b`) runs Part 1 and S9-8 only; the other gates stand from the first run.
  const fromRun1 = r.s9b === true ? ["S9-6", "S9-7", "S9-9", "S9-10", "S9-11"] : [];
  const notRun = gates.filter((g) => g.suggested === "not run").map((g) => g.gate.split(" ")[0] ?? "").filter((g) => !fromRun1.includes(g));
  const headline = failed.length
    ? `S9 SUGGESTED: FAILED (${failed.join(", ")})${notRun.length ? `; not run: ${notRun.join(", ")}` : ""}`
    : notRun.length ? `S9 SUGGESTED: INCOMPLETE (not run: ${notRun.join(", ")})` : "S9 SUGGESTED: EVERY GATE PASSED";
  return { gates, headline: `${headline}. A suggestion only: the verdict is Jim's.` };
}
