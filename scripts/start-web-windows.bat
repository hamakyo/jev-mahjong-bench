@echo off
setlocal

for %%I in ("%~dp0..") do set "PROJECT_ROOT=%%~fI"
cd /d "%PROJECT_ROOT%"

if exist ".env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env") do (
    if not "%%A"=="" set "%%A=%%B"
  )
)

if not defined WEB_HOST set "WEB_HOST=127.0.0.1"
if not defined WEB_PORT set "WEB_PORT=3001"

where pnpm >nul 2>nul
if errorlevel 1 (
  echo pnpm was not found on PATH.
  exit /b 1
)

call pnpm web -- --host "%WEB_HOST%" --port "%WEB_PORT%"
exit /b %ERRORLEVEL%
