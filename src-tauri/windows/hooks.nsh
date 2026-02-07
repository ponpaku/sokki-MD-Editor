; File association hooks for Sokki MD Editor
; Registers .md and .markdown extensions on install, removes on uninstall

!macro NSIS_HOOK_POSTINSTALL
  ; Register .md
  WriteRegStr HKCU "Software\Classes\.md\OpenWithProgids" "SokkiMDEditor.md" ""
  WriteRegStr HKCU "Software\Classes\SokkiMDEditor.md" "" "Markdown Document"
  WriteRegStr HKCU "Software\Classes\SokkiMDEditor.md\DefaultIcon" "" "$INSTDIR\sokki-md-editor.exe,0"
  WriteRegStr HKCU "Software\Classes\SokkiMDEditor.md\shell\open\command" "" '"$INSTDIR\sokki-md-editor.exe" "%1"'

  ; Register .markdown
  WriteRegStr HKCU "Software\Classes\.markdown\OpenWithProgids" "SokkiMDEditor.markdown" ""
  WriteRegStr HKCU "Software\Classes\SokkiMDEditor.markdown" "" "Markdown Document"
  WriteRegStr HKCU "Software\Classes\SokkiMDEditor.markdown\DefaultIcon" "" "$INSTDIR\sokki-md-editor.exe,0"
  WriteRegStr HKCU "Software\Classes\SokkiMDEditor.markdown\shell\open\command" "" '"$INSTDIR\sokki-md-editor.exe" "%1"'

  ; Register in Applications key (for "Open with" dialog)
  WriteRegStr HKCU "Software\Classes\Applications\sokki-md-editor.exe\shell\open\command" "" '"$INSTDIR\sokki-md-editor.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\Applications\sokki-md-editor.exe\SupportedTypes" ".md" ""
  WriteRegStr HKCU "Software\Classes\Applications\sokki-md-editor.exe\SupportedTypes" ".markdown" ""

  ; Notify shell of changes
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x0000, p 0, p 0)'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Remove .md association
  DeleteRegValue HKCU "Software\Classes\.md\OpenWithProgids" "SokkiMDEditor.md"
  DeleteRegKey HKCU "Software\Classes\SokkiMDEditor.md"

  ; Remove .markdown association
  DeleteRegValue HKCU "Software\Classes\.markdown\OpenWithProgids" "SokkiMDEditor.markdown"
  DeleteRegKey HKCU "Software\Classes\SokkiMDEditor.markdown"

  ; Remove Applications key
  DeleteRegKey HKCU "Software\Classes\Applications\sokki-md-editor.exe"

  ; Notify shell of changes
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x0000, p 0, p 0)'
!macroend
