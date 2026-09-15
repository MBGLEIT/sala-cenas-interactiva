@echo off
setlocal
cd /d "%~dp0"
title Sala Cenas - Detener y Limpiar Worker

echo.
echo ==========================================
echo   SALA CENAS - DETENER Y LIMPIAR WORKER
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
  pause
  exit /b 1
)

set "LOCAL_TSX=%CD%\node_modules\.bin\tsx.cmd"
set "USE_LOCAL_TSX=0"
if exist "%LOCAL_TSX%" set "USE_LOCAL_TSX=1"

if "%USE_LOCAL_TSX%"=="0" (
  where npx.cmd >nul 2>nul
  if errorlevel 1 (
    echo ERROR: No hay dependencias locales y npx no esta disponible.
    echo Usa una carpeta portable completa o instala Node.js LTS.
    pause
    exit /b 1
  )
)

echo Cerrando workers activos si los hubiera...
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\detener-plan-import-workers.ps1"

echo.
echo Limpiando cola de importaciones activas...
if "%USE_LOCAL_TSX%"=="1" (
  call "%LOCAL_TSX%" scripts/plan-import-worker-maintenance.ts --clean-active
) else (
  call npx.cmd tsx scripts/plan-import-worker-maintenance.ts --clean-active
)
if errorlevel 1 (
  echo ERROR: No se pudo limpiar la cola.
  pause
  exit /b 1
)

echo.
echo OK: workers detenidos y cola limpia.
pause
