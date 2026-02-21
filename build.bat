@echo off
cd /d C:\FusionTube
echo === Building FusionTube ===
call npm run package:win
echo === Exit code: %errorlevel% ===
