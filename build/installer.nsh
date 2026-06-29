!include nsDialogs.nsh
!include LogicLib.nsh

!ifndef MUI_FINISHPAGE_RUN_TEXT
  !define MUI_FINISHPAGE_RUN_TEXT "Launch Holoshelf"
!endif

!ifndef MUI_FINISHPAGE_TITLE
  !define MUI_FINISHPAGE_TITLE "Holoshelf setup is complete"
!endif

!ifndef MUI_FINISHPAGE_TEXT
  !define MUI_FINISHPAGE_TEXT "The Holoshelf app files have been installed. Local user data at %APPDATA%\Holoshelf\data is preserved during installs, repairs, updates, and uninstalls."
!endif

!ifndef MUI_LICENSEPAGE_TEXT_TOP
  !define MUI_LICENSEPAGE_TEXT_TOP "Review this notice before continuing."
!endif

!ifndef MUI_LICENSEPAGE_TEXT_BOTTOM
  !define MUI_LICENSEPAGE_TEXT_BOTTOM "If you accept these terms, click I Agree to continue."
!endif

!ifdef BUILD_UNINSTALLER
!macro customUnWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Uninstall Holoshelf"
  !define MUI_WELCOMEPAGE_TEXT "This will remove the installed Holoshelf app files and shortcuts for the selected install. It will not delete local user data at %APPDATA%\Holoshelf\data, including ratings, playlists, tier boards, brackets, custom talents, API keys, and the local database."
  !insertmacro MUI_UNPAGE_WELCOME
!macroend
!endif

!ifndef BUILD_UNINSTALLER
Var HoloshelfShortcutDialog
Var HoloshelfDesktopShortcutCheckbox
Var HoloshelfStartMenuShortcutCheckbox
Var HoloshelfApplyShortcutChoices
Var HoloshelfCreateDesktopShortcut
Var HoloshelfCreateStartMenuShortcut
Var HoloshelfMaintenanceDialog
Var HoloshelfInstalledVersion
Var HoloshelfExistingInstallPath
Var HoloshelfMaintenanceNextLabel
Var HoloshelfExistingDesktopShortcutPath
Var HoloshelfExistingStartMenuShortcutPath
Var HoloshelfExistingShortcutName
Var HoloshelfExistingMenuDirectory

!macro customInstallMode
  ${If} $hasPerUserInstallation == "1"
  ${AndIf} $hasPerMachineInstallation == "0"
    StrCpy $isForceCurrentInstall "1"
  ${EndIf}

  ${If} $hasPerMachineInstallation == "1"
  ${AndIf} $hasPerUserInstallation == "0"
    StrCpy $isForceMachineInstall "1"
  ${EndIf}
!macroend

!macro customPageAfterChangeDir
  Function HoloshelfLoadExistingShortcutPaths
    ReadRegStr $HoloshelfExistingShortcutName SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" ShortcutName
    ${If} $HoloshelfExistingShortcutName == ""
      StrCpy $HoloshelfExistingShortcutName "${SHORTCUT_NAME}"
    ${EndIf}

    StrCpy $HoloshelfExistingDesktopShortcutPath "$DESKTOP\$HoloshelfExistingShortcutName.lnk"

    ReadRegStr $HoloshelfExistingMenuDirectory SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" MenuDirectory
    ${If} $HoloshelfExistingMenuDirectory == ""
      StrCpy $HoloshelfExistingStartMenuShortcutPath "$SMPROGRAMS\$HoloshelfExistingShortcutName.lnk"
    ${Else}
      StrCpy $HoloshelfExistingStartMenuShortcutPath "$SMPROGRAMS\$HoloshelfExistingMenuDirectory\$HoloshelfExistingShortcutName.lnk"
    ${EndIf}
  FunctionEnd

  Function HoloshelfMaintenancePage
    StrCpy $HoloshelfApplyShortcutChoices "0"

    ${If} ${Silent}
      Abort
    ${EndIf}

    ReadRegStr $HoloshelfExistingInstallPath SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${If} $HoloshelfExistingInstallPath == ""
      Abort
    ${EndIf}

    ReadRegStr $HoloshelfInstalledVersion SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" DisplayVersion
    ${If} $HoloshelfInstalledVersion == ""
      StrCpy $HoloshelfInstalledVersion "unknown"
    ${EndIf}

    ${If} $INSTDIR != $HoloshelfExistingInstallPath
      StrCpy $HoloshelfMaintenanceNextLabel "Install"
      !insertmacro MUI_HEADER_TEXT "Move Holoshelf" "Setup will install this version in the selected folder."
    ${ElseIf} $HoloshelfInstalledVersion == "${VERSION}"
      StrCpy $HoloshelfMaintenanceNextLabel "Repair"
      !insertmacro MUI_HEADER_TEXT "Repair Holoshelf" "Setup will reinstall this version at the existing location."
    ${Else}
      StrCpy $HoloshelfMaintenanceNextLabel "Install"
      !insertmacro MUI_HEADER_TEXT "Install This Version" "Setup will replace the installed app files with this version."
    ${EndIf}

    nsDialogs::Create 1018
    Pop $HoloshelfMaintenanceDialog

    ${If} $HoloshelfMaintenanceDialog == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0u 0u 300u 14u "Existing install:"
    Pop $0

    ${NSD_CreateLabel} 10u 16u 290u 20u "$HoloshelfExistingInstallPath"
    Pop $0

    ${NSD_CreateLabel} 0u 40u 300u 14u "Selected install folder:"
    Pop $0

    ${NSD_CreateLabel} 10u 56u 290u 20u "$INSTDIR"
    Pop $0

    ${NSD_CreateLabel} 0u 82u 145u 14u "Installed version: $HoloshelfInstalledVersion"
    Pop $0

    ${NSD_CreateLabel} 155u 82u 145u 14u "Installer version: ${VERSION}"
    Pop $0

    ${NSD_CreateLabel} 0u 100u 300u 42u "Continuing replaces the app files with this installer version. If the selected folder differs, setup removes the old app folder. Local user data at %APPDATA%\Holoshelf\data is preserved."
    Pop $0

    Call HoloshelfLoadExistingShortcutPaths

    ${NSD_CreateCheckbox} 0u 148u 145u 14u "Keep/create desktop shortcut"
    Pop $HoloshelfDesktopShortcutCheckbox
    ${If} ${FileExists} "$HoloshelfExistingDesktopShortcutPath"
      SendMessage $HoloshelfDesktopShortcutCheckbox ${BM_SETCHECK} ${BST_CHECKED} 0
    ${EndIf}

    ${NSD_CreateCheckbox} 155u 148u 145u 14u "Keep/create Start Menu shortcut"
    Pop $HoloshelfStartMenuShortcutCheckbox
    ${If} ${FileExists} "$HoloshelfExistingStartMenuShortcutPath"
      SendMessage $HoloshelfStartMenuShortcutCheckbox ${BM_SETCHECK} ${BST_CHECKED} 0
    ${EndIf}

    ${NSD_CreateLabel} 0u 168u 300u 20u "Shortcut choices preserve the current state by default. Check one to create it during this setup run."
    Pop $0

    GetDlgItem $0 $HWNDPARENT 1
    SendMessage $0 ${WM_SETTEXT} 0 "STR:$HoloshelfMaintenanceNextLabel"

    nsDialogs::Show
  FunctionEnd

  Function HoloshelfMaintenanceLeave
    StrCpy $HoloshelfApplyShortcutChoices "1"

    SendMessage $HoloshelfDesktopShortcutCheckbox ${BM_GETCHECK} 0 0 $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $HoloshelfCreateDesktopShortcut "1"
    ${Else}
      StrCpy $HoloshelfCreateDesktopShortcut "0"
    ${EndIf}

    SendMessage $HoloshelfStartMenuShortcutCheckbox ${BM_GETCHECK} 0 0 $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $HoloshelfCreateStartMenuShortcut "1"
    ${Else}
      StrCpy $HoloshelfCreateStartMenuShortcut "0"
    ${EndIf}
  FunctionEnd

  Function HoloshelfShortcutOptionsPage
    StrCpy $HoloshelfApplyShortcutChoices "0"

    ${If} ${Silent}
      Abort
    ${EndIf}

    ${If} $installMode == "all"
      ${If} $hasPerMachineInstallation == "1"
        Abort
      ${EndIf}
    ${Else}
      ${If} $hasPerUserInstallation == "1"
        Abort
      ${EndIf}
    ${EndIf}

    ${If} $installMode == "all"
      !insertmacro MUI_HEADER_TEXT "Shortcut Options" "Choose shortcuts for all users of this PC."
    ${Else}
      !insertmacro MUI_HEADER_TEXT "Shortcut Options" "Choose shortcuts for this Windows user."
    ${EndIf}

    nsDialogs::Create 1018
    Pop $HoloshelfShortcutDialog

    ${If} $HoloshelfShortcutDialog == error
      Abort
    ${EndIf}

    ${If} $installMode == "all"
      ${NSD_CreateLabel} 0u 0u 300u 28u "Setup can add shortcuts for every user on this PC."
    ${Else}
      ${NSD_CreateLabel} 0u 0u 300u 28u "Setup can add shortcuts for this Windows user."
    ${EndIf}
    Pop $0

    ${NSD_CreateCheckbox} 0u 42u 300u 14u "Create a desktop shortcut"
    Pop $HoloshelfDesktopShortcutCheckbox
    SendMessage $HoloshelfDesktopShortcutCheckbox ${BM_SETCHECK} ${BST_CHECKED} 0

    ${NSD_CreateCheckbox} 0u 64u 300u 14u "Add Holoshelf to the Start Menu"
    Pop $HoloshelfStartMenuShortcutCheckbox
    SendMessage $HoloshelfStartMenuShortcutCheckbox ${BM_SETCHECK} ${BST_CHECKED} 0

    ${NSD_CreateLabel} 0u 94u 300u 36u "Removing shortcuts later will not affect app updates or local user data at %APPDATA%\Holoshelf\data."
    Pop $0

    nsDialogs::Show
  FunctionEnd

  Function HoloshelfShortcutOptionsLeave
    StrCpy $HoloshelfApplyShortcutChoices "1"

    SendMessage $HoloshelfDesktopShortcutCheckbox ${BM_GETCHECK} 0 0 $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $HoloshelfCreateDesktopShortcut "1"
    ${Else}
      StrCpy $HoloshelfCreateDesktopShortcut "0"
    ${EndIf}

    SendMessage $HoloshelfStartMenuShortcutCheckbox ${BM_GETCHECK} 0 0 $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $HoloshelfCreateStartMenuShortcut "1"
    ${Else}
      StrCpy $HoloshelfCreateStartMenuShortcut "0"
    ${EndIf}
  FunctionEnd

  !insertmacro MUI_PAGE_INIT
  PageEx custom
    PageCallbacks HoloshelfMaintenancePage HoloshelfMaintenanceLeave
    Caption "Update or Repair"
  PageExEnd

  !insertmacro MUI_PAGE_INIT
  PageEx custom
    PageCallbacks HoloshelfShortcutOptionsPage HoloshelfShortcutOptionsLeave
    Caption "Shortcut Options"
  PageExEnd
!macroend

!macro customInstall
  ${If} $HoloshelfApplyShortcutChoices == "1"
    ${If} $HoloshelfCreateDesktopShortcut != "1"
      WinShell::UninstShortcut "$newDesktopLink"
      Delete "$newDesktopLink"
    ${EndIf}

    ${If} $HoloshelfCreateStartMenuShortcut != "1"
      WinShell::UninstShortcut "$newStartMenuLink"
      Delete "$newStartMenuLink"
      !ifdef MENU_FILENAME
        RMDir "$SMPROGRAMS\${MENU_FILENAME}"
      !endif
      StrCpy $launchLink "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    ${EndIf}

    System::Call 'shell32::SHChangeNotify(i, i, i, i) v (0x08000000, 0, 0, 0)'
  ${EndIf}
!macroend
!endif
