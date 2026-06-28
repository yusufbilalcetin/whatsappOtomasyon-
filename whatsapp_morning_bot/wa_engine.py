"""WhatsApp gönderim motoru.

Mesajı kullanıcının kendi WhatsApp'ı üzerinden gönderir:
  1. WhatsApp Desktop uygulaması kuruluysa `whatsapp://send?...` ile uygulamada açar.
  2. Kurulu değilse WhatsApp Web'i kullanıcının VARSAYILAN tarayıcısında (kendi profili, normal
     sekme — gizli/incognito değil) açar.
Sonra sohbet yüklenince klavyeyi taklit ederek (pyautogui) Enter'a basıp mesajı gönderir.

Not: Klavye ile gönderim, açılan pencerenin önde ve ekranın açık (kilitsiz) olmasını gerektirir.
Zamanlanmış gönderimlerde bilgisayar uyanık olmalıdır.
"""

from __future__ import annotations

import os
import re
import time
import webbrowser
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote

from dotenv import load_dotenv

from app_logging import get_logger


load_dotenv(Path(__file__).resolve().parent / ".env")

logger = get_logger(__name__)

WEB_BASE = "https://web.whatsapp.com/send"


@dataclass(slots=True)
class SendResult:
    success: bool
    message: str
    error_message: str | None = None


@dataclass(slots=True)
class LoginStatus:
    logged_in: bool
    message: str


# --------------------------------------------------------------------------- #
# Saf yardımcılar (test edilebilir)
# --------------------------------------------------------------------------- #
def normalize_phone(phone: str) -> str:
    value = re.sub(r"[\s\-()]", "", phone.strip())
    if value.startswith("00"):
        value = "+" + value[2:]
    elif value.startswith("0") and len(value) == 11:
        value = "+90" + value[1:]
    elif value.startswith("90") and not value.startswith("+"):
        value = "+" + value
    elif value.startswith("5") and len(value) == 10:
        value = "+90" + value
    return value


def validate_phone(phone: str) -> str:
    normalized = normalize_phone(phone)
    if not re.fullmatch(r"\+[1-9]\d{7,14}", normalized):
        raise ValueError(
            "Telefon numarası uluslararası formatta olmalıdır. "
            "Örn. +905xxxxxxxxx veya +49xxxxxxxxx."
        )
    return normalized


def validate_time(send_time: str) -> str:
    value = send_time.strip()
    if not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", value):
        raise ValueError("Saat HH:MM formatında olmalıdır. Örnek: 08:00")
    return value


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return max(0, int(value))
    except ValueError:
        return default


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "evet", "on"}


# --------------------------------------------------------------------------- #
# WhatsApp Desktop tespiti
# --------------------------------------------------------------------------- #
def whatsapp_desktop_installed() -> bool:
    """`whatsapp://` protokolü kayıtlıysa (Desktop/Store uygulaması kuruluysa) True."""
    if os.getenv("WHATSAPP_FORCE_WEB", "").strip().lower() in {"1", "true", "yes", "on"}:
        return False
    if os.name != "nt":
        return False
    try:
        import winreg
    except ImportError:
        return False
    candidates = [
        (winreg.HKEY_CLASSES_ROOT, "whatsapp"),
        (winreg.HKEY_CURRENT_USER, r"Software\Classes\whatsapp"),
    ]
    for root, sub in candidates:
        try:
            with winreg.OpenKey(root, sub):
                return True
        except OSError:
            continue
    return False


# --------------------------------------------------------------------------- #
# Açma / gönderme
# --------------------------------------------------------------------------- #
def _open_chat(normalized_phone: str, message: str) -> str:
    """Sohbeti uygun hedefte açar; 'app' veya 'web' döndürür."""
    digits = normalized_phone.lstrip("+")
    encoded = quote(message)
    if whatsapp_desktop_installed():
        uri = f"whatsapp://send?phone={digits}&text={encoded}"
        try:
            os.startfile(uri)  # type: ignore[attr-defined]  # yalnızca Windows
            logger.info("WhatsApp Desktop ile açıldı: %s", normalized_phone)
            return "app"
        except Exception as exc:
            logger.warning("WhatsApp Desktop açılamadı (%s), web'e düşülüyor.", exc)
    url = f"{WEB_BASE}?phone={digits}&text={encoded}"
    webbrowser.open(url, new=2)  # varsayılan tarayıcı, kullanıcının profili, normal sekme
    logger.info("WhatsApp Web (varsayılan tarayıcı) ile açıldı: %s", normalized_phone)
    return "web"


def open_whatsapp_web() -> LoginStatus:
    """Kullanıcının WhatsApp'ını (uygulama varsa uygulama, yoksa web) giriş için açar."""
    try:
        if whatsapp_desktop_installed():
            os.startfile("whatsapp://")  # type: ignore[attr-defined]
            return LoginStatus(True, "WhatsApp Desktop uygulaması açıldı.")
        webbrowser.open("https://web.whatsapp.com", new=2)
        return LoginStatus(
            True,
            "WhatsApp Web varsayılan tarayıcınızda açıldı. İlk kullanımda QR ile giriş yapın.",
        )
    except Exception as exc:
        logger.warning("WhatsApp açılamadı: %s", exc)
        return LoginStatus(False, f"WhatsApp açılamadı: {exc}")


def open_login() -> LoginStatus:
    return open_whatsapp_web()


def send_text(phone: str, message: str) -> SendResult:
    try:
        normalized_phone = validate_phone(phone)
    except ValueError as exc:
        return SendResult(False, "Telefon numarası geçersiz.", str(exc))

    cleaned = message.strip()
    if not cleaned:
        return SendResult(False, "Mesaj boş olamaz.", "Gönderilecek mesaj bulunamadı.")

    auto_send = _env_bool("WHATSAPP_AUTO_SEND", True)
    app_wait = _env_int("WHATSAPP_APP_SEND_WAIT", 8)
    web_wait = _env_int("WHATSAPP_WEB_SEND_WAIT", 15)
    press_count = max(1, _env_int("WHATSAPP_ENTER_PRESSES", 1))

    try:
        target = _open_chat(normalized_phone, cleaned)
    except Exception as exc:
        return SendResult(False, "WhatsApp açılamadı.", f"Detay: {exc}")

    if not auto_send:
        return SendResult(
            True,
            "Sohbet mesaj yazılı şekilde açıldı. Göndermek için Enter'a basın.",
        )

    wait_time = app_wait if target == "app" else web_wait
    time.sleep(max(2, wait_time))

    try:
        import pyautogui
    except ImportError:
        return SendResult(
            False,
            "Otomatik gönderim için pyautogui gerekli.",
            "Sohbet açıldı ama Enter'a basılamadı. 'pip install -r requirements.txt' çalıştırın.",
        )

    try:
        pyautogui.press("enter", presses=press_count, interval=0.2)
        time.sleep(1)
    except Exception as exc:
        return SendResult(
            False,
            "Mesaj gönderilemedi.",
            (
                "Sohbet açıldı ancak otomatik gönderilemedi. Açılan WhatsApp penceresi önde ve "
                f"ekran açık olmalı. Detay: {exc}"
            ),
        )

    where = "WhatsApp uygulaması" if target == "app" else "WhatsApp Web (varsayılan tarayıcı)"
    logger.info("Mesaj gönderildi (%s): %s", where, normalized_phone)
    return SendResult(True, f"Mesaj {where} üzerinden gönderildi.")


# Geriye dönük uyumluluk.
def send_whatsapp_message(phone: str, message: str) -> SendResult:
    return send_text(phone, message)
