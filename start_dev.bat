@echo off
setlocal EnableDelayedExpansion
echo ==========================================
echo Starting DecisionX Dev Servers
echo ==========================================

if not defined DECISIONX_HOST set "DECISIONX_HOST=127.0.0.1"

echo [1/4] Checking ports 3000 (Frontend) and 8001 (Backend)...
rem Match only LISTENING sockets whose LOCAL address ends in the port; the old
rem "findstr :3000" also hit connections to remote port 3000 and killed them.
rem Busy ports are reported, never force-killed: we did not start those processes.
set "BUSY="
for %%p in (3000 8001) do (
    for /f "tokens=2,5" %%a in ('netstat -a -n -o -p TCP ^| findstr /R /C:"LISTENING"') do (
        echo %%a| findstr /R /C:":%%p$" >NUL && (
            echo Port %%p is already in use by PID %%b. Stop it first.
            set "BUSY=1"
        )
    )
    for /f "tokens=2,5" %%a in ('netstat -a -n -o -p TCPv6 ^| findstr /R /C:"LISTENING"') do (
        echo %%a| findstr /R /C:":%%p$" >NUL && (
            echo Port %%p is already in use by PID %%b. Stop it first.
            set "BUSY=1"
        )
    )
)
if defined BUSY (
    echo Aborting.
    exit /b 1
)

echo [2/4] Checking dependencies...
if not exist ".venv" (
    echo Creating .venv...
    python -m venv .venv
)
rem Reinstall whenever requirements.txt changes, not only on first run.
set "REQ_HASH="
for /f "delims=" %%h in ('certutil -hashfile backend\requirements.txt SHA256 ^| findstr /v ":"') do (
    if not defined REQ_HASH set "REQ_HASH=%%h"
)
set "OLD_HASH="
if exist ".venv\.requirements.sha256" set /p OLD_HASH=<.venv\.requirements.sha256
if not "!REQ_HASH!"=="!OLD_HASH!" (
    echo Installing backend requirements...
    .venv\Scripts\python -m pip install -q -r backend\requirements.txt && (
        >.venv\.requirements.sha256 echo !REQ_HASH!
    )
)

if not exist "frontend\node_modules" (
    echo Installing frontend dependencies...
    cd frontend
    call npm install
    cd ..
)

echo [3/4] Starting Backend (Port 8001)...
cd backend
start "DecisionX Backend" cmd /k "..\.venv\Scripts\python -m uvicorn main:app --host %DECISIONX_HOST% --port 8001 --reload"

echo [4/4] Starting Frontend (Port 3000)...
cd ..\frontend
start "DecisionX Frontend" cmd /k "npm run dev"

cd ..
echo ==========================================
echo Both servers are starting in new windows!
echo Frontend: http://localhost:3000
echo Backend:  http://%DECISIONX_HOST%:8001
echo ==========================================
