@echo off
cd %USERPROFILE%

echo [+] Switching to home directory: %USERPROFILE%

if not exist package.json (
    echo [+] Creating package.json...
    npm init -y
)

echo [+] Installing dependencies...
npm install discord.js-selfbot-v13 ws uuid debug

echo [+] Installation completed!
pause
