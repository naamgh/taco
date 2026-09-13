@echo off
REM Opens the hosted Indoor Training Console in Chrome/Edge with the switches
REM that allow one-click reconnect to remembered Bluetooth devices. Without
REM them the app still works, but every connect goes through the picker.
REM
REM Edit the URL below once, after GitHub Pages has published your site.

set "URL=https://YOUR-USERNAME.github.io/YOUR-REPO/"

echo %URL% | find "YOUR-USERNAME" >nul
if not errorlevel 1 (
  echo.
  echo Edit start-online.bat first: replace YOUR-USERNAME and YOUR-REPO with your
  echo GitHub Pages address, e.g. https://ant.github.io/indoor-training/
  echo.
  pause
  exit /b 1
)

set "BROWSER="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "BROWSER=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

REM Own profile folder so the switches apply even if the browser is already open.
set "PROFILE=%LocalAppData%\IndoorTrainingConsole\browser-profile"
set "FLAGS=--enable-experimental-web-platform-features --enable-features=WebBluetoothNewPermissionsBackend --no-first-run --no-default-browser-check"

if defined BROWSER (
  start "" "%BROWSER%" --user-data-dir="%PROFILE%" %FLAGS% "%URL%"
) else (
  echo Could not find Chrome or Edge. Opening your default browser instead.
  echo Web Bluetooth needs Chrome or Edge; the app will browse but not connect elsewhere.
  start "" "%URL%"
  timeout /t 4 /nobreak >nul
)
exit
