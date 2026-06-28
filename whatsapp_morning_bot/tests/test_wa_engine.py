from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from wa_engine import normalize_phone, validate_phone, validate_time  # noqa: E402


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("+905551234567", "+905551234567"),
        ("0090 555 123 45 67", "+905551234567"),
        ("0555 123 45 67", "+905551234567"),
        ("90 555 123 45 67", "+905551234567"),
        ("5551234567", "+905551234567"),
        ("(555) 123-45-67", "+905551234567"),
        ("+49 151 23456789", "+4915123456789"),
    ],
)
def test_normalize_phone(raw, expected):
    assert normalize_phone(raw) == expected


@pytest.mark.parametrize(
    "raw",
    ["+905551234567", "00905551234567", "0555 123 45 67", "+4915123456789"],
)
def test_validate_phone_accepts_valid(raw):
    assert validate_phone(raw).startswith("+")


@pytest.mark.parametrize("raw", ["12345", "abcdef", "+90555", "", "+0123456789"])
def test_validate_phone_rejects_invalid(raw):
    with pytest.raises(ValueError):
        validate_phone(raw)


@pytest.mark.parametrize("value", ["08:00", "00:00", "23:59", "9:05".zfill(5)])
def test_validate_time_accepts(value):
    assert validate_time(value) == value


@pytest.mark.parametrize("value", ["24:00", "08:60", "8:00", "abc", "0800"])
def test_validate_time_rejects(value):
    with pytest.raises(ValueError):
        validate_time(value)
