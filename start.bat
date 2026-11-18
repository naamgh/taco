@echo off
REM Starts the local server (if it isn't already up) and opens the plan.
REM Web Bluetooth only works over localhost or https, which is why this can't
REM just be a double-click on the .html file.

cd /d "%~dp0"

powershell -NoProfile -Command "try{ (New-Object Net.Sockets.TcpClient('localhost',8777)).Close(); exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
  echo Starting local server on port 8777...
  start "ftp-plan server" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" -Root "%~dp0." -Port 8777
  timeout /t 2 /nobreak >nul
) else (
  echo Server already running on port 8777.
)

set "URL=http://localhost:8777/ftp-plan.html"
set "BROWSER="

REM Chrome and Edge both support Web Bluetooth. Firefox and Safari do not, so
REM prefer a known-good browser over whatever the default happens to be.
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "BROWSER=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

if defined BROWSER (
  start "" "%BROWSER%" "%URL%"
) else (
  echo.
  echo Could not find Chrome or Edge. Opening your default browser instead.
  echo If the trainer Connect buttons do not work, open %URL% in Chrome or Edge.
  echo.
  start "" "%URL%"
  timeout /t 4 /nobreak >nul
)

exit
