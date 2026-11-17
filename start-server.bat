@echo off
REM Startet einen lokalen Webserver, damit das Smartphone (im selben WLAN) die App aufrufen kann.
cd /d "%~dp0"
echo.
echo  Meine Abfahrten - lokaler Server
echo  --------------------------------
echo  Am Smartphone (gleiches WLAN) im Browser oeffnen:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  for /f "tokens=* delims= " %%b in ("%%a") do echo     http://%%b:8080
)
echo.
echo  Am PC: http://localhost:8080
echo  Beenden mit Strg+C
echo.
py -m http.server 8080 --bind 0.0.0.0
