// get_prefs in the Lightroom sim, as plugin\LrC-AVG.lrplugin\Prefs.lua getPrefs answers it: every
// setting under its wire name, `temp_preview_dir`, and `invalid` (the keys the plugin replaced by
// their defaults). Starts from the page's defaults (PAGE_SPECS), as a page nobody has edited.
// Checked against the Lua itself only under fengari [handle: docs\reports\phase5\settings-smoke\smoke.txt].

import { PAGE_SPECS } from "../../src/settings/index.js";

export type SimPrefs = Record<string, unknown>;

/** The get_prefs answer of a page at its defaults. */
export function defaultSimPrefs(): SimPrefs {
  const out: SimPrefs = { temp_preview_dir: "C:\\Users\\U\\AppData\\Local\\Temp\\LrC-AVG\\previews", invalid: [] };
  for (const spec of PAGE_SPECS) {
    out[spec.wire] = spec.kind === "decay" ? spec.default.split(",").map((v) => Number(v.trim())) : spec.default;
  }
  return out;
}
