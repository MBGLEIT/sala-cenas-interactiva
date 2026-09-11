@echo off
setlocal
cd /d "%~dp0"
title Sala Cenas - Limpiar y Reiniciar Worker

echo.
echo ==========================================
echo   SALA CENAS - LIMPIAR Y REINICIAR
echo ==========================================
echo.

if not exist "package.json" (
  echo ERROR: Este archivo debe ejecutarse desde la carpeta del proyecto.
  echo Carpeta actual: %CD%
  pause
  exit /b 1
)

if not exist ".env.local" (
  echo ERROR: Falta .env.local junto al worker.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js no esta instalado o no esta en PATH.
  pause
  exit /b 1
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm no esta disponible.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Instalando dependencias del proyecto...
  call npm.cmd install
  if errorlevel 1 (
    echo ERROR: No se pudieron instalar las dependencias.
    pause
    exit /b 1
  )
)

echo Cerrando workers anteriores si los hubiera...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'node.exe' -or $_.Name -eq 'cmd.exe') -and $_.CommandLine -like '*plan-import-worker.ts*' } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop; Write-Host ('Worker cerrado PID ' + $_.ProcessId) } catch { Write-Host ('No se pudo cerrar PID ' + $_.ProcessId + ': ' + $_.Exception.Message) } }"

echo.
echo Limpiando cola de importaciones activas...
call npx.cmd tsx scripts/plan-import-worker-maintenance.ts --clean-active
if errorlevel 1 (
  echo ERROR: No se pudo limpiar la cola.
  pause
  exit /b 1
)

echo.
echo Reiniciando worker continuo...
echo Puedes cerrar esta ventana para detenerlo.
echo Log: plan-import-worker.log
echo.

call npm.cmd run worker:plan-import

echo.
echo Worker detenido.
pause
