@echo off
rem Double-click to start Mission: Return to Station on Windows.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org and try again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo First start: installing packages. This needs internet once.
  call npm install --omit=dev
  if errorlevel 1 (
    echo Install failed. Check the internet connection and try again.
    pause
    exit /b 1
  )
)
node server\index.js
pause
