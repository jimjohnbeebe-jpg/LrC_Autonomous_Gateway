# AVG-S2 — LrSocket dual socket

**Question (PHASES.md):** can the plugin listen on a `receive` socket (8765) and a `send` socket (8766), with Node connecting to both, exchanging messages, and a 1 MB base64 string surviving the round trip? What is the RTT?
**Rule:** Go = both directions work and ≥ 1 MB messages pass. No-go = adopt the HTTP polling fallback at ≤ 250 ms active (AVG-004).
**Context:** Automaat has shipped this dual-socket topology since May 2026 (`docs\AUTOMAAT_SURVEY.md` §4.3, §6), so the transport itself is expected to work [inference]. Nobody has measured *our* RTT or the **largest single message** LrSocket passes.

## What the harness does

- `plugin\spikes\S2.lrplugin`: menu items **Start** / **Stop** / **Show status**. Start binds `LrSocket` `mode="receive"` on **8765** and `mode="send"` on **8766**, and echoes every message back on 8766 as `<length Lua saw>:<message>`. It stops by itself after 15 minutes. Log: `%TEMP%\LrC-AVG\s2_log.txt`.
- `spikes\S2\client.ts`: connects to both ports, then sends `hello`, then 20 small pings (RTT), then **1,048,576 base64 chars**, then 2, 4, 8 and 16 MB until the first failure (or 512 KB down to 1 KB if 1 MB fails). It checks every echo and writes `%TEMP%\LrC-AVG\s2_client_<timestamp>.json`.

## Steps for Jim

1. Add the plugin folder `D:\Developer\LrC_Autonomous_Gateway\plugin\spikes\S2.lrplugin` (see "Adding a spike plugin" in `spikes\README.md`).
2. **File > Plug-in Extras > AVG S2 - Start echo server.** A small message ("AVG S2 echo server starting …") appears briefly.
3. In PowerShell, run:
   ```powershell
   cd D:\Developer\LrC_Autonomous_Gateway
   node spikes\S2\client.ts
   ```
4. While the client runs (up to about a minute), watch Lightroom. Does its window freeze or stop responding at any point? Remember yes or no.
5. When the PowerShell prompt returns, go back to Lightroom: **File > Plug-in Extras > AVG S2 - Show status.**
6. Screenshot the status dialog (**Win+Shift+S**) and save it as `D:\Developer\LrC_Autonomous_Gateway\docs\reports\phase0\S2-status.png`. Click **OK**.
7. **File > Plug-in Extras > AVG S2 - Stop echo server.**
8. Open `docs\reports\phase0\S2.md`. Under **"Observed (Jim)"**, paste the entire PowerShell output from step 3, then add the lines `Lightroom froze during the run: yes/no` (from step 4) and `Screenshot: docs\reports\phase0\S2-status.png`. Save. Do not commit.
9. Tell Claude Code: **"S2 done."** Claude Code reads `s2_log.txt` itself.

## If something goes wrong

- **The client prints `ECONNREFUSED` / "Is Lightroom running…"**: close Lightroom (**File > Exit**), start it again, and repeat from step 2. Automaat reports that ports can stay held after a plugin reload [upstream claim: `vendor\automaat\README.md:278`].
- **A Windows Firewall prompt appears**: click **Allow access**, then carry on. Add the line `Firewall prompt: yes` to the report.
- **The client prints `hello never echoed`**: carry on with steps 5–9. The status dialog and log explain it.
