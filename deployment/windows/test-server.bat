@echo off
title Guard Report Server - Diagnostics
echo ========================================
echo  Guard Report Server Diagnostics
echo ========================================
echo.

echo [1/4] Checking if server is running...
tasklist | find /i "guard-report-server.exe" > nul
if not errorlevel 1 (
    echo ✅ Server process is running
) else (
    echo ❌ Server is NOT running
    echo    Run start-server.bat first
)
echo.

echo [2/4] Checking port 5000...
netstat -ano | find ":5000 " > nul
if not errorlevel 1 (
    echo ✅ Port 5000 is in use (server likely listening)
) else (
    echo ⚠️  Port 5000 is not in use
)
echo.

echo [3/4] Testing API endpoint...
curl -s -o nul -w "HTTP Status: %%{http_code}" http://localhost:5000/api/health
echo.
if %ERRORLEVEL% == 0 (
    echo ✅ Server is responding
) else (
    echo ❌ Server is not responding
)
echo.

echo [4/4] Your computer info...
echo Computer Name: %COMPUTERNAME%
echo.
echo Your IP addresses:
ipconfig | findstr /i "IPv4"
echo.

echo ========================================
echo  Diagnostic complete!
echo ========================================
echo.
echo If all checks passed:
echo   ✅ Open: http://localhost:5000
echo.
echo If checks failed:
echo   1. Make sure server is running
echo   2. Check .env configuration
echo   3. Look at README.txt for help
echo.

pause
