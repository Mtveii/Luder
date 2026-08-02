; Remove autostart Run key and any leftover shortcuts on uninstall.
!macro customUnInstall
  nsExec::Exec 'taskkill /F /IM "${APP_EXECUTABLE_FILENAME}"'
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Luder"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "luder"
  Delete "$SMSTARTUP\Luder.lnk"
  Delete "$SMSTARTUP\luder.lnk"
  RMDir /r "$APPDATA\Luder"
  RMDir /r "$LOCALAPPDATA\Luder"
  RMDir /r "$LOCALAPPDATA\Programs\LudrClone"
  RMDir /r "$LOCALAPPDATA\Programs\ludr-clone"
  RMDir /r "$LOCALAPPDATA\Programs\luder"
  Delete "$DESKTOP\Luder.lnk"
  Delete "$DESKTOP\LudrClone.lnk"
  DeleteRegKey HKCU "Software\Luder"
  DeleteRegKey HKCU "Software\ludr-clone"
!macroend
