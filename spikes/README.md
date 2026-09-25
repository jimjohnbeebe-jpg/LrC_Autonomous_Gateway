# Phase 0 spikes (AVG-S1 … AVG-S6)

Throwaway harnesses that answer the feasibility questions in PHASES.md Phase 0. Claude Code wrote the harnesses and the report templates. **Jim runs the Lightroom parts and then tells Claude Code "S<n> done". The harnesses save their results themselves, and Claude Code collects them. Jim copies, pastes and screenshots nothing.**

| Spike | Question | Lightroom plugin | Node script(s) | README |
|---|---|---|---|---|
| S1 | How fast is a fresh `requestJpegThumbnail` after `applyDevelopSettings`? | `plugin\spikes\S1.lrplugin` | `spikes\S1\measure.ts` | [S1](S1/README.md) |
| S2 | Do LrSocket receive+send listeners work, how big a message survives, what RTT? | `plugin\spikes\S2.lrplugin` | `spikes\S2\client.ts` | [S2](S2/README.md) |
| S3 | Does Claude Desktop (and Claude Code) show an MCP image result and describe it? | — | `spikes\S3\server.ts` | [S3](S3/README.md) |
| S4 | Is a floating dialog non-modal, live-updating, and polite about focus? | `plugin\spikes\S4.lrplugin` | — | [S4](S4/README.md) |
| S5 | What are the real develop-setting keys and CameraProfile strings? Are profile + lens toggles writable? | `plugin\spikes\S5.lrplugin` | `spikes\S5\pin.ts` | [S5](S5/README.md) |
| S6 | Does `createVirtualCopies` work from Loupe and Grid, and are the copies addressable? | `plugin\spikes\S6.lrplugin` | — | [S6](S6/README.md) |

## Run order

1. S1: done (report accepted, `docs\reports\phase0\S1.md`)
2. S5: part 1 done; part 2 per `S5\README.md`
3. S2
4. S4
5. S6
6. S3

## One-time setup (already done on this machine)

Nothing to do: the dependencies are installed and Node is v24.11.1. Handle: these commands, run in `D:\Developer\LrC_Autonomous_Gateway` on 2026-09-24T03:14Z by Claude Code, printed:

```
> node -v
v24.11.1
> npm ls --depth=0 --all
lrc-avg-workspace@ D:\Developer\LrC_Autonomous_Gateway
├─┬ lrc-avg-spikes@0.0.0 -> .\spikes
│ ├── @modelcontextprotocol/sdk@1.30.1
│ ├── @types/node@24.13.6
│ ├── sharp@0.35.4
│ ├── typescript@7.0.2
│ └── zod@4.6.5
└─┬ lrc-avg@0.0.0 -> .\engine
  ├── @modelcontextprotocol/sdk@1.30.1 deduped
  ├── @types/node@24.13.6 deduped
  ├── sharp@0.35.4 deduped
  ├── typescript@7.0.2 deduped
  ├── vitest@5.0.1
  └── zod@4.6.5 deduped
> npm audit
found 0 vulnerabilities
```

## Adding a spike plugin to Lightroom (each spike README says when)

1. **File > Plug-in Manager**.
2. Click **Add** (bottom left).
3. Browse to the spike's folder, e.g. `D:\Developer\LrC_Autonomous_Gateway\plugin\spikes\S5.lrplugin`, select the folder itself, and click **Select Folder**.
4. Check that the new entry shows **Enabled**, then click **Done**.

Leave each spike plugin installed after its run. They should not conflict with each other [inference: each plugin has its own `LrToolkitIdentifier` (`plugin\spikes\S<n>.lrplugin\Info.lua`) and its own menu items, and only S2 opens sockets, and only after its Start menu item]. Their menu items are under **File > Plug-in Extras** [inference: S1 run 1 was started from that menu path, as its README said].

## How results get into the repo (every spike)

1. Each harness saves its results automatically to `%TEMP%\LrC-AVG\S<n>\`. Plugin output stays in the temp folder (`.claude\rules\03-lightroom.md` "Plugin hygiene").
2. Anything only Jim can observe (did Lightroom freeze, did the HUD stay in front, …) the harness asks in a Lightroom window with tick boxes and saves with the rest. For S3, Jim answers two questions in the chat.
3. Jim tells Claude Code "S<n> done".
4. Claude Code copies the files into `docs\reports\phase0\S<n>\`, fills the report, and takes it through a Greptile-reviewed PR.

## Verified here without Lightroom (Claude Code)

- All Lua files parse as Lua 5.1 [handle: Claude Code, scratch install `luaparse@0.3.1` (not a project dependency), `luaparse.parse(src, { luaVersion: "5.1" })` over `plugin\**\*.lua` → "25/25 Lua files parse as Lua 5.1", run 2026-09-25 on branch `phase-0/spike-steps-automation`]. That proves syntax only, not SDK behaviour.
- `spikes\S2\client.ts` (2026-09-25 version) was run against the fake echo server with `TEMP` pointed at a scratch folder: it saved `LrC-AVG\S2\s2_client_*.json` there, including on the connect-failure path ("FAILED to connect: … ECONNREFUSED") [handle: Claude Code session 2026-09-25; the real `%TEMP%\LrC-AVG\S2\` was not touched].
- `spikes\S3\install-desktop-config.ts` was run only against synthetic configs in a scratch folder, never the real one [handle: Claude Code session 2026-09-25]. Results: MSIX-style discovery via a fake `LOCALAPPDATA` found the file; the entry was added with one timestamped backup; the other servers and settings were kept; a fake token in another server's `env` was not printed; a second run printed "already set up. Nothing changed."; missing config, invalid JSON and `--dry-run` all left the files untouched.
- `SpikeJson.lua` (S5) runs under fengari 0.1.4 (a Lua 5.3 VM); its output parses with Node's `JSON.parse` and passes 17/17 value checks [handle: `docs\reports\phase0\S5.md` "Pre-run findings"].
- `spikes\S1\measure.ts` was run on the run-1 CSV and on synthetic CSVs covering the retry success path and a stale frame [handle: `docs\reports\phase0\S1.md` "Pre-run findings" and "Run 1 analysis"].
- `spikes\S2\client.ts` was run against a fake Node echo server [handle: `docs\reports\phase0\S2.md` "Pre-run findings"].
- `spikes\S3\server.ts` was exercised via `node spikes\S3\smoke-client.ts` [handle: `docs\reports\phase0\S3.md` "Pre-run findings"].
- `node spikes\S5\pin.ts engine\tests\fixtures\synthetic-s5-dump-a.json engine\tests\fixtures\synthetic-s5-dump-b.json --dry-run` was run [handle: `docs\reports\phase0\S5.md` "Pre-run findings"].
