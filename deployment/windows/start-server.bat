@echo off
title Guard Report Server
echo ========================================
echo  Guard Report Server Launcher
echo ========================================
echo.
echo Starting Guard Report Server...
echo.

REM Check if server is already running
tasklist | find /i "guard-report-server.exe" > nul
if not errorlevel 1 (
    echo ⚠️  Server is already running!
    echo.
    echo Use Task Manager to stop it first:
    echo 1. Press Ctrl+Shift+Esc
    echo 2. Find "guard-report-server.exe"
    echo 3. Click "End Task"
    echo.
    pause
    exit /b 1
)

REM Start the server
echo ✅ Starting server on port 5000...
echo 🌐 Access via: http://localhost:5000
echo 🌍 Network: http://%COMPUTERNAME%:5000
echo.
echo 💡 Browser should open automatically
echo.
echo Press Ctrl+C to stop the server
echo.

start guard-report-server.exe

if errorlevel 1 (
    echo.
    echo ❌ Server failed to start!
    echo.
    echo Check:
    echo 1. Port 5000 is not in use
    echo 2. .env configuration is correct
    echo 3. All required files are present
    echo.
    pause
)

pause
