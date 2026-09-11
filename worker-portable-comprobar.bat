@echo off
setlocal
cd /d "%~dp0"
title Sala Cenas - Comprobar Worker

echo.
echo ==========================================
echo   SALA CENAS - COMPROBAR WORKER
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

echo.
echo Ejecutando comprobacion en seco...
echo.

call "%LOCAL_TSX%" scripts/plan-import-worker.ts --dry-run

echo.
if errorlevel 1 (
  echo ERROR: La comprobacion del worker ha fallado.
) else (
  echo OK: El worker esta listo para ejecutarse.
)
pause
