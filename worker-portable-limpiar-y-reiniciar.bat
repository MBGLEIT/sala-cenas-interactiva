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

set "LOCAL_TSX=%CD%\node_modules\.bin\tsx.cmd"
set "CAN_RUN_LOCAL=0"
if exist "%LOCAL_TSX%" set "CAN_RUN_LOCAL=1"

if "%CAN_RUN_LOCAL%"=="0" (
  where npm.cmd >nul 2>nul
  if errorlevel 1 (
    echo ERROR: No hay dependencias locales y npm no esta disponible.
    echo Usa una carpeta portable completa o instala Node.js LTS.
    pause
    exit /b 1
  )
  echo Instalando dependencias del proyecto...
  call npm.cmd install
  if errorlevel 1 (
    echo ERROR: No se pudieron instalar las dependencias.
    pause
    exit /b 1
  )
  set "CAN_RUN_LOCAL=1"
)

echo Cerrando workers anteriores si los hubiera...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $workers = Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { ($_.Name -eq 'node.exe' -or $_.Name -eq 'cmd.exe') -and $_.CommandLine -like '*plan-import-worker.ts*' }; foreach ($worker in $workers) { try { Stop-Process -Id $worker.ProcessId -Force -ErrorAction Stop; Write-Host ('Worker cerrado PID ' + $worker.ProcessId) } catch { Write-Host ('Aviso: no se pudo cerrar PID ' + $worker.ProcessId + ': ' + $_.Exception.Message) } }; if (-not $workers) { Write-Host 'No se encontraron workers anteriores.' } } catch { Write-Host ('Aviso: Windows no permitio revisar procesos antiguos: ' + $_.Exception.Message); Write-Host 'Continuo limpiando la cola y arrancando un worker nuevo.' }"

echo.
echo Limpiando cola de importaciones activas...
call "%LOCAL_TSX%" scripts/plan-import-worker-maintenance.ts --clean-active
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

call "%LOCAL_TSX%" scripts/plan-import-worker.ts

echo.
echo Worker detenido.
pause
