from __future__ import annotations

import os
import platform
import subprocess
import sys
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Callable
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from apscheduler.schedulers.background import BackgroundScheduler
from dotenv import load_dotenv

import database
import paths
from app_logging import get_logger
from wa_engine import send_whatsapp_message, validate_phone, validate_time


load_dotenv(Path(__file__).resolve().parent / ".env")

logger = get_logger(__name__)

APP_DIR = Path(__file__).resolve().parent
APP_PATH = APP_DIR / "app.py"
TASK_NAME = os.getenv("WINDOWS_TASK_NAME", "WhatsAppMorningBot")

# Aynı işlem içinde manuel gönderim ile zamanlanmış gönderimin çakışmasını engeller.
_SEND_LOCK = threading.Lock()


def _scheduler_timezone() -> ZoneInfo:
    name = os.getenv("WHATSAPP_TIMEZONE", "Europe/Istanbul").strip() or "Europe/Istanbul"
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError:
        logger.warning("Geçersiz saat dilimi '%s', Europe/Istanbul kullanılıyor.", name)
        return ZoneInfo("Europe/Istanbul")


@dataclass(slots=True)
class RunResult:
    success: bool
    status: str
    user_message: str
    error_message: str | None = None


@dataclass(slots=True)
class WindowsTaskResult:
    success: bool
    message: str
    detail: str | None = None


def perform_test_send(contact_name: str, phone: str, message: str) -> RunResult:
    try:
        normalized_phone = validate_phone(phone)
    except ValueError as exc:
        return RunResult(False, "Test Hata", "Telefon numarası geçersiz.", str(exc))

    result = send_whatsapp_message(normalized_phone, message)
    status = "Test Başarılı" if result.success else "Test Hata"
    database.add_log(
        contact_name=contact_name,
        phone=normalized_phone,
        message=message,
        status=status,
        error_message=result.error_message,
    )
    return RunResult(result.success, status, result.message, result.error_message)


def perform_scheduled_send() -> RunResult:
    # Kilit, manuel ve zamanlanmış gönderimin aynı anda çalışmasını ve dedup yarışını engeller.
    with _SEND_LOCK:
        return _perform_scheduled_send_locked()


def _perform_scheduled_send_locked() -> RunResult:
    settings = database.get_settings()
    if not settings["automation_enabled"]:
        return RunResult(False, "Pasif", "Otomasyon pasif olduğu için mesaj gönderilmedi.")

    contact = database.get_selected_contact()
    if not contact:
        return RunResult(
            False,
            "Otomatik Hata",
            "Seçili kişi bulunamadı.",
            "Lütfen önce bir kişi ekleyip varsayılan kişi olarak seçin.",
        )

    try:
        normalized_phone = validate_phone(contact["phone"])
    except ValueError as exc:
        database.add_log(
            contact_name=contact["name"],
            phone=contact["phone"],
            message="",
            status="Otomatik Hata",
            error_message=str(exc),
        )
        return RunResult(False, "Otomatik Hata", "Telefon numarası geçersiz.", str(exc))

    if database.automatic_success_exists_today(normalized_phone):
        message = "Bugün bu kişiye otomatik mesaj zaten gönderildi."
        database.add_log(
            contact_name=contact["name"],
            phone=normalized_phone,
            message="",
            status="Atlandı",
            error_message=message,
        )
        return RunResult(True, "Atlandı", message)

    message_row = database.choose_message_for_send(settings["random_enabled"])
    if not message_row:
        error = "Aktif mesaj bulunamadı."
        database.add_log(
            contact_name=contact["name"],
            phone=normalized_phone,
            message="",
            status="Otomatik Hata",
            error_message=error,
        )
        return RunResult(False, "Otomatik Hata", error, error)

    message_text = message_row["text"]
    result = send_whatsapp_message(normalized_phone, message_text)
    status = "Otomatik Başarılı" if result.success else "Otomatik Hata"
    database.add_log(
        contact_name=contact["name"],
        phone=normalized_phone,
        message=message_text,
        status=status,
        error_message=result.error_message,
    )
    return RunResult(result.success, status, result.message, result.error_message)


class AutomationScheduler:
    def __init__(
        self,
        on_status: Callable[[RunResult], None] | None = None,
    ) -> None:
        self._scheduler = BackgroundScheduler(timezone=_scheduler_timezone())
        self._on_status = on_status

    @property
    def running(self) -> bool:
        return self._scheduler.running

    def start_daily(self, send_time: str) -> None:
        valid_time = validate_time(send_time)
        hour, minute = map(int, valid_time.split(":"))
        self._scheduler.remove_all_jobs()
        self._scheduler.add_job(
            self._run_job,
            trigger="cron",
            hour=hour,
            minute=minute,
            id="daily_whatsapp_message",
            replace_existing=True,
        )
        if not self._scheduler.running:
            self._scheduler.start()

    def stop(self) -> None:
        self._scheduler.remove_all_jobs()
        if self._scheduler.running:
            self._scheduler.shutdown(wait=False)
            self._scheduler = BackgroundScheduler(timezone=_scheduler_timezone())

    def _run_job(self) -> None:
        result = perform_scheduled_send()
        if self._on_status:
            self._on_status(result)


def _run_schtasks(args: list[str]) -> WindowsTaskResult:
    creation_flags = 0
    if platform.system() == "Windows":
        creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    completed = subprocess.run(
        args,
        capture_output=True,
        text=True,
        creationflags=creation_flags,
        check=False,
    )
    output = (completed.stdout or completed.stderr or "").strip()
    return WindowsTaskResult(completed.returncode == 0, output or "İşlem tamamlandı.", output)


def create_windows_task(send_time: str) -> WindowsTaskResult:
    if platform.system() != "Windows":
        return WindowsTaskResult(False, "Bu özellik yalnızca Windows üzerinde çalışır.")

    try:
        valid_time = validate_time(send_time)
    except ValueError as exc:
        return WindowsTaskResult(False, "Saat formatı geçersiz.", str(exc))

    if paths.is_frozen():
        # Paketlenmiş exe: doğrudan exe'yi --send-now ile çağır.
        command = f'"{paths.executable_path()}" --send-now'
    else:
        python_exe = Path(sys.executable).resolve()
        command = f'"{python_exe}" "{APP_PATH}" --send-now'
    args = [
        "schtasks",
        "/Create",
        "/TN",
        TASK_NAME,
        "/TR",
        command,
        "/SC",
        "DAILY",
        "/ST",
        valid_time,
        "/F",
    ]
    return _run_schtasks(args)


def delete_windows_task() -> WindowsTaskResult:
    if platform.system() != "Windows":
        return WindowsTaskResult(False, "Bu özellik yalnızca Windows üzerinde çalışır.")

    args = ["schtasks", "/Delete", "/TN", TASK_NAME, "/F"]
    return _run_schtasks(args)
