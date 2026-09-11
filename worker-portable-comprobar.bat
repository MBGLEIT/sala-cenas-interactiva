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

echo.
echo Ejecutando comprobacion en seco...
echo.

call npm.cmd run worker:plan-import:check

echo.
if errorlevel 1 (
  echo ERROR: La comprobacion del worker ha fallado.
) else (
  echo OK: El worker esta listo para ejecutarse.
)
pause
