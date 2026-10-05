# Spike S9: checks what building the Tauri HUD needs on Windows, and prints the install step for
# anything missing. It installs nothing itself. Run from the repo root:
#   powershell -ExecutionPolicy Bypass -File spikes\S9\prereqs.ps1
# Sources (fetched 2026-10-04):
#   Tauri:  https://raw.githubusercontent.com/tauri-apps/tauri-docs/v2/src/content/docs/start/prerequisites.mdx
#   WebView2 detection: https://raw.githubusercontent.com/MicrosoftDocs/edge-developer/main/microsoft-edge/webview2/concepts/distribution.md

$missing = 0
function Report($name, $ok, $detail, $fix) {
    if ($ok) { Write-Host "OK       $name  $detail" }
    else { Write-Host "MISSING  $name"; $fix | ForEach-Object { Write-Host "         $_" }; $script:missing++ }
}

# Rust through rustup, with the MSVC toolchain as default (prerequisites.mdx:259-272).
$cargo = Get-Command cargo -ErrorAction SilentlyContinue
if (-not $cargo -and (Test-Path "$env:USERPROFILE\.cargo\bin\cargo.exe")) { $env:Path += ";$env:USERPROFILE\.cargo\bin"; $cargo = Get-Command cargo -ErrorAction SilentlyContinue }
$toolchain = if ($cargo) { (& rustup default 2>$null) -join ' ' } else { '' }
Report 'Rust (rustup, MSVC toolchain)' ($cargo -and $toolchain -match 'msvc') $toolchain @(
    'winget install --id Rustlang.Rustup        (prerequisites.mdx:259-262)',
    'rustup default stable-msvc                  (prerequisites.mdx:265-272)',
    'Then open a new PowerShell window.')

# Microsoft C++ Build Tools with "Desktop development with C++" (prerequisites.mdx:196-199).
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vc = if (Test-Path $vswhere) { & $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath } else { $null }
Report 'Microsoft C++ Build Tools' ([bool]$vc) "$vc" @(
    'Download the installer from https://visualstudio.microsoft.com/visual-cpp-build-tools/ and open it.',
    'During installation, check "Desktop development with C++".   (prerequisites.mdx:196-199)')

# WebView2 Runtime: pv (REG_SZ) above 0.0.0.0 under either key (distribution.md:133-142).
$client = 'Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
$pv = @("HKLM:\SOFTWARE\WOW6432Node\$client", "HKCU:\Software\$client") |
    ForEach-Object { (Get-ItemProperty -Path $_ -Name pv -ErrorAction SilentlyContinue).pv } |
    Where-Object { $_ -and $_ -ne '0.0.0.0' } | Select-Object -First 1
Report 'WebView2 Runtime' ([bool]$pv) "$pv" @(
    'Download the "Evergreen Bootstrapper" from https://developer.microsoft.com/en-us/microsoft-edge/webview2/#download-section and run it.   (prerequisites.mdx:211-213)')

# Node, for the harness (spikes\package.json "engines": node >= 22.18).
$node = (& node --version 2>$null)
Report 'Node >= 22.18' ($node -and [version]($node.TrimStart('v')) -ge [version]'22.18.0') "$node" @('Install Node 22.18 or later from https://nodejs.org/')

if ($missing) { Write-Host "`nPREREQUISITES: $missing MISSING (see above)"; exit 1 }
Write-Host "`nPREREQUISITES: ALL PRESENT. Build the HUD with: npm run s9:build -w spikes"
