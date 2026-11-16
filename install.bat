@echo off
setlocal enabledelayedexpansion

echo ============================================================
echo    LinkResurrector - Native Messaging Helper Installer
echo ============================================================
echo.

set "EXT_ID=%~1"

if "%EXT_ID%"=="" (
    echo Please enter the 32-character Extension ID from chrome://extensions
    echo (Example: aolankfjaoognfcebfneidgjkmkbkaef)
    echo.
    set /p "EXT_ID=Extension ID: "
)

if "%EXT_ID%"=="" (
    echo [Error] No extension ID provided. Exiting.
    pause
    exit /b 1
)

echo.
echo Installing native helper for extension ID: %EXT_ID%
echo.

node "%~dp0server\install.mjs" %EXT_ID%

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [Error] Installation failed. Ensure Node.js 18+ is installed.
) else (
    echo.
    echo ============================================================
    echo [✓] Done! Completely restart Chrome/Brave now.
    echo ============================================================
)

echo.
pause
