@echo off
REM ============================================================================
REM YouTube Downloader First-Time Setup
REM Run this once after installing Python and ffmpeg.
REM ============================================================================

REM Switch to the folder where this .bat file lives.
cd /d "%~dp0"

REM --- Check Python is available ---
python --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Python was not found on your system.
    echo.
    echo  Please install Python 3.11 or newer from:
    echo  https://www.python.org/downloads/
    echo.
    echo  Make sure to check "Add Python to PATH" during installation.
    echo.
    pause
    exit /b 1
)

echo Creating Python virtual environment...
python -m venv venv
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to create virtual environment.
    pause
    exit /b 1
)

REM --- Activate the venv ---
call "venv\Scripts\activate.bat"

echo.
echo Upgrading pip...
python -m pip install --upgrade pip

echo.
echo Installing dependencies from requirements.txt...
pip install -r requirements.txt
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to install dependencies.
    pause
    exit /b 1
)

echo.
echo Installing / updating yt-dlp to the latest version...
pip install -U yt-dlp

echo.
echo ============================================================================
echo  Setup complete! You can now start the app by double-clicking RUN.BAT.
echo ============================================================================
echo.
pause
