# The script Windows Sandbox runs at logon (npm run sandbox:check; sandbox-cli.ts copies it to the results
# folder and sandbox-model.ts wsbText() names it in the .wsb LogonCommand). PowerShell 5.1 syntax: that is
# what a clean Windows has [handle: Windows 11 ships Windows PowerShell 5.1; the version is recorded in
# results.json "powershell"]. It installs the setup silently, checks what the setup should have done, runs
# the bundled engine over stdio, uninstalls, checks the leftovers, writes results.json and shuts the
# Sandbox down. No Python, no Node on the PATH (a clean Windows has none).
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$NodeVersion
)

$ErrorActionPreference = 'Continue'
$Results = 'C:\Results'
$Setup = "C:\Release\LrC-AVG-Setup-$Version.exe"
$Inst = Join-Path $env:LOCALAPPDATA 'LrC-AVG'
$NodeExe = Join-Path $Inst 'resources\node\node.exe'
$Modules = Join-Path $env:APPDATA 'Adobe\Lightroom\Modules\LrC-AVG.lrplugin'
$KeepData = @('logs', 'intents', 'last-start.json', 'setup-result.json', 'setup-result.txt', 'status.txt')
$script:Checks = New-Object System.Collections.ArrayList
$script:Facts = [ordered]@{}

function Step([string]$Text) {
  Add-Content -LiteralPath (Join-Path $Results 'progress.txt') -Value ((Get-Date -Format o) + ' ' + $Text)
}

function Check([string]$Name, [bool]$Ok, [string]$Detail) {
  [void]$script:Checks.Add([pscustomobject]@{ check = $Name; ok = $Ok; detail = $Detail })
  Step ((@('FAIL', 'ok')[[int]$Ok]) + ': ' + $Name + ' - ' + $Detail)
}

function ReadJson([string]$Path) {
  try { return (Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json) } catch { return $null }
}

# results.json is written whole (temp file, then rename), so the host never reads half of it.
function Save() {
  $doc = [ordered]@{
    finished   = $true
    version    = $Version
    powershell = $PSVersionTable.PSVersion.ToString()
    os         = (Get-CimInstance Win32_OperatingSystem).Caption + ' ' + (Get-CimInstance Win32_OperatingSystem).BuildNumber
    checks     = @($script:Checks)
    facts      = $script:Facts
  }
  $tmp = Join-Path $Results 'results.tmp'
  [System.IO.File]::WriteAllText($tmp, (ConvertTo-Json -InputObject $doc -Depth 6), (New-Object System.Text.UTF8Encoding $false))
  Move-Item -LiteralPath $tmp -Destination (Join-Path $Results 'results.json') -Force
}

function Settle([scriptblock]$Done, [int]$Seconds) {
  for ($i = 0; $i -lt $Seconds; $i++) { if (& $Done) { return }; Start-Sleep -Seconds 1 }
}

# One MCP session over the engine's stdio: initialize, then tools/list. Returns the tool count, or -1.
function EngineTools() {
  try { [Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $NodeExe
  $psi.Arguments = '"' + (Join-Path $Inst 'resources\engine\dist\mcp\main.js') + '"'
  $psi.UseShellExecute = $false
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $proc = [System.Diagnostics.Process]::Start($psi)
  $null = $proc.StandardError.ReadToEndAsync()
  # Raw UTF-8 bytes. Windows PowerShell 5.1 starts the redirected stdin with a byte order mark, so the first
  # message reaches Node as "BOM{...}" and fails to parse [handle: smoke test against a stub MCP server run by
  # Claude Code 2026-10-17: SyntaxError at the first JSON.parse; with [Console]::InputEncoding set to
  # UTF8Encoding($false) before Process.Start the same stub answered tools/list]. The encoding is set above.
  $utf8 = New-Object System.Text.UTF8Encoding $false
  foreach ($json in @(
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"sandbox-check","version":"1.0.0"}}}',
    '{"jsonrpc":"2.0","method":"notifications/initialized"}',
    '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
  )) {
    $bytes = $utf8.GetBytes($json + "`n")
    $proc.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
  }
  $proc.StandardInput.BaseStream.Flush()
  $tools = -1
  $pending = $null
  $deadline = (Get-Date).AddSeconds(40)
  while ((Get-Date) -lt $deadline -and $tools -lt 0) {
    if ($null -eq $pending) { $pending = $proc.StandardOutput.ReadLineAsync() }
    if (-not $pending.Wait(1000)) { continue }
    $line = $pending.Result
    $pending = $null
    if ($null -eq $line) { break }
    try {
      $msg = $line | ConvertFrom-Json
      if ($msg.id -eq 2) { $tools = @($msg.result.tools).Count }
    } catch { }
  }
  try { $proc.Kill() } catch { }
  return $tools
}

try {
  Step "start, setup $Setup"
  New-Item -ItemType Directory -Force -Path $Results | Out-Null
  Check 'no Node.js on the PATH before the setup' ($null -eq (Get-Command node -ErrorAction SilentlyContinue)) 'a clean Windows has none, so only the bundled Node can run the engine'
  Check 'the setup is in the mapped release folder' (Test-Path -LiteralPath $Setup) $Setup

  # 1. Silent install (NSIS /S).
  $local = Join-Path $env:TEMP (Split-Path -Leaf $Setup)
  Copy-Item -LiteralPath $Setup -Destination $local -Force
  $p = Start-Process -FilePath $local -ArgumentList '/S' -Wait -PassThru
  Check 'setup /S exits 0' ($p.ExitCode -eq 0) ('exit code ' + $p.ExitCode)

  $must = @('LrC-AVG Deck.exe', 'uninstall.exe', 'resources\node\node.exe', 'resources\engine\dist\mcp\main.js',
    'resources\engine\dist\setup\setup-cli.js', 'resources\plugin\LrC-AVG.lrplugin\Info.lua', 'resources\THIRD_PARTY_NOTICES.txt', 'resources\LICENSE.txt')
  $missing = @($must | Where-Object { -not (Test-Path -LiteralPath (Join-Path $Inst $_)) })
  Check 'installed files are in %LOCALAPPDATA%\LrC-AVG' ($missing.Count -eq 0) $(if ($missing.Count) { 'missing: ' + ($missing -join ', ') } else { [string]$must.Count + ' key files found' })
  $files = @(Get-ChildItem -LiteralPath $Inst -Recurse -File -Force -ErrorAction SilentlyContinue)
  $files | ForEach-Object { $_.FullName.Substring($Inst.Length + 1) } | Set-Content -LiteralPath (Join-Path $Results 'installed-files.txt')
  $script:Facts['installed_file_count'] = $files.Count
  $script:Facts['installed_bytes'] = ($files | Measure-Object -Property Length -Sum).Sum
  $deck = Join-Path $Inst 'LrC-AVG Deck.exe'
  $deckVersion = if (Test-Path -LiteralPath $deck) { (Get-Item -LiteralPath $deck).VersionInfo.ProductVersion } else { '' }
  $script:Facts['deck_version'] = $deckVersion
  Check 'the Deck exe is the setup''s version' ($deckVersion -like "$Version*") ('Deck ProductVersion "' + $deckVersion + '", expected ' + $Version)

  $keys = @(Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue | Get-ItemProperty | Where-Object { $_.DisplayName -like 'LrC-AVG*' })
  Check 'one LrC-AVG uninstall key in HKCU' ($keys.Count -eq 1) ($keys | ForEach-Object { $_.DisplayName + ' ' + $_.DisplayVersion })
  Check 'the plugin is in Lightroom''s Modules folder' (Test-Path -LiteralPath (Join-Path $Modules 'Info.lua')) $Modules

  # No Claude Desktop in a clean Windows: the hook reports not_found and changes nothing.
  $sr = ReadJson (Join-Path $Inst 'setup-result.json')
  Check 'setup-result.json: not_found (no Claude Desktop here)' ($null -ne $sr -and $sr.action -eq 'add' -and $sr.outcome -eq 'not_found') $(if ($null -eq $sr) { 'no setup-result.json' } else { $sr.outcome + ': ' + $sr.message })

  $nv = ''
  try { $nv = [string](& $NodeExe --version 2>&1) } catch { $nv = $_.Exception.Message }
  $script:Facts['bundled_node'] = $nv
  Check 'the bundled node.exe is the pinned Node' ($nv.Trim() -eq "v$NodeVersion") ('node --version printed "' + $nv.Trim() + '", expected v' + $NodeVersion)

  # 2. A Claude Desktop config made from nothing: setup-cli adds the entry, pointing at the bundled Node.
  $cfgDir = Join-Path $env:LOCALAPPDATA 'Claude-Data\claude_sandboxtest'
  New-Item -ItemType Directory -Force -Path $cfgDir | Out-Null
  $cfg = Join-Path $cfgDir 'claude_desktop_config.json'
  [System.IO.File]::WriteAllText($cfg, '{"mcpServers":{}}', (New-Object System.Text.UTF8Encoding $false))
  & $NodeExe (Join-Path $Inst 'resources\engine\dist\setup\setup-cli.js') --installer | Out-Null
  $sr = ReadJson (Join-Path $Inst 'setup-result.json')
  $entry = (ReadJson $cfg).mcpServers.'lrc-avg'
  Check 'setup-cli --installer adds the entry to a Claude Desktop config' ($null -ne $sr -and $sr.outcome -eq 'added' -and $null -ne $entry -and $entry.command -eq $NodeExe) $(if ($null -eq $entry) { 'no lrc-avg entry; outcome ' + $sr.outcome } else { 'command ' + $entry.command })

  # 3. The bundled engine over stdio: Node, sharp and the production packages load on a clean Windows.
  $tools = EngineTools
  $script:Facts['engine_tools'] = $tools
  Check 'the bundled engine answers initialize and tools/list' ($tools -gt 0) ([string]$tools + ' tools')
  $ls = ReadJson (Join-Path $Inst 'last-start.json')
  Check 'the engine wrote last-start.json for the client "sandbox-check"' ($null -ne $ls -and $ls.client_name -eq 'sandbox-check' -and $ls.engine_version -eq $Version) $(if ($null -eq $ls) { 'no last-start.json' } else { 'engine ' + $ls.engine_version + ', client ' + $ls.client_name })

  # 4. Uninstall (the uninstaller hands over to a copy of itself, so wait for the files to go).
  Step 'uninstall'
  $null = Start-Process -FilePath (Join-Path $Inst 'uninstall.exe') -ArgumentList '/S' -Wait -PassThru
  Settle { -not (Test-Path -LiteralPath (Join-Path $Inst 'resources')) -and -not (Test-Path -LiteralPath (Join-Path $Inst 'uninstall.exe')) } 90
  Start-Sleep -Seconds 3
  $left = @(Get-ChildItem -LiteralPath $Inst -Force -ErrorAction SilentlyContinue | Where-Object { $KeepData -notcontains $_.Name } | ForEach-Object { $_.Name })
  $script:Facts['left_in_install_folder'] = @(Get-ChildItem -LiteralPath $Inst -Force -Recurse -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName.Substring($Inst.Length + 1) })
  Check 'uninstall leaves only the kept data in %LOCALAPPDATA%\LrC-AVG' ($left.Count -eq 0) $(if ($left.Count) { 'left: ' + ($left -join ', ') } else { 'only ' + ($KeepData -join ', ') + ' may stay' })
  Check 'uninstall removes the plugin from Modules' (-not (Test-Path -LiteralPath $Modules)) $Modules
  $keys = @(Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue | Get-ItemProperty | Where-Object { $_.DisplayName -like 'LrC-AVG*' })
  Check 'uninstall removes the uninstall key' ($keys.Count -eq 0) ([string]$keys.Count + ' left')
  $shortcuts = @(Get-ChildItem (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs') -Recurse -Filter '*LrC-AVG*' -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
  Check 'uninstall removes the Start menu shortcut' ($shortcuts.Count -eq 0) $(if ($shortcuts.Count) { $shortcuts -join '; ' } else { 'none' })
  $after = ReadJson $cfg
  $still = $null -ne $after -and $null -ne $after.mcpServers.'lrc-avg'
  Check 'uninstall takes the entry out of the Claude Desktop config' (-not $still) $(if ($still) { 'lrc-avg is still in ' + $cfg } else { 'removed' })
  $sr = ReadJson (Join-Path $Inst 'setup-result.json')
  Check 'the data stays: setup-result.json records the removal' ($null -ne $sr -and $sr.action -eq 'remove') $(if ($null -eq $sr) { 'no setup-result.json' } else { $sr.action + ' ' + $sr.outcome })
}
catch {
  Check 'the guest script ran to the end' $false ($_ | Out-String)
}
Save
Step 'done'
shutdown.exe /s /t 5
