@echo off
REM ============================================================================
REM YouTube Downloader Launcher
REM Double-click this file to start the app.
REM The server will run at http://127.0.0.1:8000
REM ============================================================================

REM Switch to the folder where this .bat file lives, no matter where it was
REM launched from (e.g. desktop shortcut).
cd /d "%~dp0"

REM --- Check virtual environment exists ---
if not exist "venv\Scripts\activate.bat" (
    echo [ERROR] Virtual environment not found.
    echo.
    echo  Please run SETUP.BAT first to install dependencies.
    echo.
    pause
    exit /b 1
)

REM --- Activate the venv ---
call "venv\Scripts\activate.bat"

REM --- Open browser after a short delay so the server boots first ---
REM The 'start' command is used in a separate thread so the browser opens
REM while the server continues running in this window.
(
    timeout /t 2 /nobreak >nul
    start "http://127.0.0.1:8000" "http://127.0.0.1:8000"
)

echo Starting YouTube Downloader...
echo Server will be available at: http://127.0.0.1:8000
echo.
echo Closing this window will STOP the server.
echo ============================================================================

REM --- Start the server (no --reload for normal use) ---
uvicorn main:app --host 127.0.0.1 --port 8000

REM Keep the window open after the server exits so the user can read any error.
pause
