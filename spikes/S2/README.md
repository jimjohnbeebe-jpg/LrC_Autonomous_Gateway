# AVG-S2 — LrSocket dual socket

**Question (PHASES.md):** can the plugin listen on a `receive` socket (8765) and a `send` socket (8766), with Node connecting to both, exchanging messages, and a 1 MB base64 string surviving the round trip? What is the RTT?
**Rule:** Go = both directions work and ≥ 1 MB messages pass. No-go = adopt the HTTP polling fallback at ≤ 250 ms active (AVG-004).
**Context:** Automaat has shipped this dual-socket topology since May 2026 on ports 58763/58764 (`docs\AUTOMAAT_SURVEY.md` §4.3, §6), so the transport itself is expected to work [inference]. What nobody has measured is *our* RTT and the **largest single message** LrSocket passes (Automaat only sends small JSON).

## What the harness does

- `plugin\spikes\S2.lrplugin`: menu items **Start** / **Stop** / **Show status**. Start binds `LrSocket` `mode="receive"` on **8765** and `mode="send"` on **8766**. Every message received is echoed on 8766 as `<length Lua saw>:<message>\n`. The server stops by itself after 15 minutes. Log: `$env:TEMP\LrC-AVG\s2_log.txt`.
- `spikes\S2\client.ts`: connects to 8765 (writes) and 8766 (reads), sends `hello` (retried up to 3×), 20 small pings (RTT distribution), then **1,048,576 base64 chars**, then climbs 2 → 4 → 8 → 16 MB until the first failure. If 1 MB fails it steps down 512 → 256 → 64 → 16 → 1 KB instead. Each echo's length field and payload are checked. Results are also written to `$env:TEMP\LrC-AVG\s2_client_<timestamp>.json`.

## Run (Jim)

1. Add `D:\Developer\LrC_Autonomous_Gateway\plugin\spikes\S2.lrplugin` in Plug-in Manager.
2. **File > Plug-in Extras > AVG S2 - Start echo server** (a bezel confirms).
3. PowerShell:
   ```powershell
   cd D:\Developer\LrC_Autonomous_Gateway
   node spikes\S2\client.ts                  # add --max-mb 64 to probe further, --timeout-s 60 for slow cases
   ```
4. **File > Plug-in Extras > AVG S2 - Show status**: screenshot, or copy the text.
5. **AVG S2 - Stop echo server** when done.

If the client cannot connect, or the log shows `failed to open` after a *Reload Plug-in*, quit and restart Lightroom and try again. Automaat reports that reload does not always free the ports [upstream claim: `vendor\automaat\README.md:278`]. A Windows Firewall prompt is not expected for 127.0.0.1 [unverified]; if one appears, note it.

## What to paste into `docs\reports\phase0\S2.md`

- The full client output (the OK/FAIL lines plus the "report fields" block).
- The status dialog text or screenshot, plus the relevant lines of `s2_log.txt` (especially `send() returned after … ms` for the big messages).
- Anything odd: Lightroom UI stalls during the 8–16 MB messages, errors, reconnects.
