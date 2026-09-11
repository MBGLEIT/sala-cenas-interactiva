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

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js no esta instalado o no esta en PATH.
  echo Instala Node.js LTS en este equipo y vuelve a ejecutar este archivo.
  pause
  exit /b 1
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm no esta disponible.
  echo Reinstala Node.js LTS marcando la opcion de npm.
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
echo Arrancando worker continuo...
echo Puedes cerrar esta ventana para detenerlo.
echo Log: plan-import-worker.log
echo.

call npm.cmd run worker:plan-import

echo.
echo Worker detenido.
pause
