from __future__ import annotations

import subprocess
import sys
import threading

import customtkinter as ctk

import database
import paths
from app_logging import get_logger

logger = get_logger(__name__)

# Palet (main_window ile uyumlu)
PANEL = "#FFFFFF"
PANEL_SOFT = "#F7F9FC"
CONTROL = "#FFFFFF"
CONTROL_HOVER = "#F1F6FF"
LINE_SOFT = "#E9EEF6"
TEXT = "#111827"
MUTED = "#667085"
BLUE = "#0A84FF"
BLUE_HOVER = "#006FE6"
GREEN = "#30D158"
DANGER = "#D92D20"
DANGER_SOFT = "#FDECEC"
WARN_BG = "#FFF6E5"
WARN_LINE = "#F0C36D"
WARN_TEXT = "#8A5A00"

MODELS = ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"]


class AutoReplyPage(ctk.CTkFrame):
    def __init__(self, parent: ctk.CTkBaseClass, controller) -> None:
        super().__init__(parent, fg_color="transparent")
        self.controller = controller
        self._poll_job = None

        self.scope_var = ctk.StringVar(value="selected")
        self.send_mode_var = ctk.StringVar(value="approve")
        self.api_key_var = ctk.StringVar()
        self.model_var = ctk.StringVar(value=MODELS[0])
        self.wl_name_var = ctk.StringVar()
        self.wl_phone_var = ctk.StringVar()

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(0, weight=1)

        self.scroll = ctk.CTkScrollableFrame(self, fg_color="transparent")
        self.scroll.grid(row=0, column=0, sticky="nsew")
        self.scroll.grid_columnconfigure(0, weight=1)

        self._build_warning()
        self._build_status()
        self._build_mode()
        self._build_ai()
        self._build_whitelist()
        self._build_queue()

        self._load_config()
        self._schedule_poll()

    # --- bölümler ---
    def _card(self, title: str) -> ctk.CTkFrame:
        card = ctk.CTkFrame(self.scroll, fg_color=PANEL, corner_radius=16, border_width=1, border_color=LINE_SOFT)
        card.grid(sticky="ew", padx=4, pady=(0, 10))
        card.grid_columnconfigure(0, weight=1)
        if title:
            ctk.CTkLabel(card, text=title, font=ctk.CTkFont(size=15, weight="bold"), text_color=TEXT, anchor="w").grid(
                row=0, column=0, sticky="w", padx=14, pady=(12, 4)
            )
        return card

    def _build_warning(self) -> None:
        card = ctk.CTkFrame(self.scroll, fg_color=WARN_BG, corner_radius=14, border_width=1, border_color=WARN_LINE)
        card.grid(sticky="ew", padx=4, pady=(2, 10))
        card.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(
            card,
            text=(
                "⚠️ Otomatik okuma/yanıt WhatsApp Hizmet Şartları'na aykırıdır ve numaranız "
                "yasaklanabilir. Tercihen ikincil bir numarayla kullanın. Sorumluluk size aittir."
            ),
            font=ctk.CTkFont(size=12),
            text_color=WARN_TEXT,
            wraplength=820,
            justify="left",
            anchor="w",
        ).grid(row=0, column=0, sticky="ew", padx=14, pady=10)

    def _build_status(self) -> None:
        card = self._card("Durum")
        row = ctk.CTkFrame(card, fg_color="transparent")
        row.grid(row=1, column=0, sticky="ew", padx=14, pady=(0, 12))
        row.grid_columnconfigure(2, weight=1)
        self.status_dot = ctk.CTkLabel(row, text="●", font=ctk.CTkFont(size=16), text_color=MUTED)
        self.status_dot.grid(row=0, column=0, padx=(0, 6))
        self.status_text = ctk.CTkLabel(row, text="Durduruldu", font=ctk.CTkFont(size=13), text_color=TEXT, anchor="w")
        self.status_text.grid(row=0, column=1, sticky="w")

        btns = ctk.CTkFrame(card, fg_color="transparent")
        btns.grid(row=2, column=0, sticky="ew", padx=14, pady=(0, 12))
        self.start_btn = ctk.CTkButton(btns, text="Başlat", width=110, height=34, fg_color=BLUE, hover_color=BLUE_HOVER, command=self.start_monitor)
        self.start_btn.grid(row=0, column=0, padx=(0, 8))
        self.stop_btn = ctk.CTkButton(btns, text="Durdur", width=110, height=34, fg_color=CONTROL, hover_color=CONTROL_HOVER, text_color=TEXT, border_width=1, border_color=LINE_SOFT, command=self.stop_monitor)
        self.stop_btn.grid(row=0, column=1, padx=(0, 8))
        self.install_btn = ctk.CTkButton(btns, text="Yanıt motorunu kur", width=170, height=34, fg_color=CONTROL, hover_color=CONTROL_HOVER, text_color=TEXT, border_width=1, border_color=LINE_SOFT, command=self.install_engine)
        self.install_btn.grid(row=0, column=2, sticky="e")

    def _build_mode(self) -> None:
        card = self._card("Mod")
        scope = ctk.CTkFrame(card, fg_color="transparent")
        scope.grid(row=1, column=0, sticky="ew", padx=14, pady=(0, 4))
        ctk.CTkLabel(scope, text="Kapsam:", font=ctk.CTkFont(size=12, weight="bold"), text_color=MUTED).grid(row=0, column=0, padx=(0, 10))
        ctk.CTkRadioButton(scope, text="Seçili kişiler", variable=self.scope_var, value="selected", command=self._toggle_whitelist).grid(row=0, column=1, padx=(0, 14))
        ctk.CTkRadioButton(scope, text="Tüm gelen mesajlar", variable=self.scope_var, value="all", command=self._toggle_whitelist).grid(row=0, column=2)

        send = ctk.CTkFrame(card, fg_color="transparent")
        send.grid(row=2, column=0, sticky="ew", padx=14, pady=(4, 12))
        ctk.CTkLabel(send, text="Gönderim:", font=ctk.CTkFont(size=12, weight="bold"), text_color=MUTED).grid(row=0, column=0, padx=(0, 10))
        ctk.CTkRadioButton(send, text="Önce öner / onayla", variable=self.send_mode_var, value="approve").grid(row=0, column=1, padx=(0, 14))
        ctk.CTkRadioButton(send, text="Tam otomatik gönder", variable=self.send_mode_var, value="auto").grid(row=0, column=2)

    def _build_ai(self) -> None:
        card = self._card("Yapay Zeka (Claude)")
        key_row = ctk.CTkFrame(card, fg_color="transparent")
        key_row.grid(row=1, column=0, sticky="ew", padx=14, pady=(0, 6))
        key_row.grid_columnconfigure(1, weight=1)
        ctk.CTkLabel(key_row, text="API anahtarı:", font=ctk.CTkFont(size=12), text_color=MUTED, width=90, anchor="w").grid(row=0, column=0)
        ctk.CTkEntry(key_row, textvariable=self.api_key_var, show="•", height=32, fg_color=CONTROL, border_color=LINE_SOFT, text_color=TEXT).grid(row=0, column=1, sticky="ew", padx=(8, 8))
        ctk.CTkOptionMenu(key_row, values=MODELS, variable=self.model_var, width=170, height=32, fg_color=CONTROL, button_color=CONTROL, button_hover_color=CONTROL_HOVER, text_color=TEXT).grid(row=0, column=2)

        ctk.CTkLabel(card, text="Üslubun / talimatın:", font=ctk.CTkFont(size=12), text_color=MUTED, anchor="w").grid(row=2, column=0, sticky="w", padx=14, pady=(4, 2))
        self.persona_box = ctk.CTkTextbox(card, height=52, fg_color=CONTROL, border_width=1, border_color=LINE_SOFT, text_color=TEXT, wrap="word")
        self.persona_box.grid(row=3, column=0, sticky="ew", padx=14, pady=(0, 6))

        ctk.CTkLabel(card, text="Örnek mesajların (her satıra bir mesaj):", font=ctk.CTkFont(size=12), text_color=MUTED, anchor="w").grid(row=4, column=0, sticky="w", padx=14, pady=(4, 2))
        self.style_box = ctk.CTkTextbox(card, height=80, fg_color=CONTROL, border_width=1, border_color=LINE_SOFT, text_color=TEXT, wrap="word")
        self.style_box.grid(row=5, column=0, sticky="ew", padx=14, pady=(0, 6))

        ctk.CTkButton(card, text="Ayarları Kaydet", width=140, height=32, fg_color=BLUE, hover_color=BLUE_HOVER, command=self.save_config).grid(row=6, column=0, sticky="e", padx=14, pady=(0, 12))

    def _build_whitelist(self) -> None:
        self.wl_card = self._card("İzin verilen kişiler (Seçili kişiler modu)")
        add = ctk.CTkFrame(self.wl_card, fg_color="transparent")
        add.grid(row=1, column=0, sticky="ew", padx=14, pady=(0, 6))
        add.grid_columnconfigure((0, 1), weight=1)
        ctk.CTkEntry(add, textvariable=self.wl_name_var, placeholder_text="Ad", height=32, fg_color=CONTROL, border_color=LINE_SOFT, text_color=TEXT).grid(row=0, column=0, sticky="ew", padx=(0, 6))
        ctk.CTkEntry(add, textvariable=self.wl_phone_var, placeholder_text="+905xxxxxxxxx veya sohbet adı", height=32, fg_color=CONTROL, border_color=LINE_SOFT, text_color=TEXT).grid(row=0, column=1, sticky="ew", padx=(0, 6))
        ctk.CTkButton(add, text="Ekle", width=70, height=32, fg_color=BLUE, hover_color=BLUE_HOVER, command=self.add_whitelist).grid(row=0, column=2)

        self.wl_list = ctk.CTkFrame(self.wl_card, fg_color="transparent")
        self.wl_list.grid(row=2, column=0, sticky="ew", padx=14, pady=(0, 12))
        self.wl_list.grid_columnconfigure(0, weight=1)

    def _build_queue(self) -> None:
        self.queue_card = self._card("Onay kuyruğu")
        self.queue_list = ctk.CTkFrame(self.queue_card, fg_color="transparent")
        self.queue_list.grid(row=1, column=0, sticky="ew", padx=14, pady=(0, 12))
        self.queue_list.grid_columnconfigure(0, weight=1)

    # --- veri ---
    def _load_config(self) -> None:
        config = database.get_auto_reply_config()
        self.scope_var.set(config["scope"])
        self.send_mode_var.set(config["send_mode"])
        self.api_key_var.set(config["api_key"])
        self.model_var.set(config["model"] if config["model"] in MODELS else MODELS[0])
        self.persona_box.delete("1.0", "end")
        self.persona_box.insert("1.0", config["persona_text"])
        self.style_box.delete("1.0", "end")
        self.style_box.insert("1.0", "\n".join(s["text"] for s in database.list_style_samples()))
        self._toggle_whitelist()
        self._refresh_whitelist()
        self._refresh_queue()
        self._refresh_status()

    def save_config(self) -> None:
        database.update_auto_reply_config(
            scope=self.scope_var.get(),
            send_mode=self.send_mode_var.get(),
            api_key=self.api_key_var.get().strip(),
            model=self.model_var.get(),
            persona_text=self.persona_box.get("1.0", "end").strip(),
        )
        database.replace_style_samples(self.style_box.get("1.0", "end").splitlines())
        self.controller.set_status("Otomatik yanıt ayarları kaydedildi.")
        self._refresh_whitelist()

    def _toggle_whitelist(self) -> None:
        if self.scope_var.get() == "selected":
            self.wl_card.grid()
        else:
            self.wl_card.grid_remove()

    def _refresh_whitelist(self) -> None:
        for child in self.wl_list.winfo_children():
            child.destroy()
        entries = database.list_whitelist()
        if not entries:
            ctk.CTkLabel(self.wl_list, text="Kayıtlı kişi yok.", font=ctk.CTkFont(size=12), text_color=MUTED, anchor="w").grid(row=0, column=0, sticky="w")
            return
        for i, entry in enumerate(entries):
            row = ctk.CTkFrame(self.wl_list, fg_color=PANEL_SOFT, corner_radius=10)
            row.grid(row=i, column=0, sticky="ew", pady=2)
            row.grid_columnconfigure(0, weight=1)
            label = f"{entry['name']} — {entry['phone']}" if entry["name"] else entry["phone"]
            ctk.CTkLabel(row, text=label, font=ctk.CTkFont(size=12), text_color=TEXT, anchor="w").grid(row=0, column=0, sticky="ew", padx=10, pady=6)
            ctk.CTkButton(row, text="Sil", width=44, height=26, fg_color=DANGER_SOFT, hover_color="#FAD7D3", text_color=DANGER, command=lambda e=entry: self._delete_whitelist(e["id"])).grid(row=0, column=1, padx=8)

    def add_whitelist(self) -> None:
        phone = self.wl_phone_var.get().strip()
        if not phone:
            return
        database.add_whitelist_entry(phone, self.wl_name_var.get().strip())
        self.wl_name_var.set("")
        self.wl_phone_var.set("")
        self._refresh_whitelist()

    def _delete_whitelist(self, entry_id: int) -> None:
        database.delete_whitelist_entry(entry_id)
        self._refresh_whitelist()

    def _refresh_queue(self) -> None:
        for child in self.queue_list.winfo_children():
            child.destroy()
        pending = database.list_pending_replies(statuses=("pending",), limit=30)
        if not pending:
            ctk.CTkLabel(self.queue_list, text="Bekleyen taslak yok.", font=ctk.CTkFont(size=12), text_color=MUTED, anchor="w").grid(row=0, column=0, sticky="w")
            return
        for i, reply in enumerate(pending):
            row = ctk.CTkFrame(self.queue_list, fg_color=PANEL_SOFT, corner_radius=12, border_width=1, border_color=LINE_SOFT)
            row.grid(row=i, column=0, sticky="ew", pady=3)
            row.grid_columnconfigure(0, weight=1)
            ctk.CTkLabel(row, text=f"{reply['contact_name'] or reply['chat_key']}", font=ctk.CTkFont(size=12, weight="bold"), text_color=TEXT, anchor="w").grid(row=0, column=0, sticky="ew", padx=10, pady=(8, 0))
            ctk.CTkLabel(row, text=f"Gelen: {reply['incoming_text'][:120]}", font=ctk.CTkFont(size=11), text_color=MUTED, anchor="w", wraplength=600, justify="left").grid(row=1, column=0, sticky="ew", padx=10)
            ctk.CTkLabel(row, text=f"Taslak: {reply['draft_text'][:160]}", font=ctk.CTkFont(size=12), text_color=TEXT, anchor="w", wraplength=600, justify="left").grid(row=2, column=0, sticky="ew", padx=10, pady=(0, 6))
            actions = ctk.CTkFrame(row, fg_color="transparent")
            actions.grid(row=0, column=1, rowspan=3, padx=8)
            ctk.CTkButton(actions, text="Gönder", width=70, height=28, fg_color=GREEN, hover_color="#28B84C", command=lambda r=reply: self._approve(r["id"])).grid(row=0, column=0, pady=(8, 4))
            ctk.CTkButton(actions, text="Sil", width=70, height=28, fg_color=DANGER_SOFT, hover_color="#FAD7D3", text_color=DANGER, command=lambda r=reply: self._reject(r["id"])).grid(row=1, column=0)

    def _approve(self, reply_id: int) -> None:
        if not self.controller.monitor.running:
            self.controller.set_status("Önce 'Başlat' ile otomatik yanıtı çalıştırın (gönderim motoru gerekli).")
            return
        database.set_pending_reply_status(reply_id, "approved")
        self.controller.set_status("Taslak onaylandı, gönderiliyor...")
        self._refresh_queue()

    def _reject(self, reply_id: int) -> None:
        database.set_pending_reply_status(reply_id, "rejected")
        self._refresh_queue()

    # --- izleyici ---
    def start_monitor(self) -> None:
        self.save_config()
        config = database.get_auto_reply_config()
        if not (config["api_key"].strip() or __import__("os").getenv("ANTHROPIC_API_KEY")):
            self.controller.set_status("Önce Claude API anahtarı girin.")
            return
        database.update_auto_reply_config(enabled=True)
        self.controller.monitor.start()
        self._refresh_status()

    def stop_monitor(self) -> None:
        database.update_auto_reply_config(enabled=False)
        self.controller.monitor.stop()
        self._refresh_status()

    def install_engine(self) -> None:
        self.install_btn.configure(state="disabled", text="Kuruluyor...")
        self.controller.set_status("Yanıt motoru (Chromium) indiriliyor, bekleyin...")

        def runner() -> None:
            try:
                subprocess.run(
                    [sys.executable, "-m", "playwright", "install", "chromium"],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                msg = "Yanıt motoru kuruldu. Artık 'Başlat' diyebilirsiniz."
            except Exception as exc:
                msg = f"Motor kurulamadı: {exc}"
            self.after(0, lambda: self._after_install(msg))

        threading.Thread(target=runner, daemon=True).start()

    def _after_install(self, message: str) -> None:
        self.install_btn.configure(state="normal", text="Yanıt motorunu kur")
        self.controller.set_status(message)

    def on_monitor_status(self, message: str) -> None:
        self.status_text.configure(text=message)
        self._refresh_status()
        self._refresh_queue()

    def _refresh_status(self) -> None:
        running = self.controller.monitor.running
        self.status_dot.configure(text_color=GREEN if running else MUTED)
        if not running:
            self.status_text.configure(text=self.controller.monitor.state.last_status)

    def _schedule_poll(self) -> None:
        self._refresh_queue()
        self._refresh_status()
        self._poll_job = self.after(5000, self._schedule_poll)

    def refresh(self) -> None:
        self._refresh_queue()
        self._refresh_whitelist()
        self._refresh_status()
