@echo off
title BM Security Guard Report System
color 0A
cls

echo ========================================================
echo   BM SECURITY GUARD REPORT SYSTEM
echo ========================================================
echo.
echo [*] Starting server...
echo [*] Web Interface: http://localhost:5000
echo [*] API Endpoint: http://localhost:5000/api
echo [*] Health Check: http://localhost:5000/api/health
echo.
echo [*] Press Ctrl+C to stop server
echo.

REM Check if logo exists
if exist "assets\BM SECURITY LOGO.jpg" (
  echo [*] Logo found: assets\BM SECURITY LOGO.jpg
) else (
  echo [*] Logo NOT found in assets folder
)

REM Start the server
guard-report-server.exe

REM Handle errors
if errorlevel 1 (
    echo.
    echo ========================================
    echo   SERVER STOPPED OR CRASHED
    echo ========================================
    echo.
    echo Common issues:
    echo   1. Port 5000 already in use
    echo   2. Database connection failed
    echo   3. BM Security API credentials invalid
    echo.
    echo Check error messages above for details.
    echo.
    pause
)
