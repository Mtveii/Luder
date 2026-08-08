; Удаление автозапуска, остатков данных и всех вариантов папок установки.
; В упакованном package.json name = "luder", поэтому userData = %APPDATA%\luder,
; папка установки NSIS использует productName "Luder" в %LOCALAPPDATA%\Programs.
!macro customUnInstall
  ; --- Завершить работающий процесс ---
  nsExec::Exec 'taskkill /F /IM "${APP_EXECUTABLE_FILENAME}"'

  ; --- Автозапуск: Run-ключ (все варианты имени) ---
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Luder"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "luder"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Luder.exe"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "luder.exe"

  ; --- Ярлыки ---
  Delete "$SMSTARTUP\Luder.lnk"
  Delete "$SMSTARTUP\luder.lnk"
  Delete "$SMSTARTUP\LudrClone.lnk"
  Delete "$DESKTOP\Luder.lnk"
  Delete "$DESKTOP\LudrClone.lnk"
  Delete "$SMPROGRAMS\Luder\*.*"
  RMDir "$SMPROGRAMS\Luder"
  Delete "$SMPROGRAMS\luder\*.*"
  RMDir "$SMPROGRAMS\luder"

  ; --- Данные приложения (userData = %APPDATA%\luder) ---
  RMDir /r "$APPDATA\luder"
  RMDir /r "$APPDATA\Luder"
  RMDir /r "$APPDATA\LudrClone"
  RMDir /r "$APPDATA\ludr-clone"

  ; --- Локальные данные и кэш (%LOCALAPPDATA%) ---
  RMDir /r "$LOCALAPPDATA\luder"
  RMDir /r "$LOCALAPPDATA\Luder"
  RMDir /r "$LOCALAPPDATA\LudrClone"
  RMDir /r "$LOCALAPPDATA\ludr-clone"

  ; --- Папки установки (все старые варианты имён) ---
  RMDir /r "$LOCALAPPDATA\Programs\Luder"
  RMDir /r "$LOCALAPPDATA\Programs\luder"
  RMDir /r "$LOCALAPPDATA\Programs\LudrClone"
  RMDir /r "$LOCALAPPDATA\Programs\ludr-clone"

  ; --- Временные файлы обновлений ---
  Delete "$TEMP\luder-update.exe"
  Delete "$TEMP\Luder-update.exe"

  ; --- Реестровые ключи приложения (если записывались) ---
  DeleteRegKey HKCU "Software\Luder"
  DeleteRegKey HKCU "Software\luder"
  DeleteRegKey HKCU "Software\LudrClone"
  DeleteRegKey HKCU "Software\ludr-clone"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Luder"
!macroend