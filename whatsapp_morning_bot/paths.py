from __future__ import annotations

import os
import sys
from pathlib import Path

APP_NAME = "MesajBotu"


def is_frozen() -> bool:
    """PyInstaller ile paketlenmiş exe içinde mi çalışıyoruz?"""
    return bool(getattr(sys, "frozen", False))


def executable_path() -> Path:
    """Paketlenmişse exe yolu, değilse 'python.exe' yolu."""
    return Path(sys.executable).resolve()


def resource_dir() -> Path:
    """Paketle birlikte gelen salt-okunur kaynakların (assets) kök dizini.

    PyInstaller donmuş çalışmada dosyaları `sys._MEIPASS` altına açar.
    """
    base = getattr(sys, "_MEIPASS", None)
    if base:
        return Path(base)
    return Path(__file__).resolve().parent


def asset_path(*parts: str) -> Path:
    return resource_dir().joinpath("assets", *parts)


def user_data_dir() -> Path:
    """Yazılabilir kullanıcı veri klasörü.

    Uygulama Program Files altına kurulduğunda kendi klasörüne yazamaz; bu yüzden
    veritabanı, log ve WhatsApp oturum profili kullanıcının roaming AppData'sına yazılır.
    """
    base = os.getenv("MESAJBOTU_DATA_DIR")
    if base:
        path = Path(base).expanduser()
    else:
        appdata = os.getenv("APPDATA")
        if appdata:
            path = Path(appdata) / APP_NAME
        else:
            path = Path.home() / f".{APP_NAME.lower()}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def db_path() -> Path:
    return user_data_dir() / "app.db"


def log_path() -> Path:
    return user_data_dir() / "app.log"
