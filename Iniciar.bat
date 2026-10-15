@echo off
title Transferencia de archivos
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Necesitas Node.js 20 o superior: https://nodejs.org
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Instalando dependencias por primera vez...
  call npm.cmd install
  if errorlevel 1 goto error
)

call npm.cmd start
if errorlevel 1 goto error
exit /b 0

:error
echo.
echo   Algo fallo. Revisa el mensaje de arriba.
pause
exit /b 1
