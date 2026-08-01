# audit-install.ps1 — проверка состояния установки Luder на Windows
# Запуск (в PowerShell):  powershell -ExecutionPolicy Bypass -File audit-install.ps1
# Искать: ровно ОДНА запись Luder, пути и версии консистентны, HKCU/HKLM не смешаны.

$ErrorActionPreference = 'Continue'
$found = @()

# --- Реестр: per-user (HKCU) и per-machine (HKLM) ---
foreach ($root in 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall') {
    if (-not (Test-Path $root)) { continue }
    Get-ChildItem $root -ErrorAction SilentlyContinue | ForEach-Object {
        try {
            $p = Get-ItemProperty $_.PSPath -ErrorAction Stop
            $display = $p.DisplayName
            if ($display -match 'Luder') {
                $found += [PSCustomObject]@{
                    Hive        = $_.PSPath -replace ':[^\\]*', ''
                    DisplayName = $display
                    Version     = $p.DisplayVersion
                    InstallLoc  = $p.InstallLocation
                    Uninstall   = $p.UninstallString
                }
            }
        } catch { }
    }
}

Write-Host "=== Записи Luder в реестре: $($found.Count) ==="
if ($found.Count -eq 0) {
    Write-Host "НЕТ ЗАПИСЕЙ — ничего не установлено." -ForegroundColor Yellow
} else {
    $found | Format-Table -AutoSize | Out-String | Write-Host
    if ($found.Count -gt 1) {
        Write-Host "FAIL: НЕСКОЛЬКО записей — дублирование (старый баг)." -ForegroundColor Red
    } else {
        $e = $found[0]
        if ($e.Hive -like '*HKCU*') { $hive = 'per-user (HKCU)' } else { $hive = 'per-machine (HKLM)' }
        Write-Host "PASS: одна запись, режим: $hive, версия: $($e.Version)" -ForegroundColor Green
    }
}

# --- Пути установки (проверка остатков) ---
Write-Host "`n=== Папки установки ==="
$paths = @()
if (Test-Path "$env:LOCALAPPDATA\Programs\Luder") { $paths += "$env:LOCALAPPDATA\Programs\Luder (per-user)" }
if (Test-Path "${env:ProgramFiles}\Luder") { $paths += "${env:ProgramFiles}\Luder (per-machine)" }
if (Test-Path "${env:ProgramFiles(x86)}\Luder") { $paths += "${env:ProgramFiles(x86)}\Luder (per-machine x86)" }
if ($paths.Count -eq 0) {
    Write-Host "Папок установки нет." -ForegroundColor Yellow
} elseif ($paths.Count -gt 1) {
    Write-Host "FAIL: несколько папок установки:" -ForegroundColor Red
    $paths | ForEach-Object { Write-Host "  $_" }
} else {
    Write-Host "PASS: $($paths[0])" -ForegroundColor Green
}

# --- Ярлыки ---
Write-Host "`n=== Ярлыки (Start Menu / Desktop) ==="
$shortcuts = @()
foreach ($loc in "$env:APPDATA\Microsoft\Windows\Start Menu\Programs", "$env:USERPROFILE\Desktop", "$env:PUBLIC\Desktop") {
    Get-ChildItem $loc -Filter 'Luder*.lnk' -ErrorAction SilentlyContinue | ForEach-Object { $shortcuts += $_.FullName }
}
if ($shortcuts.Count -gt 1) {
    Write-Host "ВНИМАНИЕ: $($shortcuts.Count) ярлыков Luder (может быть нормой при двух пользователях)" -ForegroundColor Yellow
} elseif ($shortcuts.Count -eq 1) {
    Write-Host "PASS: один ярлык: $($shortcuts[0])" -ForegroundColor Green
} else {
    Write-Host "Ярлыков нет." -ForegroundColor Yellow
}

Write-Host "`n=== Готово ==="
