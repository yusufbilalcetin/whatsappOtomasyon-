@echo off
REM WhatsApp motorunu surekli calistirir; cokerse 5 sn sonra yeniden baslatir.
REM Bu dosya server/deploy/win/ altinda; server/ iki ust dizinde.
cd /d "%~dp0..\.."
title WhatsApp Motor

REM node'u tam yolla bul (Startup/wscript ortaminda PATH bos olabilir -> 9009 hatasi)
set "NODE_EXE=node"
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"

:loop
echo [%date% %time%] Motor baslatiliyor... >> motor.run.log
"%NODE_EXE%" src/index.js >> motor.run.log 2>&1
echo [%date% %time%] Motor durdu (cikis kodu %errorlevel%). 5 sn sonra yeniden baslatilacak... >> motor.run.log
REM timeout gizli pencerede stdin yonlendirilince calismaz; ping ile bekle (~5 sn)
ping -n 6 127.0.0.1 >nul
goto loop
