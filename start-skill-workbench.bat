@echo off
REM === Skill Workbench Launcher ===
REM Double-click to start the Skill Workbench server and open the browser.
REM Closing the minimized "Skill Workbench Server" window stops the server.

cd /d "E:\Projects\workbenches\skill-workbench"

echo Starting Skill Workbench...
echo Server window is minimized on the taskbar. Close it to stop the service.

REM Launch node in a new minimized window so the server keeps running after this bat exits.
start "Skill Workbench Server" /min node server.cjs

REM Give the server a moment to bind to port 8788.
timeout /t 2 >nul

REM Open the workbench in the default browser.
start "" http://localhost:8788

exit
