;Include Modern UI
!include "MUI2.nsh"
!include x64.nsh

;--------------------------------
;Styling
!define MUI_ICON "brand.ico"
Icon "brand.ico"
BrandingText "Etherpad Foundation"
Name "Etherpad Server"
OutFile "..\..\..\etherpad-win.exe"

!insertmacro MUI_LANGUAGE "English"

Page directory
Page instfiles

; The default installation directory
InstallDir "$PROGRAMFILES64\Etherpad Foundation\Etherpad Server"

Section
  SectionIn RO

  ${If} ${RunningX64}
    DetailPrint "Installer running on x64 host"
  ${Else}
    Abort "Unsupported CPU architecture (only x64 is supported)"
  ${Endif}

  ; Set output path to the installation directory.
  SetOutPath $INSTDIR

  ; Put files there
  File /r "..\..\..\..\etherpad-zip\*"

SectionEnd

Section
  CreateDirectory "$SMPROGRAMS\Etherpad Foundation"
  CreateShortCut "$SMPROGRAMS\Etherpad Foundation\Etherpad Server.lnk" "$INSTDIR\start.bat" "brand.ico" "Etherpad Server"
  CreateShortCut "$SMPROGRAMS\Etherpad Foundation\Etherpad.lnk" "http://127.0.0.1:9001" "brand.ico" "Etherpad"
  CreateShortCut "$SMPROGRAMS\Etherpad Foundation\Etherpad Admin.lnk" "http://127.0.0.1:9001/admin" "brand.ico" "Etherpad Admin"
  CreateShortCut "$SMPROGRAMS\Etherpad Foundation\Uninstall Etherpad Server.lnk" "$INSTDIR\uninstall.exe"
  WriteUninstaller "$INSTDIR\uninstall.exe"
  Exec '$INSTDIR\start.bat'
SectionEnd

UninstPage instfiles

Section Uninstall
  Delete "$INSTDIR\*"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"
  SetAutoClose false
SectionEnd
