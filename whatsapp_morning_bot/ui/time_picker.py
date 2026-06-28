"""Apple/iOS tarzı kaydırmalı saat seçici (wheel time picker).

İki dikey tekerlek (saat 00-23, dakika 00-59). Ortadaki vurgu bandı seçili değeri gösterir;
komşu değerler solar. Fare tekerleği ve sürükleme ile döner, en yakın değere oturur.
"""

from __future__ import annotations

import tkinter as tk
from typing import Callable

import customtkinter as ctk


# Tema renkleri (main_window ile uyumlu, açık tema)
_BG = "#FFFFFF"
_BAND = "#E7F2FF"
_BAND_LINE = "#B9D9FF"
_TEXT = "#111827"
_DIM_1 = "#9AA6B6"
_DIM_2 = "#C7D0DC"
_LABEL = "#667085"


class _Wheel(tk.Canvas):
    """Tek bir döner sütun (saat veya dakika)."""

    def __init__(
        self,
        parent: tk.Misc,
        values: list[str],
        on_change: Callable[[], None],
        *,
        width: int = 64,
        item_height: int = 32,
        visible: int = 3,
    ) -> None:
        self._values = values
        self._on_change = on_change
        self._item_height = item_height
        self._visible = visible if visible % 2 == 1 else visible + 1
        self._half = self._visible // 2
        self._index = 0
        self._drag_start_y: int | None = None
        self._drag_accum = 0.0

        height = item_height * self._visible
        super().__init__(
            parent,
            width=width,
            height=height,
            bg=_BG,
            highlightthickness=0,
            bd=0,
        )
        self._width = width
        self._height = height

        self.bind("<MouseWheel>", self._on_mousewheel)        # Windows / macOS
        self.bind("<Button-4>", lambda _e: self._shift(-1))   # Linux yukarı
        self.bind("<Button-5>", lambda _e: self._shift(1))    # Linux aşağı
        self.bind("<Button-1>", self._on_press)
        self.bind("<B1-Motion>", self._on_drag)
        self.bind("<ButtonRelease-1>", self._on_release)
        self._redraw()

    # --- genel API ---
    @property
    def value(self) -> str:
        return self._values[self._index]

    def set_value(self, value: str) -> None:
        if value in self._values:
            self._index = self._values.index(value)
            self._redraw()

    # --- etkileşim ---
    def _on_mousewheel(self, event: tk.Event) -> None:
        self._shift(-1 if event.delta > 0 else 1)

    def _shift(self, delta: int) -> None:
        count = len(self._values)
        self._index = (self._index + delta) % count
        self._redraw()
        self._on_change()

    def _on_press(self, event: tk.Event) -> None:
        self._drag_start_y = event.y
        self._drag_accum = 0.0

    def _on_drag(self, event: tk.Event) -> None:
        if self._drag_start_y is None:
            return
        dy = event.y - self._drag_start_y
        self._drag_start_y = event.y
        self._drag_accum += dy
        # Her item_height'lık sürüklemede bir adım kaydır.
        while abs(self._drag_accum) >= self._item_height:
            if self._drag_accum > 0:
                self._shift(-1)
                self._drag_accum -= self._item_height
            else:
                self._shift(1)
                self._drag_accum += self._item_height

    def _on_release(self, _event: tk.Event) -> None:
        self._drag_start_y = None
        self._drag_accum = 0.0

    # --- çizim ---
    def _redraw(self) -> None:
        self.delete("all")
        count = len(self._values)
        center_y = self._height / 2

        # Orta vurgu bandı
        band_top = center_y - self._item_height / 2
        band_bottom = center_y + self._item_height / 2
        self.create_rectangle(
            6, band_top, self._width - 6, band_bottom,
            fill=_BAND, outline=_BAND_LINE, width=1,
        )

        for offset in range(-self._half, self._half + 1):
            value = self._values[(self._index + offset) % count]
            y = center_y + offset * self._item_height
            if offset == 0:
                color, font = _TEXT, ("Segoe UI", 18, "bold")
            elif abs(offset) == 1:
                color, font = _DIM_1, ("Segoe UI", 15)
            else:
                color, font = _DIM_2, ("Segoe UI", 13)
            self.create_text(self._width / 2, y, text=value, fill=color, font=font)


class WheelTimePicker(ctk.CTkFrame):
    """Saat + dakika tekerleklerini birleştiren seçici. get()/set('HH:MM')."""

    def __init__(
        self,
        parent: ctk.CTkBaseClass,
        command: Callable[[str], None] | None = None,
        initial: str = "09:00",
    ) -> None:
        super().__init__(parent, fg_color=_BG, corner_radius=16)
        self._command = command

        hours = [f"{h:02d}" for h in range(24)]
        minutes = [f"{m:02d}" for m in range(60)]

        self._hour_wheel = _Wheel(self, hours, self._notify)
        self._hour_wheel.grid(row=0, column=0, padx=(10, 0), pady=8)

        tk.Label(self, text=":", bg=_BG, fg=_TEXT, font=("Segoe UI", 20, "bold")).grid(
            row=0, column=1, padx=2
        )

        self._minute_wheel = _Wheel(self, minutes, self._notify)
        self._minute_wheel.grid(row=0, column=2, padx=(0, 10), pady=8)

        self.set(initial)

    def _notify(self) -> None:
        if self._command:
            self._command(self.get())

    def get(self) -> str:
        return f"{self._hour_wheel.value}:{self._minute_wheel.value}"

    def set(self, value: str) -> None:
        try:
            hour, minute = value.strip().split(":")
            self._hour_wheel.set_value(f"{int(hour):02d}")
            self._minute_wheel.set_value(f"{int(minute):02d}")
        except (ValueError, AttributeError):
            return
