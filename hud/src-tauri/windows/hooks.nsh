; LrC-AVG setup hooks (Phase 9 PR 1, plan D1-D5): the Tauri NSIS installer of the Deck also installs the
; bundled Node, the engine and the Lightroom plugin, and writes Claude Desktop's entry.
; Included by Tauri's installer.nsi when hud\src-tauri\tauri.setup.conf.json is merged
; (bundle.windows.nsis.installerHooks); the Deck-only build (tauri.conf.json) has no hooks.
; Template facts below are from tauri-cli-v2.12.1 crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi
; and utils.nsh [handle: https://raw.githubusercontent.com/tauri-apps/tauri/tauri-cli-v2.12.1/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi, read 2026-10-17]:
;   - this file is !included before the template's !defines and Vars (installer.nsi:35-37), so it holds
;     macros only: their bodies expand inside the template's sections, where PRODUCTNAME, $PassiveMode,
;     $UpdateMode and $DeleteAppDataCheckboxState exist (installer.nsi:74-75, 427);
;   - PREINSTALL runs after SetOutPath and before the template's own Restart Manager check of the Deck exe
;     and the file copy (installer.nsi:640-646); POSTINSTALL after files, registry and shortcuts (734);
;     PREUNINSTALL before anything is removed (779); POSTUNINSTALL after the template's own app-data
;     removal (871-888);
;   - $UpdateMode is 1 only with /UPDATE on the command line (installer.nsi:489-491, 771-773), which the
;     template passes to the old uninstaller only when the new installer itself runs with /UPDATE (358).
;     A double-clicked newer setup runs the old uninstaller without /UPDATE ("uninstall before installing"
;     is preselected, PageReinstall/PageLeaveReinstall), but always with "_?=<install folder>" (generated
;     target\release\nsis\x64\installer.nsi:355). _?= makes an uninstaller run in place instead of from a
;     copy in %TEMP% [handle: https://nsis.sourceforge.io/Docs/Chapter3.html#installerusageuninstaller];
;     Settings > Apps and a direct /S run start uninstall.exe without it (installer.nsi:5238 writes the UninstallString with no _?=). So "$EXEDIR" == "$INSTDIR" in the
;     uninstaller means a new setup is replacing this one [inference; unverified until Jim's upgrade run].
; Everything a hook does on a real PC is [unverified] until Jim's run 1 (plan "Jim run 1").
; ASCII only, so the file reads the same in any NSIS code page [inference].

!define LRCAVG_NODE "$INSTDIR\resources\node\node.exe"
!define LRCAVG_SETUP_CLI "$INSTDIR\resources\engine\dist\setup\setup-cli.js"
!define LRCAVG_MODULES "$APPDATA\Adobe\Lightroom\Modules"
!define LRCAVG_DATA "$LOCALAPPDATA\LrC-AVG"

; Closes the processes that hold the bundled node.exe (the engine Claude Desktop or another client
; started), with Windows Restart Manager, restricted to that one file. It is the template's own
; CheckIfAppIsRunning sequence (utils.nsh:24-49) written out, not called: that macro names its labels by
; ${__LINE__}, and whether a second use in the same section gets distinct labels is [unverified].
; Never by image name: other node.exe processes on the PC are not ours.
!macro LrcAvgCloseEngine
  !insertmacro RestartManager_StartSession $R0
  ${If} $R0 != ""
    !insertmacro RestartManager_RegisterFile $R0 "${LRCAVG_NODE}"
    ${If} $0 = 0
      System::Call 'RSTRTMGR::RmGetList(p R0, *i .r1, *i .r2, p 0, *i .r3) i .r0'
      ${If} $0 = ${ERROR_MORE_DATA} ; some process uses the file (utils.nsh:39)
        StrCpy $1 1
        ${IfNot} ${Silent}
        ${AndIf} $PassiveMode <> 1
          MessageBox MB_OKCANCEL|MB_ICONQUESTION "The LrC-AVG engine is running (an AI client such as Claude Desktop started it).$\r$\n$\r$\nOK closes it; the AI client starts it again on its next start. Cancel stops here." IDOK +2
          StrCpy $1 0
        ${EndIf}
        ${If} $1 = 1
          System::Call 'RSTRTMGR::RmShutdown(p R0, i ${RmForceShutdown}, p 0) i .r0'
          ${If} $0 <> 0
            !insertmacro RestartManager_EndSession $R0
            Abort "The LrC-AVG engine could not be closed. Quit Claude Desktop and your other AI clients, then run this again."
          ${EndIf}
        ${Else}
          !insertmacro RestartManager_EndSession $R0
          Abort "Cancelled: the LrC-AVG engine is still running."
        ${EndIf}
      ${EndIf}
    ${EndIf}
    !insertmacro RestartManager_EndSession $R0
  ${EndIf}
!macroend

; $0 = how many of Lightroom Classic and Claude Desktop are running, $1 = their names.
; Claude Desktop goes by its path: Claude Code's claude.exe (%USERPROFILE%\.local\bin) has the same name
; [handle: plan "Found" 7, Get-Process 2026-10-17]. \WindowsApps\Claude_ is the Microsoft Store build
; (plan "Found" 1); \AnthropicClaude\ is the other Windows installer's folder [unverified].
; Win32_Process gives ExecutablePath to a 32-bit PowerShell too [inference]; the 64-bit one is used
; when there (Sysnative), since the installer is a 32-bit process [inference: NSIS builds x86 stubs].
!macro LrcAvgRunningApps
  StrCpy $2 "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
  ${IfNot} ${FileExists} "$2"
    StrCpy $2 "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
  ${EndIf}
  nsExec::ExecToStack `"$2" -NoProfile -NonInteractive -Command "$$n=@(); $$p=@(Get-CimInstance Win32_Process | Where-Object { $$_.Name -in 'Lightroom.exe','Claude.exe' }); if ($$p | Where-Object { $$_.Name -eq 'Lightroom.exe' }) { $$n+='Lightroom Classic' }; if ($$p | Where-Object { $$_.ExecutablePath -match '\\WindowsApps\\Claude_|\\AnthropicClaude\\' }) { $$n+='Claude Desktop' }; Write-Output ($$n -join ' and '); exit $$n.Count"`
  Pop $0 ; exit code, or "error"/"timeout" (then 0 below) [upstream claim: https://nsis.sourceforge.io/Docs/nsExec/nsExec.txt]
  Pop $1
!macroend

!macro NSIS_HOOK_PREINSTALL
  ; Lightroom and Claude Desktop load the plugin and the entry only when they start [inference]: ask to close them.
  ; Ignore goes on (they are restarted afterwards). No box under /S or /P.
  ${IfNot} ${Silent}
  ${AndIf} $PassiveMode <> 1
    lrcavg_apps_check:
    !insertmacro LrcAvgRunningApps
    ${If} $0 > 0
      MessageBox MB_ABORTRETRYIGNORE|MB_ICONEXCLAMATION "Please close: $1$\r$\nLrC-AVG adds a plugin to Lightroom Classic and an entry to Claude Desktop; each loads them only when it starts.$\r$\n$\r$\nRetry: check again.  Ignore: install now and restart them afterwards.  Abort: cancel setup." IDRETRY lrcavg_apps_check IDIGNORE lrcavg_apps_done
      Abort "Setup was cancelled."
    ${EndIf}
    lrcavg_apps_done:
  ${EndIf}
  !insertmacro LrcAvgCloseEngine
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; The Deck's version for the plugin's Status dialog (plan D10; MenuStatus.lua). ${VERSION} is the
  ; template's tauri.conf.json version (generated installer.nsi:38).
  ClearErrors
  FileOpen $2 "$INSTDIR\deck-version.txt" w
  ${IfNot} ${Errors}
    FileWrite $2 "${VERSION}"
    FileClose $2
  ${EndIf}
  ; The plugin into Lightroom's Modules folder (plan D3), replacing an older copy. CopyFiles of a folder
  ; puts it inside the target folder [inference: SHFileOperation semantics].
  CreateDirectory "${LRCAVG_MODULES}"
  RMDir /r "${LRCAVG_MODULES}\LrC-AVG.lrplugin"
  ClearErrors
  CopyFiles /SILENT "$INSTDIR\resources\plugin\LrC-AVG.lrplugin" "${LRCAVG_MODULES}"
  StrCpy $3 ""
  ${If} ${Errors}
    StrCpy $3 "$\r$\n$\r$\nThe Lightroom plugin could not be copied to ${LRCAVG_MODULES}."
  ${EndIf}
  ; Claude Desktop's entry (plan D4): setup-cli --installer never fails the install and writes
  ; setup-result.txt, one plain paragraph. A failure here only shows in that text.
  Delete "${LRCAVG_DATA}\setup-result.txt"
  nsExec::ExecToLog `"${LRCAVG_NODE}" "${LRCAVG_SETUP_CLI}" --installer`
  Pop $0
  ${IfNot} ${Silent}
  ${AndIf} $PassiveMode <> 1
    StrCpy $1 "LrC-AVG could not report on Claude Desktop's entry (exit code $0)."
    ClearErrors
    FileOpen $2 "${LRCAVG_DATA}\setup-result.txt" r
    ${IfNot} ${Errors}
      FileRead $2 $1 ; one line; read as ANSI, so non-ASCII text may show wrong [inference]
      FileClose $2
    ${EndIf}
    MessageBox MB_OK|MB_ICONINFORMATION "$1$3$\r$\n$\r$\nRestart Lightroom Classic and Claude Desktop so they load LrC-AVG."
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro LrcAvgCloseEngine
  Delete "$INSTDIR\deck-version.txt"
  ; Not when a new setup runs this uninstaller first (/UPDATE, or in place with _?=, see the top): the
  ; new version's POSTINSTALL writes entry and plugin again, and a new setup that stops before that
  ; leaves them in place, so running it again repairs the install.
  ${If} $UpdateMode <> 1
  ${AndIf} "$EXEDIR" != "$INSTDIR"
    nsExec::ExecToLog `"${LRCAVG_NODE}" "${LRCAVG_SETUP_CLI}" --remove --installer`
    Pop $0
    RMDir /r "${LRCAVG_MODULES}\LrC-AVG.lrplugin"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; "Delete the application data" ticked (plan D5): the template removed only $APPDATA\<identifier> and
  ; $LOCALAPPDATA\<identifier> (installer.nsi:871-884). This removes LrC-AVG's own data, by name, and
  ; nothing else in %LOCALAPPDATA%\LrC-AVG; that the box's state reaches this hook is [unverified].
  ; Never when a new setup runs this uninstaller (the box shows then too [unverified]): an upgrade keeps the data.
  ; %USERPROFILE%\.lrc-avg holds the bridge token, the ports file and hud_endpoint.json; the plugin
  ; and the engine write them again on their next start (Endpoint.lua, engine\src\hud\channel.ts).
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
  ${AndIf} "$EXEDIR" != "$INSTDIR"
    RMDir /r "${LRCAVG_DATA}\logs"
    RMDir /r "${LRCAVG_DATA}\intents"
    RMDir /r "${LRCAVG_DATA}\previews"
    RMDir /r "${LRCAVG_DATA}\hud"
    Delete "${LRCAVG_DATA}\last-start.json"
    Delete "${LRCAVG_DATA}\setup-result.json"
    Delete "${LRCAVG_DATA}\setup-result.txt"
    Delete "${LRCAVG_DATA}\status.txt"
    RMDir "${LRCAVG_DATA}" ; only when empty
    RMDir /r "$TEMP\LrC-AVG"
    RMDir /r "$PROFILE\.lrc-avg"
  ${EndIf}
!macroend
