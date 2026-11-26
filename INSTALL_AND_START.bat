@echo off
title Standalone School Calling System - Installer
color 0A

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Requesting Administrator privileges...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

echo ============================================================
echo   Standalone School Calling Booth System - Installer
echo ============================================================
echo.

where node >nul 2>&1
if %errorLevel% neq 0 (
    echo [!] Node.js not found. Installing Node.js LTS...
    winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
    set "PATH=%PATH%;C:\Program Files\nodejs"
)
for /f "delims=" %%i in ('where node') do set "NODE_EXE=%%i"
echo [OK] Node.js: %NODE_EXE%

set "TARGET_DIR=C:\School_Calling_Server"
if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"
robocopy "%~dp0server" "%TARGET_DIR%" /E /NFL /NDL /NJH /NJS /nc /ns /np

if not exist "%TARGET_DIR%\.env" (
    copy "%TARGET_DIR%\.env.example" "%TARGET_DIR%\.env" >nul
    echo.
    echo [IMPORTANT] A new .env file was created at C:\School_Calling_Server\.env
    echo Please edit it with the new school's DATABASE_URL, CLOUDINARY, and Gateway IP!
    notepad "%TARGET_DIR%\.env"
)

cd /d "%TARGET_DIR%"
if not exist "%TARGET_DIR%\node_modules\@breezystack\lamejs" (
    echo Installing Node.js dependencies...
    call npm install --omit=dev
)

netsh advfirewall firewall delete rule name="SchoolCalling SIP 5060 UDP" >nul 2>&1
netsh advfirewall firewall delete rule name="SchoolCalling API 3000 TCP" >nul 2>&1
netsh advfirewall firewall add rule name="SchoolCalling SIP 5060 UDP" dir=in action=allow protocol=UDP localport=5060 >nul
netsh advfirewall firewall add rule name="SchoolCalling API 3000 TCP" dir=in action=allow protocol=TCP localport=3000 >nul
netsh advfirewall firewall add rule name="SchoolCalling Node RTP" dir=in action=allow program="%NODE_EXE%" >nul

schtasks /end /tn "SchoolCallingServer" >nul 2>&1
schtasks /delete /tn "SchoolCallingServer" /f >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '/c cd /d C:\School_Calling_Server && \"%NODE_EXE%\" server.js >> C:\School_Calling_Server\server.log 2>&1'; " ^
  "$trigger = New-ScheduledTaskTrigger -AtStartup; " ^
  "$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest; " ^
  "$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero); " ^
  "Register-ScheduledTask -TaskName 'SchoolCallingServer' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null"

schtasks /run /tn "SchoolCallingServer" >nul
timeout /t 4 /nobreak >nul
echo.
echo ============================================================
echo   SUCCESS! Open http://localhost:3000 in browser to manage!
echo ============================================================
pause
