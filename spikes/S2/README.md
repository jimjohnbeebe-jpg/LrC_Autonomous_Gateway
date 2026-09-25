# AVG-S2 — LrSocket dual socket

**Question (PHASES.md):** can the plugin listen on a `receive` socket (8765) and a `send` socket (8766), with Node connecting to both, exchanging messages, and a 1 MB base64 string surviving the round trip? What is the RTT?
**Rule:** Go = both directions work and ≥ 1 MB messages pass. No-go = adopt the HTTP polling fallback at ≤ 250 ms active (AVG-004).
**Context:** Automaat has shipped this dual-socket topology since May 2026 (`docs\AUTOMAAT_SURVEY.md` §4.3, §6), so the transport itself is expected to work [inference]. Nobody has measured *our* RTT or the **largest single message** LrSocket passes.

## What the harness does

- `plugin\spikes\S2.lrplugin`: **Start** opens the two listeners and echoes every message back. **Stop** closes them, asks you one question (did Lightroom freeze?), and saves your answer with its counters and log.
- `spikes\S2\client.ts`: connects to both ports, then sends `hello`, 20 small pings, a 1 MB message, and 2 → 16 MB messages until one fails. It checks every echo.
- Everything is saved automatically to `%TEMP%\LrC-AVG\S2\`, and Claude Code collects it. There is nothing to copy, paste or screenshot.

## Steps for Jim

1. Add the plugin folder `D:\Developer\LrC_Autonomous_Gateway\plugin\spikes\S2.lrplugin` (see "Adding a spike plugin" in `spikes\README.md`).
2. In Lightroom: **File > Plug-in Extras > AVG S2 - Start echo server.** A short message confirms it.
3. In PowerShell, run:
   ```powershell
   cd D:\Developer\LrC_Autonomous_Gateway
   node spikes\S2\client.ts
   ```
   It takes up to about a minute. While it runs, notice whether Lightroom keeps responding (for example, whether you can still scroll the filmstrip).
4. When PowerShell says "Done", go back to Lightroom: **File > Plug-in Extras > AVG S2 - Stop echo server.** A window asks one question. Tick the box **only if** Lightroom froze or stopped responding during step 3, then click **Save**.
5. Tell Claude Code: **"S2 done."**

## If something goes wrong

- **PowerShell prints "FAILED to connect"**: close Lightroom (**File > Exit**), start it again, and repeat from step 2. Automaat reports that ports can stay held after a plugin reload [upstream claim: `vendor\automaat\README.md:278`].
- **A Windows Firewall prompt appears**: click **Allow access**, carry on, and mention it when you tell Claude Code.
