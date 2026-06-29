@echo off
REM WhatsApp motorunu surekli calistirir; cokerse 5 sn sonra yeniden baslatir.
REM Bu dosya server/deploy/win/ altinda; server/ iki ust dizinde.
cd /d "%~dp0..\.."
title WhatsApp Motor

:loop
echo [%date% %time%] Motor baslatiliyor...
node src/index.js
echo [%date% %time%] Motor durdu (cikis kodu %errorlevel%). 5 sn sonra yeniden baslatilacak...
timeout /t 5 /nobreak >nul
goto loop
