@echo off
setlocal
where python >nul 2>nul
if not errorlevel 1 (
  python "%~dp0start.py" %*
  goto finished
)
where py >nul 2>nul
if not errorlevel 1 (
  py "%~dp0start.py" %*
  goto finished
)
where python2.7 >nul 2>nul
if not errorlevel 1 (
  python2.7 "%~dp0start.py" %*
  goto finished
)
echo Please install Python 3.7 or newer from python.org and enable Add Python to PATH.
exit /b 1
:finished
set "compress_result=%errorlevel%"
if "%~1"=="" pause
exit /b %compress_result%
