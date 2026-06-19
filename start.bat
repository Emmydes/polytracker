@echo off
cd /d "%~dp0"
echo Building frontend...
call npm run build --prefix frontend
if errorlevel 1 exit /b 1
echo.
echo Starting PolyTracker at http://localhost:3001
echo Press Ctrl+C to stop.
call npm start --prefix backend
