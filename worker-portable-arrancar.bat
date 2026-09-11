@echo off
setlocal
cd /d "%~dp0"
title Sala Cenas - Worker Importador

echo.
echo ==========================================
echo   SALA CENAS - WORKER IMPORTADOR
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
  set "CAN_RUN_LOCAL=1"
)

echo.
echo Arrancando worker continuo...
echo Puedes cerrar esta ventana para detenerlo.
echo Log: plan-import-worker.log
echo.

call "%LOCAL_TSX%" scripts/plan-import-worker.ts

echo.
echo Worker detenido.
pause
