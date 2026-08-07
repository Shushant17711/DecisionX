@echo off
setlocal
echo ==========================================
echo Starting DecisionX Dev Servers
echo ==========================================

echo [1/4] Stopping existing processes on ports 3000 (Frontend) and 8001 (Backend)...
for /f "tokens=5" %%a in ('netstat -a -n -o ^| findstr :3000') do (
    taskkill /F /PID %%a 2>NUL
)
for /f "tokens=5" %%a in ('netstat -a -n -o ^| findstr :8001') do (
    taskkill /F /PID %%a 2>NUL
)
echo Old processes cleaned up.

echo [2/4] Checking dependencies...
if not exist ".venv" (
    echo Creating .venv...
    python -m venv .venv
    call .venv\Scripts\activate.bat
    pip install -q -r backend\requirements.txt
    deactivate
)

if not exist "frontend\node_modules" (
    echo Installing frontend dependencies...
    cd frontend
    call npm install
    cd ..
)

echo [3/4] Starting Backend (Port 8001)...
cd backend
start "DecisionX Backend" cmd /k "call ..\.venv\Scripts\activate.bat & uvicorn main:app --host 0.0.0.0 --port 8001 --reload"

echo [4/4] Starting Frontend (Port 3000)...
cd ..\frontend
start "DecisionX Frontend" cmd /k "npm run dev"

cd ..
echo ==========================================
echo Both servers are starting in new windows!
echo Frontend: http://localhost:3000
echo Backend:  http://localhost:8001
echo ==========================================
