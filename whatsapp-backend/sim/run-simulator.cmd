@echo off
rem Double-click to start the local WhatsApp simulator in its own window.
rem It runs until this window is closed (or Ctrl+C). Then open http://localhost:8765/sim
rem Nothing is sent to Meta or Paystack. Needs Git for Windows and Node.js.
title Kanaan WhatsApp Simulator - close this window to stop it
set "BASH=%ProgramFiles%\Git\bin\bash.exe"
if not exist "%BASH%" set "BASH=%ProgramFiles(x86)%\Git\bin\bash.exe"
if not exist "%BASH%" set "BASH=%LOCALAPPDATA%\Programs\Git\bin\bash.exe"
if not exist "%BASH%" (
  echo Git for Windows was not found. Install it, or run: sh whatsapp-backend/sim/run.sh
  pause
  exit /b 1
)
"%BASH%" "%~dp0run.sh"
pause
