from __future__ import annotations

import sqlite3
import threading
from datetime import date, datetime, timedelta
from tkinter import messagebox
from typing import Callable

import customtkinter as ctk
from PIL import Image, ImageDraw, ImageFont

import database
import paths
from scheduler import (
    AutomationScheduler,
    RunResult,
    create_windows_task,
    delete_windows_task,
    perform_test_send,
)
from ui.time_picker import WheelTimePicker
from wa_engine import open_whatsapp_web, validate_phone, validate_time


DISPLAY_FONT = "Segoe UI Variable Display"
TEXT_FONT = "Segoe UI Variable Text"

MAX_MESSAGE_LEN = 1000

APP_BG = "#EEF2F8"
WINDOW_BG = "#F8FAFD"
WINDOW_BORDER = "#CFD7E3"
PANEL = "#FFFFFF"
PANEL_SOFT = "#F7F9FC"
CONTROL = "#FFFFFF"
CONTROL_HOVER = "#F1F6FF"
LINE = "#DDE5F0"
LINE_SOFT = "#E9EEF6"
TEXT = "#111827"
TEXT_SOFT = "#344054"
MUTED = "#667085"
MUTED_2 = "#98A2B3"
BLUE = "#0A84FF"
BLUE_HOVER = "#006FE6"
BLUE_SOFT = "#E7F2FF"
BLUE_LINE = "#B9D9FF"
GREEN = "#30D158"
GREEN_SOFT = "#E6F8EC"
DANGER = "#D92D20"
DANGER_SOFT = "#FDECEC"
SHADOW = "#D9E0EA"


def _repair_text(value: str) -> str:
    """Repair common UTF-8 text that was previously read as latin-1."""
    try:
        return value.encode("latin1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return value


class MainWindow(ctk.CTk):
    def __init__(self) -> None:
        super().__init__()
        ctk.set_appearance_mode("Light")
        self.title("Mesaj Botu")
        self._apply_window_icon()
        self.geometry(self._preferred_geometry())
        self.minsize(1180, 664)
        self.configure(fg_color=APP_BG)

        self._send_lock = threading.Lock()
        self.automation_scheduler = AutomationScheduler(on_status=self._on_scheduler_status)

        from wa_monitor import MonitorController

        self.monitor = MonitorController(on_status=self._on_monitor_status)

        self.contacts: list[dict] = []
        self.filtered_contacts: list[dict] = []
        self.selected_contact: dict | None = None
        self.contact_rows: dict[int, ctk.CTkFrame] = {}
        self.avatar_images: dict[str, ctk.CTkImage] = {}

        self.name_var = ctk.StringVar()
        self.phone_var = ctk.StringVar()
        self.search_var = ctk.StringVar()
        self.time_var = ctk.StringVar(value="09:00")
        self.repeat_enabled = ctk.BooleanVar(value=True)

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(0, weight=1)

        self._build_window()
        self.refresh_contacts(select_saved=True)
        self._load_initial_message()
        self._refresh_status_card()
        self.after(300, self._start_scheduler_if_enabled)
        self.protocol("WM_DELETE_WINDOW", self._on_close)

    def _apply_window_icon(self) -> None:
        try:
            icon = paths.asset_path("icon.ico")
            if icon.exists():
                self.iconbitmap(str(icon))
        except Exception:
            pass

    def _font(self, size: int, weight: str = "normal", display: bool = False) -> ctk.CTkFont:
        return ctk.CTkFont(
            family=DISPLAY_FONT if display else TEXT_FONT,
            size=size,
            weight=weight,
        )

    def _preferred_geometry(self) -> str:
        screen_width = self.winfo_screenwidth()
        screen_height = self.winfo_screenheight()
        max_height = max(664, screen_height - 210)
        height = min(664, max_height)
        width = int(height * 16 / 9)
        if width > screen_width - 80:
            width = max(1180, screen_width - 80)
            height = int(width * 9 / 16)
        return f"{width}x{height}"

    def _build_window(self) -> None:
        shadow = ctk.CTkFrame(self, fg_color=SHADOW, corner_radius=34)
        shadow.grid(row=0, column=0, sticky="nsew", padx=(18, 14), pady=(10, 10))
        shadow.grid_columnconfigure(0, weight=1)
        shadow.grid_rowconfigure(0, weight=1)

        self.window = ctk.CTkFrame(
            shadow,
            fg_color=WINDOW_BG,
            corner_radius=30,
            border_width=1,
            border_color=WINDOW_BORDER,
        )
        self.window.grid(row=0, column=0, sticky="nsew", padx=(0, 7), pady=(0, 7))
        self.window.grid_columnconfigure(0, weight=1)
        self.window.grid_rowconfigure(1, weight=1)

        self._build_titlebar()
        self._build_content()

    def _build_titlebar(self) -> None:
        titlebar = ctk.CTkFrame(self.window, fg_color="#FBFCFE", corner_radius=30, height=50)
        titlebar.grid(row=0, column=0, sticky="ew")
        titlebar.grid_propagate(False)
        titlebar.grid_columnconfigure((0, 1, 2), weight=1)

        lights = ctk.CTkFrame(titlebar, fg_color="transparent")
        lights.grid(row=0, column=0, sticky="w", padx=20, pady=17)
        self._mac_dot(lights, "#FF5F57", "#E0443E", self._on_close).grid(row=0, column=0, padx=(0, 8))
        self._mac_dot(lights, "#FFBD2E", "#DEA123", self.iconify).grid(row=0, column=1, padx=(0, 8))
        self._mac_dot(lights, "#28C840", "#1EAF36", self._toggle_zoom).grid(row=0, column=2)

        ctk.CTkLabel(
            titlebar,
            text="Mesaj Botu",
            font=self._font(17, "bold", display=True),
            text_color=TEXT,
        ).grid(row=0, column=1, sticky="nsew")

        ctk.CTkLabel(
            titlebar,
            text="",
            width=120,
        ).grid(row=0, column=2, sticky="e", padx=22)

    def _build_content(self) -> None:
        outer = ctk.CTkFrame(self.window, fg_color="transparent")
        outer.grid(row=1, column=0, sticky="nsew", padx=12, pady=(0, 10))
        outer.grid_columnconfigure(0, weight=1)
        outer.grid_rowconfigure(1, weight=1)

        self._build_nav(outer)

        self.pages = ctk.CTkFrame(outer, fg_color="transparent")
        self.pages.grid(row=1, column=0, sticky="nsew")
        self.pages.grid_columnconfigure(0, weight=1)
        self.pages.grid_rowconfigure(0, weight=1)

        # Sayfa 1: Günlük Mesaj (mevcut 3 panelli içerik)
        self.content = ctk.CTkFrame(self.pages, fg_color="transparent")
        self.content.grid(row=0, column=0, sticky="nsew")
        self.content.grid_columnconfigure(0, weight=0, minsize=300)
        self.content.grid_columnconfigure(1, weight=1, minsize=500)
        self.content.grid_columnconfigure(2, weight=0, minsize=280)
        self.content.grid_rowconfigure(0, weight=1)

        self._build_contacts_panel()
        self._build_message_panel()
        self._build_status_panel()

        # Sayfa 2: Otomatik Yanıt
        from ui.auto_reply_page import AutoReplyPage

        self.auto_page = AutoReplyPage(self.pages, self)
        self.auto_page.grid(row=0, column=0, sticky="nsew")

        self._show_page("daily")

    def _build_nav(self, parent: ctk.CTkFrame) -> None:
        nav = ctk.CTkFrame(parent, fg_color="transparent")
        nav.grid(row=0, column=0, sticky="ew", pady=(2, 8))
        self.nav_selector = ctk.CTkSegmentedButton(
            nav,
            values=["Günlük Mesaj", "Otomatik Yanıt"],
            command=self._on_nav_change,
            height=34,
            font=self._font(13, "bold"),
            selected_color=BLUE,
            selected_hover_color=BLUE_HOVER,
            unselected_color=CONTROL,
            unselected_hover_color=CONTROL_HOVER,
            text_color="#FFFFFF",
            fg_color=PANEL_SOFT,
        )
        self.nav_selector.set("Günlük Mesaj")
        self.nav_selector.pack(anchor="w")

    def _on_nav_change(self, value: str) -> None:
        self._show_page("auto" if value == "Otomatik Yanıt" else "daily")

    def _show_page(self, page: str) -> None:
        if page == "auto":
            self.auto_page.tkraise()
            if hasattr(self.auto_page, "refresh"):
                self.auto_page.refresh()
        else:
            self.content.tkraise()

    def _build_contacts_panel(self) -> None:
        panel = self._panel(self.content)
        panel.grid(row=0, column=0, sticky="nsew", padx=(0, 10))
        panel.grid_columnconfigure(0, weight=1)
        panel.grid_rowconfigure(2, weight=1)

        search_row = ctk.CTkFrame(panel, fg_color="transparent")
        search_row.grid(row=0, column=0, sticky="ew", padx=14, pady=(14, 8))
        search_row.grid_columnconfigure(0, weight=1)

        search_box = ctk.CTkFrame(
            search_row,
            fg_color=CONTROL,
            corner_radius=16,
            border_width=1,
            border_color=LINE_SOFT,
            height=40,
        )
        search_box.grid(row=0, column=0, sticky="ew", padx=(0, 12))
        search_box.grid_propagate(False)
        search_box.grid_columnconfigure(1, weight=1)
        ctk.CTkLabel(
            search_box,
            text="⌕",
            width=38,
            font=self._font(22),
            text_color=MUTED,
        ).grid(row=0, column=0, sticky="ns", padx=(6, 0))
        self.search_entry = ctk.CTkEntry(
            search_box,
            textvariable=self.search_var,
            placeholder_text="",
            height=34,
            fg_color=CONTROL,
            border_width=0,
            text_color=TEXT,
            placeholder_text_color=MUTED_2,
            font=self._font(15),
        )
        self.search_entry.grid(row=0, column=1, sticky="ew", padx=(0, 8), pady=3)
        self.search_entry.bind("<KeyRelease>", self._on_search_change)
        self.search_hint = ctk.CTkLabel(
            search_box,
            text="Kişi ara...",
            font=self._font(15),
            text_color=MUTED_2,
            anchor="w",
        )
        self.search_hint.place(x=48, y=10)
        self.search_hint.bind("<Button-1>", lambda _event: self.search_entry.focus_set())

        self._button(search_row, "≡", self.refresh_contacts, variant="icon", width=40, height=40).grid(
            row=0,
            column=1,
        )

        header = ctk.CTkFrame(panel, fg_color="transparent")
        header.grid(row=1, column=0, sticky="ew", padx=14, pady=(0, 8))
        header.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(
            header,
            text="Kişiler",
            font=self._font(13, "bold"),
            text_color=MUTED,
            anchor="w",
        ).grid(row=0, column=0, sticky="w")
        self.contact_count_label = ctk.CTkLabel(
            header,
            text="0 kişi",
            font=self._font(12, "bold"),
            text_color=BLUE,
            fg_color=BLUE_SOFT,
            corner_radius=12,
            padx=10,
            height=26,
        )
        self.contact_count_label.grid(row=0, column=1, sticky="e")

        self.contacts_list = ctk.CTkScrollableFrame(
            panel,
            fg_color="transparent",
            scrollbar_button_color="#D9E2EF",
            scrollbar_button_hover_color="#C7D2E0",
        )
        self.contacts_list.grid(row=2, column=0, sticky="nsew", padx=10, pady=(0, 8))
        self.contacts_list.grid_columnconfigure(0, weight=1)

        self._button(
            panel,
            "＋  Yeni Kişi Ekle",
            self.new_contact,
            variant="secondary",
            height=40,
        ).grid(row=3, column=0, sticky="ew", padx=14, pady=(0, 14))

    def _build_message_panel(self) -> None:
        panel = self._panel(self.content)
        panel.grid(row=0, column=1, sticky="nsew")
        panel.grid_columnconfigure(0, weight=1)

        profile = ctk.CTkFrame(panel, fg_color="transparent", height=60)
        profile.grid(row=0, column=0, sticky="ew", padx=16, pady=(10, 6))
        profile.grid_propagate(False)
        profile.grid_columnconfigure(1, weight=1)

        self.profile_avatar = ctk.CTkLabel(profile, text="", image=self._avatar("?", "", 50))
        self.profile_avatar.grid(row=0, column=0, rowspan=2, padx=(0, 18), pady=10)

        self.profile_name = ctk.CTkLabel(
            profile,
            text="Kişi seçilmedi",
            font=self._font(20, "bold", display=True),
            text_color=TEXT,
            anchor="w",
        )
        self.profile_name.grid(row=0, column=1, sticky="w", pady=(7, 0))

        self.profile_phone = ctk.CTkLabel(
            profile,
            text="Rehberden kişi seçin veya yeni kişi ekleyin",
            font=self._font(14),
            text_color=MUTED,
            anchor="w",
        )
        self.profile_phone.grid(row=1, column=1, sticky="w", pady=(0, 7))

        self._button(
            profile,
            "Web'i Aç",
            self.open_whatsapp_from_ui,
            variant="secondary",
            width=96,
            height=34,
        ).grid(row=0, column=2, rowspan=2, sticky="e", padx=(12, 0))

        contact_card = self._inner_card(panel, height=174)
        contact_card.grid(row=1, column=0, sticky="ew", padx=16, pady=(0, 8))
        contact_card.grid_columnconfigure(0, weight=1)
        contact_card.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(
            contact_card,
            text="Kişi Seç",
            font=self._font(17, "bold", display=True),
            text_color=TEXT,
            anchor="w",
        ).grid(row=0, column=0, sticky="w", padx=14, pady=(9, 0))
        ctk.CTkLabel(
            contact_card,
            text="Kişiyi seçin ya da düzenleyin.",
            font=self._font(12),
            text_color=MUTED,
            anchor="w",
        ).grid(row=1, column=0, sticky="ew", padx=14, pady=(0, 4))

        self.contact_dropdown = ctk.CTkOptionMenu(
            contact_card,
            values=["Kişi yok"],
            command=self._select_from_dropdown,
            height=34,
            corner_radius=14,
            fg_color=CONTROL,
            button_color=CONTROL,
            button_hover_color=CONTROL_HOVER,
            text_color=TEXT,
            font=self._font(13, "bold"),
            dropdown_font=self._font(13),
            dropdown_fg_color=CONTROL,
            dropdown_hover_color=CONTROL_HOVER,
            dropdown_text_color=TEXT,
        )
        self.contact_dropdown.grid(row=2, column=0, columnspan=2, sticky="ew", padx=14, pady=(0, 6))

        self._field(contact_card, "Alıcı adı", self.name_var, 3, 0, "Örn. Ravza")
        self._field(contact_card, "Telefon", self.phone_var, 3, 1, "+905xxxxxxxxx")

        actions = ctk.CTkFrame(contact_card, fg_color="transparent")
        actions.grid(row=0, column=1, rowspan=2, sticky="ne", padx=14, pady=(10, 0))
        self._button(actions, "Yeni", self.new_contact, variant="secondary", width=48, height=28).grid(
            row=0,
            column=0,
            padx=(0, 4),
        )
        self._button(actions, "Kaydet", self.save_contact, variant="primary", width=62, height=28).grid(
            row=0,
            column=1,
            padx=4,
        )
        self._button(actions, "Varsay.", self.set_current_as_selected, variant="secondary", width=66, height=28).grid(
            row=0,
            column=2,
            padx=4,
        )
        self._button(actions, "Sil", self.delete_selected_contact, variant="danger", width=40, height=28).grid(
            row=0,
            column=3,
            padx=(4, 0),
        )

        message_card = self._inner_card(panel, height=190)
        message_card.grid(row=2, column=0, sticky="ew", padx=16, pady=(0, 8))
        message_card.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(
            message_card,
            text="Mesajı Yaz",
            font=self._font(17, "bold", display=True),
            text_color=TEXT,
            anchor="w",
        ).grid(row=0, column=0, sticky="w", padx=14, pady=(9, 0))
        ctk.CTkLabel(
            message_card,
            text="Göndermek istediğiniz mesajı buraya yazın.",
            font=self._font(12),
            text_color=MUTED,
            anchor="w",
        ).grid(row=1, column=0, sticky="ew", padx=14, pady=(0, 6))

        self.message_box = ctk.CTkTextbox(
            message_card,
            height=74,
            fg_color=CONTROL,
            border_width=1,
            border_color=LINE_SOFT,
            corner_radius=14,
            text_color=TEXT,
            font=self._font(15),
            wrap="word",
        )
        self.message_box.grid(row=2, column=0, sticky="ew", padx=14, pady=(0, 5))
        self.message_box.bind("<KeyRelease>", lambda _event: self._update_char_count())

        message_footer = ctk.CTkFrame(message_card, fg_color="transparent")
        message_footer.grid(row=3, column=0, sticky="ew", padx=14, pady=(0, 8))
        message_footer.grid_columnconfigure(0, weight=1)
        self.char_counter = ctk.CTkLabel(
            message_footer,
            text=f"0 / {MAX_MESSAGE_LEN}",
            font=self._font(12),
            text_color=MUTED,
        )
        self.char_counter.grid(row=0, column=1, sticky="e", padx=(0, 8))

        repeat_card = self._inner_card(panel, height=128)
        repeat_card.grid(row=3, column=0, sticky="ew", padx=16, pady=(0, 8))
        repeat_card.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(
            repeat_card,
            text="▣",
            width=44,
            font=self._font(22),
            text_color=BLUE,
        ).grid(row=0, column=0, rowspan=2, padx=(14, 8), pady=(14, 0))
        ctk.CTkLabel(
            repeat_card,
            text="Tekrarlama",
            font=self._font(16, "bold", display=True),
            text_color=TEXT,
            anchor="w",
        ).grid(row=0, column=1, sticky="w", pady=(14, 0))
        self.repeat_time_label = ctk.CTkLabel(
            repeat_card,
            text="Her Sabah 09:00",
            font=self._font(12),
            text_color=MUTED,
            anchor="w",
        )
        self.repeat_time_label.grid(row=1, column=1, sticky="w", pady=(0, 4))

        self.time_picker = WheelTimePicker(
            repeat_card,
            command=self._on_time_picker_change,
            initial=self.time_var.get() or "09:00",
        )
        self.time_picker.grid(row=0, column=2, rowspan=3, padx=(6, 10), pady=8)

        self.repeat_switch = ctk.CTkSwitch(
            repeat_card,
            text="",
            variable=self.repeat_enabled,
            width=54,
            progress_color=BLUE,
            button_color="#FFFFFF",
            button_hover_color="#FFFFFF",
            fg_color="#C7D2E0",
        )
        self.repeat_switch.grid(row=0, column=3, rowspan=3, padx=(0, 12))

        self._button(
            panel,
            "✈  Mesajı Gönder",
            self.send_message,
            variant="primary",
            height=46,
        ).grid(row=4, column=0, sticky="ew", padx=16, pady=(0, 14))

    def _build_status_panel(self) -> None:
        panel = self._panel(self.content)
        panel.grid(row=0, column=2, sticky="nsew", padx=(10, 0))
        panel.grid_columnconfigure(0, weight=1)
        panel.grid_rowconfigure(4, weight=1)

        top_card = ctk.CTkFrame(
            panel,
            fg_color=PANEL,
            corner_radius=24,
            border_width=1,
            border_color=LINE_SOFT,
        )
        top_card.grid(row=0, column=0, sticky="ew", padx=14, pady=(16, 10))
        top_card.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(top_card, text="", image=self._bot_badge()).grid(
            row=0,
            column=0,
            rowspan=2,
            padx=(12, 10),
            pady=12,
        )
        self.automation_title = ctk.CTkLabel(
            top_card,
            text="Otomasyon Pasif",
            font=self._font(15, "bold", display=True),
            text_color=TEXT,
            anchor="w",
        )
        self.automation_title.grid(row=0, column=1, sticky="w", pady=(14, 0))
        self.status_dot = ctk.CTkLabel(
            top_card,
            text="●",
            font=self._font(18),
            text_color=MUTED_2,
        )
        self.status_dot.grid(row=0, column=2, sticky="e", padx=(4, 10), pady=(14, 0))
        self.automation_text = ctk.CTkLabel(
            top_card,
            text="Başlatıldığında günlük zamanlayıcı burada görünür.",
            font=self._font(12),
            text_color=MUTED,
            wraplength=130,
            justify="left",
            anchor="w",
        )
        self.automation_text.grid(row=1, column=1, columnspan=2, sticky="w", pady=(2, 14), padx=(0, 10))

        self.stats_frame = ctk.CTkFrame(panel, fg_color="transparent")
        self.stats_frame.grid(row=1, column=0, sticky="ew", padx=14)
        self.stats_frame.grid_columnconfigure(0, weight=1)

        controls = ctk.CTkFrame(panel, fg_color="transparent")
        controls.grid(row=2, column=0, sticky="ew", padx=14, pady=(6, 0))
        controls.grid_columnconfigure((0, 1), weight=1)
        self._button(
            controls,
            "Otomasyonu Başlat",
            self.start_automation,
            variant="primary",
            height=36,
        ).grid(row=0, column=0, sticky="ew", padx=(0, 6))
        self._button(
            controls,
            "Durdur",
            self.stop_automation,
            variant="secondary",
            height=36,
        ).grid(row=0, column=1, sticky="ew", padx=(6, 0))

        task_controls = ctk.CTkFrame(panel, fg_color="transparent")
        task_controls.grid(row=3, column=0, sticky="ew", padx=14, pady=(6, 0))
        task_controls.grid_columnconfigure((0, 1), weight=1)
        self._button(
            task_controls,
            "Görevi Kaydet",
            self.create_windows_task_from_ui,
            variant="secondary",
            height=34,
        ).grid(row=0, column=0, sticky="ew", padx=(0, 6))
        self._button(
            task_controls,
            "Görevi Sil",
            self.delete_windows_task_from_ui,
            variant="secondary",
            height=34,
        ).grid(row=0, column=1, sticky="ew", padx=(6, 0))

        status_box = ctk.CTkFrame(
            panel,
            fg_color="#FBFCFE",
            corner_radius=18,
            border_width=1,
            border_color=LINE_SOFT,
        )
        status_box.grid(row=5, column=0, sticky="ew", padx=14, pady=(0, 14))
        status_box.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(
            status_box,
            text="Durum",
            font=self._font(12, "bold"),
            text_color=MUTED,
            anchor="w",
        ).grid(row=0, column=0, sticky="ew", padx=12, pady=(9, 0))
        self.status_label = ctk.CTkLabel(
            status_box,
            text="Hazır",
            font=self._font(12),
            text_color=TEXT_SOFT,
            anchor="w",
            justify="left",
            wraplength=220,
        )
        self.status_label.grid(row=1, column=0, sticky="ew", padx=12, pady=(2, 9))

    def _mac_dot(self, parent: ctk.CTkFrame, color: str, border: str, command: Callable) -> ctk.CTkButton:
        return ctk.CTkButton(
            parent,
            text="",
            width=15,
            height=15,
            corner_radius=8,
            fg_color=color,
            hover_color=color,
            border_width=1,
            border_color=border,
            command=command,
        )

    def _panel(self, parent: ctk.CTkFrame) -> ctk.CTkFrame:
        return ctk.CTkFrame(
            parent,
            fg_color="#FDFEFF",
            corner_radius=28,
            border_width=1,
            border_color=LINE_SOFT,
        )

    def _inner_card(self, parent: ctk.CTkFrame, *, height: int) -> ctk.CTkFrame:
        card = ctk.CTkFrame(
            parent,
            height=height,
            fg_color=PANEL,
            corner_radius=18,
            border_width=1,
            border_color=LINE_SOFT,
        )
        card.grid_propagate(False)
        return card

    def _field(
        self,
        parent: ctk.CTkFrame,
        label: str,
        variable: ctk.StringVar,
        row: int,
        column: int,
        placeholder: str,
    ) -> None:
        wrapper = ctk.CTkFrame(parent, fg_color="transparent")
        wrapper.grid(row=row, column=column, sticky="ew", padx=(14 if column == 0 else 7, 14), pady=(0, 0))
        wrapper.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(
            wrapper,
            text=label,
            font=self._font(10, "bold"),
            text_color=MUTED,
            anchor="w",
        ).grid(row=0, column=0, sticky="w", pady=(0, 2))
        ctk.CTkEntry(
            wrapper,
            textvariable=variable,
            placeholder_text=placeholder,
            height=30,
            corner_radius=14,
            fg_color=CONTROL,
            border_color=LINE_SOFT,
            text_color=TEXT,
            placeholder_text_color=MUTED_2,
            font=self._font(12),
        ).grid(row=1, column=0, sticky="ew")

    def _button(
        self,
        parent: ctk.CTkFrame,
        text: str,
        command: Callable,
        *,
        variant: str,
        width: int | None = None,
        height: int = 40,
    ) -> ctk.CTkButton:
        variants = {
            "primary": (BLUE, BLUE_HOVER, "#FFFFFF", BLUE, 0),
            "secondary": (CONTROL, CONTROL_HOVER, TEXT_SOFT, LINE_SOFT, 1),
            "danger": (DANGER_SOFT, "#FAD7D3", DANGER, "#F6B9B3", 1),
            "icon": (CONTROL, CONTROL_HOVER, TEXT_SOFT, LINE_SOFT, 1),
            "icon-small": (CONTROL, CONTROL_HOVER, TEXT_SOFT, LINE_SOFT, 1),
        }
        fg, hover, text_color, border, border_width = variants[variant]
        return ctk.CTkButton(
            parent,
            text=text,
            width=width or 120,
            height=height,
            corner_radius=max(12, height // 3),
            fg_color=fg,
            hover_color=hover,
            text_color=text_color,
            border_width=border_width,
            border_color=border,
            font=self._font(13, "bold"),
            command=command,
        )

    def _on_search_change(self, _event: object | None = None) -> None:
        self._sync_search_hint()
        self.refresh_contacts()

    def _sync_search_hint(self) -> None:
        if self.search_var.get():
            self.search_hint.place_forget()
        else:
            self.search_hint.place(x=48, y=10)

    def refresh_contacts(self, select_saved: bool = False) -> None:
        self.contacts = database.list_contacts()
        query = self.search_var.get().strip().lower()
        if query:
            self.filtered_contacts = [
                contact
                for contact in self.contacts
                if query in contact["name"].lower() or query in contact["phone"].lower()
            ]
        else:
            self.filtered_contacts = list(self.contacts)

        for child in self.contacts_list.winfo_children():
            child.destroy()
        self.contact_rows = {}

        if not self.filtered_contacts:
            self._empty_contacts()
        else:
            for row, contact in enumerate(self.filtered_contacts):
                self._contact_row(row, contact)

        self.contact_count_label.configure(text=f"{len(self.contacts)} kişi")
        dropdown_values = [self._contact_label(contact) for contact in self.contacts] or ["Kişi yok"]
        self.contact_dropdown.configure(values=dropdown_values)

        if select_saved:
            selected = database.get_selected_contact()
            if selected:
                self.select_contact(selected["id"])
            elif self.contacts:
                self.select_contact(self.contacts[0]["id"], persist=False)
            else:
                self.new_contact()
        elif self.selected_contact:
            current = database.get_contact(self.selected_contact["id"])
            if current:
                self.select_contact(current["id"], persist=False)
            elif self.contacts:
                self.select_contact(self.contacts[0]["id"], persist=False)
            else:
                self.new_contact()

        self._refresh_status_card()

    def _empty_contacts(self) -> None:
        empty = ctk.CTkFrame(
            self.contacts_list,
            fg_color=PANEL_SOFT,
            corner_radius=18,
            border_width=1,
            border_color=LINE_SOFT,
        )
        empty.grid(row=0, column=0, sticky="ew", padx=8, pady=8)
        empty.grid_columnconfigure(0, weight=1)
        text = "Kayıtlı kişi yok." if not self.contacts else "Aramaya uygun kişi bulunamadı."
        ctk.CTkLabel(
            empty,
            text=text,
            font=self._font(13),
            text_color=MUTED,
            anchor="center",
        ).grid(row=0, column=0, sticky="ew", padx=16, pady=18)

    def _contact_row(self, row: int, contact: dict) -> None:
        is_selected = bool(self.selected_contact and self.selected_contact["id"] == contact["id"])
        row_frame = ctk.CTkFrame(
            self.contacts_list,
            height=74,
            fg_color=BLUE_SOFT if is_selected else "transparent",
            corner_radius=18,
            border_width=1 if is_selected else 0,
            border_color=BLUE_LINE,
        )
        row_frame.grid(row=row, column=0, sticky="ew", padx=6, pady=4)
        row_frame.grid_propagate(False)
        row_frame.grid_columnconfigure(2, weight=1)
        self.contact_rows[contact["id"]] = row_frame

        ctk.CTkFrame(
            row_frame,
            width=4,
            height=48,
            fg_color=BLUE if is_selected else "transparent",
            corner_radius=3,
        ).grid(row=0, column=0, rowspan=2, sticky="nsw", padx=(0, 10), pady=13)
        ctk.CTkLabel(row_frame, text="", image=self._avatar(contact["name"], contact["phone"], 50)).grid(
            row=0,
            column=1,
            rowspan=2,
            padx=(0, 12),
            pady=12,
        )
        ctk.CTkLabel(
            row_frame,
            text=contact["name"],
            font=self._font(15, "bold", display=True),
            text_color=TEXT,
            anchor="w",
        ).grid(row=0, column=2, sticky="ew", pady=(14, 0))
        ctk.CTkLabel(
            row_frame,
            text=self._format_phone(contact["phone"]),
            font=self._font(12),
            text_color=MUTED,
            anchor="w",
        ).grid(row=1, column=2, sticky="ew", pady=(0, 14))
        ctk.CTkLabel(
            row_frame,
            text="Seçili" if is_selected else "",
            font=self._font(11, "bold"),
            text_color=BLUE,
        ).grid(row=0, column=3, rowspan=2, padx=(8, 12))

        for child in row_frame.winfo_children():
            child.bind("<Button-1>", lambda _event, contact_id=contact["id"]: self.select_contact(contact_id))
        row_frame.bind("<Button-1>", lambda _event, contact_id=contact["id"]: self.select_contact(contact_id))

    def _load_initial_message(self) -> None:
        messages = database.list_messages(active_only=True)
        message = _repair_text(messages[0]["text"]) if messages else "Günaydın, umarım günün güzel geçer 😊"
        self.message_box.delete("1.0", "end")
        self.message_box.insert("1.0", message)
        settings = database.get_settings()
        self.time_var.set(settings["send_time"])
        if hasattr(self, "time_picker"):
            self.time_picker.set(settings["send_time"])
        self.repeat_enabled.set(settings["automation_enabled"])
        self._update_char_count()

    def _contact_label(self, contact: dict) -> str:
        return f"{contact['name']} - {self._format_phone(contact['phone'])}"

    def _select_from_dropdown(self, value: str) -> None:
        for contact in self.contacts:
            if self._contact_label(contact) == value:
                self.select_contact(contact["id"])
                return

    def select_contact(self, contact_id: int, persist: bool = True) -> None:
        contact = database.get_contact(contact_id)
        if not contact:
            return
        self.selected_contact = contact
        self.name_var.set(contact["name"])
        self.phone_var.set(contact["phone"])
        self.profile_name.configure(text=contact["name"])
        self.profile_phone.configure(text=self._format_phone(contact["phone"]))
        self.profile_avatar.configure(image=self._avatar(contact["name"], contact["phone"], 50))
        self.contact_dropdown.set(self._contact_label(contact))
        if persist:
            database.set_selected_contact(contact["id"])
            self.set_status(f"Seçili kişi: {contact['name']}")

        for contact_id_key, row in self.contact_rows.items():
            selected = contact_id_key == contact["id"]
            row.configure(
                fg_color=BLUE_SOFT if selected else "transparent",
                border_width=1 if selected else 0,
                border_color=BLUE_LINE,
            )
        self._refresh_status_card()

    def new_contact(self) -> None:
        self.selected_contact = None
        self.name_var.set("")
        self.phone_var.set("")
        self.profile_name.configure(text="Yeni kişi")
        self.profile_phone.configure(text="+905xxxxxxxxx formatında telefon girin")
        self.profile_avatar.configure(image=self._avatar("Yeni", "", 50))
        self.contact_dropdown.set("Kişi yok" if not self.contacts else "Kişi seçin")
        self.set_status("Yeni kişi ekleme modunda.")

        for row in self.contact_rows.values():
            row.configure(fg_color="transparent", border_width=0)

    def save_contact(self) -> None:
        name = self.name_var.get().strip()
        phone = self.phone_var.get().strip()
        if not name:
            messagebox.showwarning("Eksik bilgi", "Lütfen kişi adını yazın.")
            return
        try:
            normalized_phone = validate_phone(phone)
        except ValueError as exc:
            messagebox.showwarning("Geçersiz telefon", _repair_text(str(exc)))
            return

        try:
            if self.selected_contact:
                existing = database.get_contact_by_phone(normalized_phone)
                if existing and existing["id"] != self.selected_contact["id"]:
                    messagebox.showerror("Kayıt hatası", "Bu telefon numarası başka bir kişide kayıtlı.")
                    return
                database.update_contact(self.selected_contact["id"], name, normalized_phone)
                contact_id = self.selected_contact["id"]
                status = "Kişi güncellendi."
            else:
                existing = database.get_contact_by_phone(normalized_phone)
                if existing:
                    database.update_contact(existing["id"], name, normalized_phone)
                    contact_id = existing["id"]
                    status = "Kişi güncellendi."
                else:
                    contact_id = database.add_contact(name, normalized_phone)
                    status = "Kişi eklendi."
            database.set_selected_contact(contact_id)
        except sqlite3.IntegrityError:
            messagebox.showerror("Kayıt hatası", "Bu telefon numarası zaten kayıtlı.")
            return

        self.set_status(status)
        self.refresh_contacts()
        self.select_contact(contact_id)

    def set_current_as_selected(self) -> None:
        if not self.selected_contact:
            messagebox.showwarning("Kişi seçilmedi", "Önce kişi kaydedin veya listeden seçin.")
            return
        database.set_selected_contact(self.selected_contact["id"])
        self.set_status(f"Varsayılan kişi seçildi: {self.selected_contact['name']}")
        self.refresh_contacts()

    def delete_selected_contact(self) -> None:
        if not self.selected_contact:
            messagebox.showwarning("Kişi seçilmedi", "Silmek için önce bir kişi seçin.")
            return
        name = self.selected_contact["name"]
        if not messagebox.askyesno("Kişi sil", f"{name} kişisi silinsin mi?"):
            return
        database.delete_contact(self.selected_contact["id"])
        self.selected_contact = None
        self.set_status("Kişi silindi.")
        self.refresh_contacts()

    def send_message(self) -> None:
        contact = self._require_selected_contact()
        if not contact:
            return
        message = self.message_box.get("1.0", "end").strip()
        if not message:
            messagebox.showwarning("Mesaj yok", "Lütfen gönderilecek mesajı yazın.")
            return
        if len(message) > MAX_MESSAGE_LEN:
            messagebox.showwarning(
                "Mesaj çok uzun",
                f"Mesaj en fazla {MAX_MESSAGE_LEN} karakter olabilir.",
            )
            return
        if not messagebox.askyesno(
            "Mesaj gönder",
            f"{contact['name']} kişisine test mesajı gönderilsin mi?\n\nWhatsApp Web kapalıysa otomatik açılacak.",
        ):
            return
        self._run_send_task(
            lambda: perform_test_send(contact["name"], contact["phone"], message),
            "WhatsApp Web hazırlanıyor ve mesaj gönderiliyor...",
        )

    def start_automation(self) -> None:
        contact = self._require_selected_contact()
        if not contact:
            return
        try:
            valid_time = validate_time(self.time_var.get())
        except ValueError as exc:
            messagebox.showwarning("Geçersiz saat", _repair_text(str(exc)))
            return

        message = self.message_box.get("1.0", "end").strip()
        if not message:
            messagebox.showwarning("Mesaj yok", "Otomasyon için mesaj yazın.")
            return
        if len(message) > MAX_MESSAGE_LEN:
            messagebox.showwarning(
                "Mesaj çok uzun",
                f"Mesaj en fazla {MAX_MESSAGE_LEN} karakter olabilir.",
            )
            return

        database.set_single_active_message(message)
        database.set_selected_contact(contact["id"])
        database.update_settings(
            send_time=valid_time,
            selected_contact_id=contact["id"],
            random_enabled=False,
            automation_enabled=True,
        )
        self.repeat_enabled.set(True)
        self.automation_scheduler.start_daily(valid_time)
        self.set_status(
            f"Otomasyon aktif. Saat: {valid_time}. WhatsApp oturumu kapalıysa 'Web'i Aç' ile QR okutun."
        )
        self._refresh_status_card()

    def stop_automation(self) -> None:
        database.update_settings(automation_enabled=False)
        self.repeat_enabled.set(False)
        self.automation_scheduler.stop()
        self.set_status("Otomasyon durduruldu.")
        self._refresh_status_card()

    def create_windows_task_from_ui(self) -> None:
        contact = self._require_selected_contact()
        if not contact:
            return
        try:
            valid_time = validate_time(self.time_var.get())
        except ValueError as exc:
            messagebox.showwarning("Geçersiz saat", _repair_text(str(exc)))
            return
        database.update_settings(send_time=valid_time, selected_contact_id=contact["id"], automation_enabled=True)
        result = create_windows_task(valid_time)
        if result.success:
            messagebox.showinfo("Görev oluşturuldu", _repair_text(result.message))
            self.set_status("Windows görev kaydı oluşturuldu.")
        else:
            messagebox.showerror("Görev oluşturulamadı", _repair_text(result.detail or result.message))
            self.set_status("Windows görev kaydı oluşturulamadı.")
        self._refresh_status_card()

    def delete_windows_task_from_ui(self) -> None:
        result = delete_windows_task()
        if result.success:
            messagebox.showinfo("Görev silindi", _repair_text(result.message))
            self.set_status("Windows görev kaydı silindi.")
        else:
            messagebox.showerror("Görev silinemedi", _repair_text(result.detail or result.message))
            self.set_status("Windows görev kaydı silinemedi.")

    def open_whatsapp_from_ui(self) -> None:
        # WhatsApp uygulamasını/web'i açar — arka planda çalıştır (UI donmasın).
        if not self._send_lock.acquire(blocking=False):
            messagebox.showwarning("İşlem sürüyor", "Başka bir işlem devam ediyor.")
            return
        self.set_status("WhatsApp Web açılıyor. Açılan pencerede QR kodu telefonunuzdan okutun...")

        def runner() -> None:
            try:
                status = open_whatsapp_web()
                message = status.message
            except Exception as exc:
                message = f"WhatsApp Web açılamadı: {exc}"
            finally:
                self._send_lock.release()
            self.after(0, lambda: self.set_status(message))

        threading.Thread(target=runner, daemon=True).start()

    def _require_selected_contact(self) -> dict | None:
        if self.selected_contact:
            return self.selected_contact
        messagebox.showwarning("Kişi seçilmedi", "Önce kişi ekleyin veya listeden seçin.")
        return None

    def _refresh_status_card(self) -> None:
        settings = database.get_settings()
        active = settings["automation_enabled"]
        self.automation_title.configure(
            text="Otomasyon Aktif" if active else "Otomasyon Pasif",
            text_color=GREEN if active else TEXT,
        )
        self.status_dot.configure(text_color=GREEN if active else MUTED_2)
        self.automation_text.configure(
            text=(
                f"Mesaj botunuz {settings['send_time']} saatinde planlandığı şekilde çalışıyor."
                if active
                else "Başlatıldığında günlük zamanlayıcı burada görünür."
            )
        )
        current_time = self.time_var.get() or settings["send_time"]
        self.repeat_time_label.configure(text=f"Her Sabah {current_time}")

        for child in self.stats_frame.winfo_children():
            child.destroy()

        logs = database.list_logs(limit=100)
        last_log = logs[0] if logs else None
        sent_count = len([log for log in logs if "Başarılı" in _repair_text(log["status"])])
        active_messages = len(database.list_messages(active_only=True))
        contact_count = len(database.list_contacts())
        stats = [
            ("↺", "Son Gönderim", self._format_log_time(last_log["sent_at"]) if last_log else "-", last_log["contact_name"] if last_log else ""),
            ("✈", "Gönderilen", str(sent_count), "Toplam başarılı"),
            ("▣", "Planlanan", str(active_messages), "Aktif mesaj"),
            ("♙", "Kişi Sayısı", str(contact_count), "Rehber"),
        ]
        for row, (icon, label, value, sub) in enumerate(stats):
            self._stat_row(row, icon, label, value, sub)

    def _stat_row(self, row: int, icon: str, label: str, value: str, sub: str) -> None:
        item = ctk.CTkFrame(
            self.stats_frame,
            fg_color="#FBFCFE",
            corner_radius=18,
            border_width=1,
            border_color=LINE_SOFT,
        )
        item.grid(row=row, column=0, sticky="ew", pady=(0, 6))
        item.grid_columnconfigure(1, weight=1)
        ctk.CTkLabel(
            item,
            text=icon,
            width=32,
            font=self._font(16),
            text_color=BLUE,
        ).grid(row=0, column=0, rowspan=2, padx=(10, 6), pady=8)
        ctk.CTkLabel(
            item,
            text=label,
            font=self._font(11),
            text_color=TEXT_SOFT,
            anchor="w",
        ).grid(row=0, column=1, sticky="ew", pady=(8, 0))
        ctk.CTkLabel(
            item,
            text=_repair_text(sub),
            font=self._font(10),
            text_color=MUTED,
            anchor="w",
        ).grid(row=1, column=1, sticky="ew", pady=(0, 8))
        ctk.CTkLabel(
            item,
            text=_repair_text(value),
            font=self._font(12, "bold"),
            text_color=TEXT,
        ).grid(row=0, column=2, rowspan=2, padx=10)

    def _avatar(self, name: str, phone: str, size: int) -> ctk.CTkImage:
        key = f"avatar-{name}-{phone}-{size}"
        if key in self.avatar_images:
            return self.avatar_images[key]
        palette = [
            ("#E6F2FF", "#0A84FF"),
            ("#EAF8EF", "#1F9D4C"),
            ("#FFF4DF", "#B26A00"),
            ("#FEEEEE", "#C7362F"),
            ("#F1ECFF", "#6E45CC"),
            ("#EAF7F8", "#087C82"),
        ]
        index = sum(ord(char) for char in (name + phone)) % len(palette)
        bg, fg = palette[index]
        initials = "".join(part[0] for part in name.split()[:2]).upper() or "?"
        image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        draw.ellipse((0, 0, size - 1, size - 1), fill=bg)
        draw.ellipse((1, 1, size - 2, size - 2), outline=(255, 255, 255, 190), width=max(1, size // 22))
        try:
            font = ImageFont.truetype("segoeuib.ttf", max(14, size // 3))
        except OSError:
            font = ImageFont.load_default()
        bbox = draw.textbbox((0, 0), initials, font=font)
        draw.text(
            ((size - (bbox[2] - bbox[0])) / 2, (size - (bbox[3] - bbox[1])) / 2 - 1),
            initials,
            fill=fg,
            font=font,
        )
        ctk_image = ctk.CTkImage(light_image=image, size=(size, size))
        self.avatar_images[key] = ctk_image
        return ctk_image

    def _bot_badge(self) -> ctk.CTkImage:
        key = "bot-badge-apple"
        if key in self.avatar_images:
            return self.avatar_images[key]
        size = 56
        image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        draw.ellipse((0, 0, size - 1, size - 1), fill=GREEN_SOFT)
        draw.rounded_rectangle((17, 22, 39, 38), radius=6, fill="#22C55E")
        draw.rectangle((26, 17, 30, 23), fill="#22C55E")
        draw.ellipse((24, 13, 32, 21), fill="#22C55E")
        draw.ellipse((22, 28, 25, 31), fill="#FFFFFF")
        draw.ellipse((31, 28, 34, 31), fill="#FFFFFF")
        draw.rounded_rectangle((24, 34, 32, 36), radius=1, fill="#FFFFFF")
        ctk_image = ctk.CTkImage(light_image=image, size=(56, 56))
        self.avatar_images[key] = ctk_image
        return ctk_image

    def _format_phone(self, phone: str) -> str:
        clean = phone.replace("+90", "")
        if len(clean) == 10:
            return f"+90 {clean[:3]} {clean[3:6]} {clean[6:8]} {clean[8:]}"
        return phone

    def _format_log_time(self, value: str) -> str:
        try:
            sent_at = datetime.strptime(value, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            return value
        today = date.today()
        if sent_at.date() == today:
            return f"Bugün {sent_at:%H:%M}"
        if sent_at.date() == today - timedelta(days=1):
            return f"Dün {sent_at:%H:%M}"
        return sent_at.strftime("%d.%m.%Y %H:%M")

    def _on_time_picker_change(self, value: str) -> None:
        self.time_var.set(value)
        self.repeat_time_label.configure(text=f"Her Sabah {value}")

    def _update_char_count(self) -> None:
        count = len(self.message_box.get("1.0", "end").strip())
        over_limit = count > MAX_MESSAGE_LEN
        self.char_counter.configure(
            text=f"{count} / {MAX_MESSAGE_LEN}",
            text_color=DANGER if over_limit else MUTED,
        )

    def set_status(self, message: str) -> None:
        self.status_label.configure(text=_repair_text(message))

    def _run_send_task(self, work: Callable[[], RunResult], pending_message: str) -> None:
        if not self._send_lock.acquire(blocking=False):
            messagebox.showwarning("İşlem sürüyor", "Başka bir gönderim işlemi devam ediyor.")
            return
        self.set_status(pending_message)

        def runner() -> None:
            try:
                result = work()
            except Exception as exc:
                result = RunResult(False, "Hata", "Beklenmeyen hata oluştu.", str(exc))
            finally:
                self._send_lock.release()
            self.after(0, lambda: self._handle_send_result(result))

        threading.Thread(target=runner, daemon=True).start()

    def _handle_send_result(self, result: RunResult) -> None:
        self.set_status(result.user_message)
        if result.success:
            messagebox.showinfo(_repair_text(result.status), _repair_text(result.user_message))
        else:
            messagebox.showerror(_repair_text(result.status), _repair_text(result.error_message or result.user_message))
        self._refresh_status_card()

    def _on_scheduler_status(self, result: RunResult) -> None:
        self.after(0, lambda: self.set_status(result.user_message))

    def _on_monitor_status(self, message: str) -> None:
        def update() -> None:
            self.set_status(message)
            if hasattr(self, "auto_page") and hasattr(self.auto_page, "on_monitor_status"):
                self.auto_page.on_monitor_status(message)

        self.after(0, update)

    def _start_scheduler_if_enabled(self) -> None:
        settings = database.get_settings()
        if not settings["automation_enabled"]:
            return
        try:
            self.automation_scheduler.start_daily(settings["send_time"])
            self.set_status(f"Otomasyon {settings['send_time']} için aktif.")
            self._refresh_status_card()
        except Exception as exc:
            self.set_status(f"Otomasyon başlatılamadı: {exc}")

    def _toggle_zoom(self) -> None:
        try:
            self.state("normal" if self.state() == "zoomed" else "zoomed")
        except Exception:
            self.geometry(self._preferred_geometry())

    def _on_close(self) -> None:
        try:
            self.automation_scheduler.stop()
        except Exception:
            pass
        try:
            self.monitor.stop()
        except Exception:
            pass
        self.destroy()
