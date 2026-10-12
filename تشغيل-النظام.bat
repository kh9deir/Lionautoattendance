@echo off
cd /d "%~dp0"
where node >nul 2>nul
if not errorlevel 1 goto use_node
where py >nul 2>nul
if not errorlevel 1 goto use_py
where python >nul 2>nul
if not errorlevel 1 goto use_python
echo This app needs Node.js or Python to run its local web page.
echo Install one of them, then double-click this file again.
pause
exit /b 1
:use_node
start "Lion Auto local server" /D "%~dp0" cmd /k node server.cjs
goto open_browser
:use_py
start "Lion Auto local server" /D "%~dp0" cmd /k py -m http.server 8000 --bind 127.0.0.1
goto open_browser
:use_python
start "Lion Auto local server" /D "%~dp0" cmd /k python -m http.server 8000 --bind 127.0.0.1
:open_browser
timeout /t 2 >nul
start "" http://127.0.0.1:8000/