from __future__ import annotations

import sys
import tkinter as tk
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture()
def tk_root():
    try:
        root = tk.Tk()
    except tk.TclError:
        pytest.skip("Görüntü (display) yok; Tk testi atlanıyor.")
    root.withdraw()
    yield root
    root.destroy()


def test_wheel_time_picker_get_set(tk_root):
    from ui.time_picker import WheelTimePicker

    picker = WheelTimePicker(tk_root, initial="09:00")
    assert picker.get() == "09:00"

    picker.set("23:59")
    assert picker.get() == "23:59"

    picker.set("07:05")
    assert picker.get() == "07:05"


def test_wheel_time_picker_command_callback(tk_root):
    from ui.time_picker import WheelTimePicker

    seen: list[str] = []
    picker = WheelTimePicker(tk_root, command=seen.append, initial="08:00")
    picker._hour_wheel._shift(1)  # 08 -> 09
    assert picker.get() == "09:00"
    assert seen and seen[-1] == "09:00"


def test_wheel_wraps_around(tk_root):
    from ui.time_picker import WheelTimePicker

    picker = WheelTimePicker(tk_root, initial="23:00")
    picker._hour_wheel._shift(1)  # 23 -> 00 (sarma)
    assert picker.get() == "00:00"
