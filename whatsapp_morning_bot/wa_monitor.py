"""WhatsApp Web izleme motoru (Playwright) — Otomatik Yanıt için.

Sürekli açık, kontrol edilen bir WhatsApp Web oturumunda okunmamış mesajları izler; uygun olanlara
Claude ile taslak yanıt üretir ve moda göre gönderir (tam otomatik) veya onay kuyruğuna ekler.

UYARI: Otomatik okuma/yanıt WhatsApp Hizmet Şartları'na aykırıdır ve numara yasaklanabilir.

Playwright sync nesneleri thread-affine olduğundan TÜM Playwright çağrıları tek bir izleyici
thread'inde yapılır. Onay modunda UI yalnızca DB üzerinden haberleşir (satırı 'approved' yapar);
döngü 'approved' satırları bu thread'de gönderir.
"""

from __future__ import annotations

import hashlib
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Callable

import ai_reply
import database
import paths
from app_logging import get_logger

logger = get_logger(__name__)

WHATSAPP_URL = "https://web.whatsapp.com"

# WhatsApp Web seçicileri tek yerde (kırılganlık izole — arayüz değişirse burası güncellenir).
SEL_CHAT_LIST = "#pane-side"
SEL_UNREAD_CHATS = "#pane-side span[aria-label*='okunmadı'], #pane-side span[aria-label*='unread']"
SEL_COMPOSE = "footer div[contenteditable='true']"
SEL_INCOMING_BUBBLES = "div.message-in"


# --------------------------------------------------------------------------- #
# Saf uygunluk mantığı (test edilebilir)
# --------------------------------------------------------------------------- #
@dataclass(slots=True)
class EligibilityInput:
    scope: str  # 'selected' | 'all'
    whitelist: set[str]
    reply_to_groups: bool
    is_group: bool
    from_me: bool
    chat_key: str  # whitelist eşleşmesi için telefon/anahtar
    sent_last_hour: int
    max_per_hour: int
    seconds_since_last_send: float
    min_delay_seconds: int


def is_eligible(data: EligibilityInput) -> tuple[bool, str]:
    """Bir gelen mesaja otomatik yanıt verilmeli mi? (uygun_mu, neden)."""
    if data.from_me:
        return False, "Kendi mesajı"
    if data.is_group and not data.reply_to_groups:
        return False, "Grup sohbeti (kapalı)"
    if data.scope == "selected" and data.chat_key not in data.whitelist:
        return False, "Whitelist dışı"
    if data.max_per_hour > 0 and data.sent_last_hour >= data.max_per_hour:
        return False, "Saatlik gönderim sınırı doldu"
    if data.seconds_since_last_send < data.min_delay_seconds:
        return False, "Gönderimler arası minimum süre dolmadı"
    return True, "Uygun"


def message_signature(chat_key: str, text: str) -> str:
    raw = f"{chat_key}|{text}".encode("utf-8", errors="ignore")
    return hashlib.sha256(raw).hexdigest()[:16]


# --------------------------------------------------------------------------- #
# İzleyici denetleyicisi
# --------------------------------------------------------------------------- #
@dataclass(slots=True)
class MonitorState:
    running: bool = False
    last_status: str = "Durduruldu"
    last_reply_at: datetime | None = None
    started_at: datetime | None = None
    last_send_time: datetime | None = field(default=None)


class MonitorController:
    """Arka plan izleyici thread'ini yönetir."""

    def __init__(self, on_status: Callable[[str], None] | None = None) -> None:
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._on_status = on_status
        self.state = MonitorState()

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self) -> None:
        if self.running:
            return
        self._stop.clear()
        self.state = MonitorState(running=True, started_at=datetime.now(), last_status="Başlatılıyor...")
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        thread = self._thread
        if thread and thread.is_alive():
            thread.join(timeout=10)
        self._thread = None
        self.state.running = False
        self.state.last_status = "Durduruldu"
        self._emit("Otomatik yanıt durduruldu.")

    def _emit(self, message: str) -> None:
        self.state.last_status = message
        if self._on_status:
            self._on_status(message)

    # --- izleme döngüsü (izleyici thread'i) ---
    def _run(self) -> None:
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            self._emit("Playwright yüklü değil. 'Yanıt motorunu kur' butonunu kullanın.")
            self.state.running = False
            return

        try:
            with sync_playwright() as p:
                context = p.chromium.launch_persistent_context(
                    user_data_dir=str(paths.user_data_dir() / "wa_monitor_profile"),
                    headless=False,
                    no_viewport=True,
                    args=["--start-maximized", "--disable-blink-features=AutomationControlled"],
                )
                try:
                    page = context.pages[0] if context.pages else context.new_page()
                    page.goto(WHATSAPP_URL, wait_until="domcontentloaded")
                    if not self._wait_login(page):
                        self._emit("WhatsApp Web girişi tamamlanmadı (QR okutun).")
                        return
                    self._emit("Otomatik yanıt aktif. Yeni mesajlar izleniyor.")
                    self._loop(page)
                finally:
                    context.close()
        except Exception as exc:
            logger.warning("İzleyici hatası: %s", exc)
            self._emit(f"İzleyici durdu: {exc}")
        finally:
            self.state.running = False

    def _wait_login(self, page) -> bool:
        deadline = time.time() + 180
        while time.time() < deadline and not self._stop.is_set():
            try:
                if page.query_selector(SEL_CHAT_LIST):
                    return True
            except Exception:
                pass
            self._stop.wait(2)
        return False

    def _loop(self, page) -> None:
        config = database.get_auto_reply_config()
        poll = max(3, int(config.get("poll_seconds", 8)))
        while not self._stop.is_set():
            try:
                self._process_approved_queue(page)
                self._scan_unread(page)
            except Exception as exc:
                logger.debug("Tarama hatası: %s", exc)
            self._stop.wait(poll)

    def _scan_unread(self, page) -> None:
        config = database.get_auto_reply_config()
        try:
            unread = page.query_selector_all(SEL_UNREAD_CHATS)
        except Exception:
            unread = []
        for badge in unread:
            if self._stop.is_set():
                return
            try:
                chat = badge.evaluate_handle(
                    "el => el.closest('[role=\"listitem\"]') || el.closest('div[tabindex]')"
                )
                chat_element = chat.as_element()
                if not chat_element:
                    continue
                chat_element.click()
                page.wait_for_timeout(1200)
                self._handle_open_chat(page, config)
            except Exception as exc:
                logger.debug("Sohbet açılamadı: %s", exc)

    def _read_chat(self, page) -> tuple[str, list[dict], str]:
        """Açık sohbetten başlık, son mesajlar ve son gelen mesajı okur."""
        title = ""
        try:
            header = page.query_selector("header span[dir='auto']")
            if header:
                title = (header.inner_text() or "").strip()
        except Exception:
            pass

        context_messages: list[dict] = []
        last_incoming = ""
        try:
            rows = page.query_selector_all("div.message-in, div.message-out")
            for row in rows[-ai_reply.MAX_CONTEXT_MESSAGES:]:
                cls = (row.get_attribute("class") or "")
                from_me = "message-out" in cls
                text_el = row.query_selector("span.selectable-text, div.selectable-text")
                text = (text_el.inner_text().strip() if text_el else "")
                if not text:
                    continue
                context_messages.append({"from_me": from_me, "text": text})
                if not from_me:
                    last_incoming = text
        except Exception as exc:
            logger.debug("Mesaj okunamadı: %s", exc)
        return title, context_messages, last_incoming

    def _handle_open_chat(self, page, config: dict) -> None:
        title, context_messages, last_incoming = self._read_chat(page)
        if not last_incoming:
            return
        chat_key = title or "bilinmeyen"
        signature = message_signature(chat_key, last_incoming)
        if database.get_chat_signature(chat_key) == signature:
            return  # Bu mesaja zaten bakıldı.

        now = datetime.now()
        seconds_since = (
            (now - self.state.last_send_time).total_seconds()
            if self.state.last_send_time
            else 1e9
        )
        eligibility = EligibilityInput(
            scope=config["scope"],
            whitelist=database.whitelist_phones(),
            reply_to_groups=config["reply_to_groups"],
            is_group=False,  # WhatsApp Web grup tespiti DOM'a bağlı; varsayılan birebir.
            from_me=False,
            chat_key=chat_key,
            sent_last_hour=database.count_auto_sent_since(now - timedelta(hours=1)),
            max_per_hour=int(config["max_per_hour"]),
            seconds_since_last_send=seconds_since,
            min_delay_seconds=int(config["min_delay_seconds"]),
        )
        ok, reason = is_eligible(eligibility)
        # İmzayı her durumda kaydet ki uygun olmayan mesaj tekrar tekrar denenmesin.
        database.set_chat_signature(chat_key, signature)
        if not ok:
            logger.info("Atlandı (%s): %s", reason, chat_key)
            return

        draft = ai_reply.draft_reply(
            incoming_text=last_incoming,
            context_messages=context_messages,
            persona=config["persona_text"],
            style_samples=[s["text"] for s in database.list_style_samples()],
            model=config["model"],
            api_key=config["api_key"],
        )
        if not draft.success:
            self._emit(f"Taslak üretilemedi: {draft.error_message}")
            return

        if config["send_mode"] == "auto":
            reply_id = database.add_pending_reply(
                chat_key=chat_key,
                contact_name=title,
                incoming_text=last_incoming,
                draft_text=draft.text,
                status="approved",
            )
            self._send_reply(page, reply_id, draft.text)
        else:
            database.add_pending_reply(
                chat_key=chat_key,
                contact_name=title,
                incoming_text=last_incoming,
                draft_text=draft.text,
                status="pending",
            )
            self._emit(f"Yeni taslak hazır: {title}")

    def _process_approved_queue(self, page) -> None:
        for row in database.claim_approved_replies():
            if self._stop.is_set():
                return
            try:
                self._open_chat_by_name(page, row["chat_key"])
                self._send_reply(page, row["id"], row["draft_text"])
            except Exception as exc:
                database.set_pending_reply_status(row["id"], "error", error_message=str(exc))

    def _open_chat_by_name(self, page, name: str) -> None:
        # Açık sohbet zaten doğruysa atla.
        try:
            header = page.query_selector("header span[dir='auto']")
            if header and (header.inner_text() or "").strip() == name:
                return
        except Exception:
            pass
        search = page.query_selector("div[contenteditable='true'][data-tab='3']")
        if search:
            search.click()
            page.keyboard.type(name)
            page.wait_for_timeout(1200)
            page.keyboard.press("Enter")
            page.wait_for_timeout(1000)

    def _send_reply(self, page, reply_id: int, text: str) -> None:
        compose = page.query_selector(SEL_COMPOSE)
        if not compose:
            database.set_pending_reply_status(reply_id, "error", error_message="Mesaj kutusu yok")
            return
        compose.click()
        page.keyboard.type(text)
        page.wait_for_timeout(300)
        page.keyboard.press("Enter")
        page.wait_for_timeout(600)
        now = datetime.now()
        self.state.last_send_time = now
        self.state.last_reply_at = now
        database.set_pending_reply_status(reply_id, "sent")
        self._emit("Otomatik yanıt gönderildi.")
