# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec — Mesaj Botu.

Derleme:
    pyinstaller packaging/MesajBotu.spec

Günlük mesaj, kullanıcının kendi WhatsApp uygulaması/varsayılan tarayıcısı üzerinden gönderilir.
Otomatik Yanıt özelliği Playwright kullanır ama Chromium pakete GÖMÜLMEZ; ilk kullanımda indirilir.
"""

from pathlib import Path

from PyInstaller.utils.hooks import collect_all

PROJECT_DIR = Path(SPECPATH).resolve().parent  # packaging/ -> proje kökü

# Otomatik Yanıt özelliği için Playwright (sürücü) ve Anthropic SDK paketlenir.
# NOT: Chromium tarayıcısı GÖMÜLMEZ; ilk kullanımda uygulama 'playwright install chromium'
# çalıştırarak %LOCALAPPDATA%\ms-playwright'a indirir (installer küçük kalır).
pw_datas, pw_binaries, pw_hidden = collect_all("playwright")
an_datas, an_binaries, an_hidden = collect_all("anthropic")

datas = pw_datas + an_datas + [
    (str(PROJECT_DIR / "assets"), "assets"),
]

a = Analysis(
    [str(PROJECT_DIR / "app.py")],
    pathex=[str(PROJECT_DIR)],
    binaries=pw_binaries + an_binaries,
    datas=datas,
    hiddenimports=pw_hidden + an_hidden + [
        "customtkinter",
        "apscheduler.schedulers.background",
        "apscheduler.triggers.cron",
        "PIL._tkinter_finder",
        "pyautogui",
    ],
    hookspath=[],
    runtime_hooks=[],
    excludes=["selenium", "pywhatkit", "sounddevice", "numpy"],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="MesajBotu",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,  # --noconsole: GUI uygulaması
    icon=str(PROJECT_DIR / "assets" / "icon.ico"),
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="MesajBotu",
)
