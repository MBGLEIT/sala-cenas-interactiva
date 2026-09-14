@echo off
setlocal
cd /d "%~dp0"
title Sala Cenas - Worker Segundo Plano

echo.
echo ==========================================
echo   SALA CENAS - WORKER SEGUNDO PLANO
echo ==========================================
echo.

if not exist "package.json" (
  echo ERROR: Este archivo debe ejecutarse desde la carpeta portable del worker.
  echo Carpeta actual: %CD%
  pause
  exit /b 1
)

if not exist ".env.local" (
  echo ERROR: Falta .env.local junto al worker.
  echo Copia el .env.local con las claves de Supabase/OpenAI antes de arrancar.
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
)

echo Arrancando worker oculto en segundo plano...
echo Log: plan-import-worker.log
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "$workdir = (Get-Location).Path; $tsx = Join-Path $workdir 'node_modules\.bin\tsx.cmd'; $log = Join-Path $workdir 'plan-import-worker.log'; Add-Content -LiteralPath $log -Value ('[' + (Get-Date).ToUniversalTime().ToString('o') + '] worker segundo plano solicitado'); Start-Process -FilePath 'cmd.exe' -ArgumentList @('/d','/s','/c', ('call \"' + $tsx + '\" scripts/plan-import-worker.ts >> \"' + $log + '\" 2>&1')) -WorkingDirectory $workdir -WindowStyle Hidden"

if errorlevel 1 (
  echo ERROR: No se pudo lanzar el worker en segundo plano.
  pause
  exit /b 1
)

echo OK: Worker lanzado en segundo plano.
echo Puedes comprobar actividad en plan-import-worker.log.
pause
