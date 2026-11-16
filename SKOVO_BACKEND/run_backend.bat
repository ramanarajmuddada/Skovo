@echo off
REM ── Start the SKOVO backend using the project's virtualenv ──────────────────
REM Double-click this file, or run  run_backend.bat  from a terminal.
REM It always uses venv\Scripts\python.exe, so you never hit
REM "No module named 'flask_limiter'" from launching with the wrong Python.

cd /d "%~dp0"

if not exist "venv\Scripts\python.exe" (
  echo ERROR: venv not found at %~dp0venv
  echo Create it first:  python -m venv venv  ^&^&  venv\Scripts\python -m pip install -r requirements.txt
  pause
  exit /b 1
)

echo Starting SKOVO backend with the venv Python...
"%~dp0venv\Scripts\python.exe" app.py

pause
